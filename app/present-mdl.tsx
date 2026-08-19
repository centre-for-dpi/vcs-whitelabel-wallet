import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { mdocDataTransfer } from 'expo-mdoc-data-transfer';
import { MdocRecord } from '@credo-ts/core';
import { branding } from '../branding.config';
import { useAgentState } from '../src/agent/context';
import { parseRequestedElements, filterByRequest } from '../src/agent/mdl/presentMdoc';
import { buildDeviceResponse, type MdocDeviceAuthAlgorithm } from '../src/agent/mdl/signDeviceResponse';

/* eslint-disable no-console */
const log = __DEV__ ? console.log.bind(console) : () => {};

type Step = 'loading' | 'qr' | 'confirm' | 'presenting' | 'done' | 'error';

/**
 * mDL BLE proximity presentation screen (ISO/IEC 18013-5 device retrieval).
 * Entirely separate from present.tsx's OID4VP HTTP flow — see the routing
 * note in app/(tabs)/credentials/index.tsx's handlePresent.
 *
 * Flow: mount → generate BLE device engagement (QR) → wait for a reader to
 * connect and send a DeviceRequest → show exactly what it asked for (spec
 * §S-3 criterion (c): never send without explicit consent) → on approval,
 * sign and send the DeviceResponse.
 *
 * Fase 0 hardware-spike note (this screen is the artifact of that spike):
 * sessionTranscriptBytes and deviceRequest both come from
 * mdocDataTransfer.waitForDeviceRequest() — the native module (wrapping
 * EUDI's TransferManager on Android and equivalent APIs elsewhere) computes
 * the transcript from the real BLE device/reader engagement exchange. This
 * screen never reconstructs it; doing so from anything but what the native
 * layer observed would sign a transcript the reader never agreed to.
 */
export default function PresentMdl() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const agentState = useAgentState();
  const [step, setStep] = useState<Step>('loading');
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [requestedElements, setRequestedElements] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  // Held across the loading→qr→confirm steps without re-render dependencies:
  // the pending request bytes + the record, needed only once approval fires.
  const pending = useRef<{
    deviceRequestBytes: Uint8Array;
    sessionTranscriptBytes: Uint8Array;
    record: MdocRecord;
  } | null>(null);

  // Deliberately not using the package's useMdocDataTransferShutdownOnUnmount:
  // it captures `instance` as a module binding when the screen mounts, but the
  // package reassigns that variable on every initialize/shutdown, so on a
  // second visit the hook can hold a stale reference and skip the teardown.
  // closeSession below reads the live value through isInitialized() instead.
  useEffect(() => closeSession, []);

  useEffect(() => {
    if (agentState.status !== 'ready' || !id) return;
    void runEngagement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentState.status, id]);

  /**
   * Tears the BLE session down so the next presentation starts clean.
   *
   * Always goes through isInitialized() first: mdocDataTransfer.instance()
   * *creates* an instance when none exists, so calling it just to shut down
   * would spin up a fresh native session and immediately kill it. Doing that
   * left the native side and the JS side disagreeing about whether a session
   * existed, which is what produced "not initialized" on the second QR —
   * the first presentation worked, every one after it failed until the app
   * was restarted.
   */
  const closeSession = () => {
    try {
      if (mdocDataTransfer.isInitialized()) mdocDataTransfer.instance().shutdown();
    } catch (e) {
      // Best-effort: a failed teardown must not mask the error that led here.
      console.error('[presentMdl] shutdown failed:', e);
    }
  };

  const runEngagement = async () => {
    if (agentState.status !== 'ready') return;
    const { agent } = agentState;
    try {
      const record = await agent.mdoc.getById(id);

      const mdt = mdocDataTransfer.instance();
      mdt.enableNfc();
      const qr = await mdt.startQrEngagement();
      setQrValue(qr);
      setStep('qr');
      log('[presentMdl] QR engagement ready, waiting for reader');

      const { deviceRequest: deviceRequestBytes, sessionTranscript: sessionTranscriptBytes } =
        await mdt.waitForDeviceRequest();
      log('[presentMdl] DeviceRequest received:', deviceRequestBytes.length, 'bytes');

      const { requestedElements: elements } = parseRequestedElements(deviceRequestBytes);
      pending.current = { deviceRequestBytes, sessionTranscriptBytes, record };
      setRequestedElements(elements);
      setStep('confirm');
    } catch (e: unknown) {
      console.error('[presentMdl] engagement/request failed:', e);
      // Same reasoning as the approve path: leave no half-open BLE session
      // behind, or the next presentation starts against stale native state.
      closeSession();
      setErrorMsg(e instanceof Error ? e.message : t('presentMdl.error_generic'));
      setStep('error');
    }
  };

  const handleApprove = async () => {
    if (agentState.status !== 'ready' || !pending.current) return;
    const { agent } = agentState;
    const { deviceRequestBytes, sessionTranscriptBytes, record } = pending.current;
    setStep('presenting');
    try {
      const mdoc = record.firstCredential;
      // filterByRequest is defense-in-depth only (see its own doc comment) —
      // DeviceResponse.usingDeviceRequest (inside buildDeviceResponse) is the
      // actual disclosure boundary enforced against the parsed DeviceRequest.
      // Calling it here just confirms locally that what's about to be signed
      // matches what the consent screen showed the user.
      const storedClaims = Object.assign({}, ...Object.values(mdoc.issuerSignedNamespaces ?? {}));
      filterByRequest(storedClaims, requestedElements);

      const devicePublicJwk = mdoc.deviceKey.toJson();
      const deviceKeyAlgorithm = mdoc.deviceKey.signatureAlgorithm as MdocDeviceAuthAlgorithm;

      const deviceResponseBytes = await buildDeviceResponse(agent, {
        storedMdoc: mdoc,
        deviceRequestBytes,
        sessionTranscriptBytes,
        devicePublicJwk,
        deviceKeyAlgorithm,
      });

      const mdt = mdocDataTransfer.instance();
      // sendDeviceResponse's TS signature takes the raw Uint8Array directly —
      // the module's own JS wrapper (MdocDataTransfer.js) does the
      // Buffer.from(...).toString('base64') conversion internally before
      // calling the native side, so passing pre-encoded bytes here would
      // double-encode.
      await mdt.sendDeviceResponse(deviceResponseBytes);
      log('[presentMdl] DeviceResponse sent');
      setStep('done');
    } catch (e: unknown) {
      console.error('[presentMdl] sign/send failed:', e);
      // Close the BLE session before showing the error. Without this the
      // reader sits waiting for a DeviceResponse that will never arrive and
      // eventually times out with no explanation. Dropping the connection at
      // least tells it the session is over immediately.
      //
      // Ideally this would send a proper ISO 18013-5 session-termination
      // status instead of just disconnecting, but the native module only
      // exposes shutdown() — there is no API to send an error status
      // (MdocDataTransferModule.swift exposes initialize/startQrEngagement/
      // sendDeviceResponse/shutdown/enableNfc, nothing else).
      closeSession();
      setErrorMsg(e instanceof Error ? e.message : t('presentMdl.error_generic'));
      setStep('error');
    }
  };

  const handleReject = () => {
    closeSession();
    router.back();
  };

  if (step === 'loading' || step === 'qr') {
    return (
      <View style={styles.center}>
        {qrValue ? (
          <>
            <QRCode value={qrValue} size={240} />
            <Text style={styles.statusText}>{t('presentMdl.waiting_for_reader')}</Text>
          </>
        ) : (
          <ActivityIndicator size="large" color={branding.primaryColor} />
        )}
        <TouchableOpacity style={styles.cancelBtn} onPress={handleReject}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'confirm') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>{t('presentMdl.label_requested')}</Text>
          {requestedElements.map((name) => (
            <View key={name} style={styles.elementRow}>
              <Text style={styles.elementName}>{name}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: branding.primaryColor }]}
          onPress={() => void handleApprove()}
        >
          <Text style={styles.btnText}>{t('presentMdl.approve_btn')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={handleReject}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (step === 'presenting') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={branding.primaryColor} />
        <Text style={styles.statusText}>{t('presentMdl.presenting')}</Text>
      </View>
    );
  }

  if (step === 'done') {
    return (
      <View style={styles.center}>
        <Text style={styles.doneIcon}>✅</Text>
        <Text style={styles.doneTitle}>{t('presentMdl.success_title')}</Text>
        <TouchableOpacity style={[styles.btn, { backgroundColor: branding.primaryColor }]} onPress={() => router.back()}>
          <Text style={styles.btnText}>{t('presentMdl.done_btn')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <Text style={styles.doneIcon}>❌</Text>
      <Text style={styles.doneTitle}>{t('common.error')}</Text>
      <Text style={styles.errorBody}>{errorMsg}</Text>
      <TouchableOpacity style={[styles.btn, { backgroundColor: '#DC2626' }]} onPress={() => router.back()}>
        <Text style={styles.btnText}>{t('presentMdl.back_btn')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flexGrow: 1, padding: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  statusText: { marginTop: 16, fontSize: 15, color: '#6B7280', textAlign: 'center' },
  card: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 20, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  elementRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  elementName: { fontSize: 15, color: '#111827' },
  btn: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12, marginTop: 8 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { height: 44, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  cancelText: { color: '#6B7280', fontSize: 15 },
  doneIcon: { fontSize: 56, marginBottom: 16 },
  doneTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8, textAlign: 'center' },
  errorBody: { fontSize: 14, color: '#DC2626', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
});
