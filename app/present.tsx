import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';
import type { OpenId4VpResolvedAuthorizationRequest } from '@credo-ts/openid4vc';
import { branding } from '../branding.config';
import { useAgentState } from '../src/agent/context';
import i18n from '../src/i18n';
import { normalizeAuthorizationRequestUrl, isHttpOid4VpRequest, resolveHttpOid4VpRequest } from '../src/agent/oid4vp/normalizeRequest';
import { presentCredentials } from '../src/agent/oid4vp/presentCredentials';

type Step = 'resolving' | 'confirm' | 'qr' | 'presenting' | 'done' | 'error';

type RequestInfo = {
  verifier: string;
  purpose: string;
  requestedTypes: string[];
  requestedFields: string[];
};

export default function Present() {
  const { t } = useTranslation();
  const { url, id, format } = useLocalSearchParams<{ url?: string; id?: string; format?: string }>();
  const agentState = useAgentState();
  const [step, setStep] = useState<Step>('resolving');
  const [requestInfo, setRequestInfo] = useState<RequestInfo | null>(null);
  const [resolvedRequest, setResolvedRequest] = useState<OpenId4VpResolvedAuthorizationRequest | null>(null);
  const [compactSdJwt, setCompactSdJwt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (agentState.status !== 'ready') return;
    if (url) resolveOID4VP();
    else if (id) loadCredentialQr();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, id, agentState.status]);

  const resolveOID4VP = async () => {
    if (agentState.status !== 'ready' || !url) return;
    const { agent } = agentState;
    try {
      console.log('[present] url param:', url.slice(0, 200));
      let resolved;
      if (isHttpOid4VpRequest(url)) {
        resolved = await resolveHttpOid4VpRequest(url);
      } else {
        const resolveUrl = await normalizeAuthorizationRequestUrl(url);
        console.log('[present] normalized url:', resolveUrl.slice(0, 200));
        resolved = await agent.modules.openid4vc.holder.resolveOpenId4VpAuthorizationRequest(resolveUrl);
      }

      setResolvedRequest(resolved);

      const r = resolved as Record<string, unknown>;
      const verifierInfo = r.verifier as Record<string, string> | undefined;
      const verifier = verifierInfo?.effectiveClientId ?? i18n.t('present.verifier_fallback');

      const pex = r.presentationExchange as Record<string, unknown> | undefined;
      const dcql = r.dcql as Record<string, unknown> | undefined;
      console.log('[present] pex:', !!pex, '| dcql:', !!dcql);

      let purpose = i18n.t('present.default_purpose');
      let requestedTypes: string[] = [];
      let requestedFields: string[] = [];

      if (pex) {
        const definition = pex.definition as Record<string, unknown> | undefined;
        purpose = (definition?.purpose as string | undefined) ?? purpose;
        const descriptors = (definition?.input_descriptors as Array<Record<string, unknown>>) ?? [];
        requestedTypes = descriptors.map((d) => (d.name ?? d.id ?? i18n.t('present.credential_fallback')) as string);
        for (const d of descriptors) {
          const fields = ((d.constraints as Record<string, unknown> | undefined)
            ?.fields as Array<Record<string, unknown>>) ?? [];
          for (const f of fields) {
            const paths = f.path as string[] | undefined;
            const leaf = paths?.[0]?.split('.').pop()?.replace(/[[\]]/g, '');
            if (leaf && leaf !== '$' && leaf !== 'vct' && leaf !== 'type') {
              requestedFields.push(leaf);
            }
          }
        }
      } else if (dcql) {
        const queryResult = dcql.queryResult as Record<string, unknown> | undefined;
        const credQueries = (queryResult?.credentials as Array<Record<string, unknown>>) ?? [];

        const allSdJwt = await agent.sdJwtVc.getAll();
        requestedTypes = credQueries.map((q) => {
          const vcts = ((q.meta as Record<string, unknown> | undefined)
            ?.vct_values as string[] | undefined) ?? [];
          const matched = vcts.length > 0
            ? allSdJwt.find((rec) => {
                const vct = (rec.firstCredential.prettyClaims as Record<string, unknown>).vct as string | undefined;
                return vct && vcts.includes(vct);
              })
            : allSdJwt[0];
          if (matched) {
            return ((matched.getTags() as Record<string, unknown>).credentialName as string | undefined)
              ?? i18n.t('present.credential_fallback');
          }
          const lastSeg = vcts[0]?.split('/').pop() ?? '';
          return /^[0-9a-f-]{36}$/i.test(lastSeg) ? i18n.t('present.credential_fallback') : (lastSeg || (q.id as string) || i18n.t('present.credential_fallback'));
        });

        for (const q of credQueries) {
          const claims = (q.claims as Array<Record<string, unknown>>) ?? [];
          for (const c of claims) {
            const path = c.path as Array<string | number> | undefined;
            const leaf = String(path?.[path.length - 1] ?? '');
            if (leaf) requestedFields.push(leaf);
          }
        }
      }

      requestedFields = [...new Set(requestedFields)];
      console.log('[present] verifier:', verifier, '| types:', requestedTypes, '| fields:', requestedFields);

      setRequestInfo({ verifier, purpose, requestedTypes, requestedFields });
      setStep('confirm');
    } catch (e: unknown) {
      console.error('[present] resolveOID4VP FAILED:', e);
      if (e instanceof Error && e.stack) console.error('[present] stack:', e.stack.slice(0, 600));
      const msg = e instanceof Error ? e.message : String(e);
      const isExpired = msg.includes('404') || msg.includes('invalid_request_uri');
      setErrorMsg(isExpired ? i18n.t('present.expired_error') : msg);
      setStep('error');
    }
  };

  const loadCredentialQr = async () => {
    if (agentState.status !== 'ready' || !id) return;
    const { agent } = agentState;
    try {
      if (format === 'sdjwt') {
        const record = await agent.sdJwtVc.getById(id);
        setCompactSdJwt(record.firstCredential.compact);
      }
      setStep('qr');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('present.load_error'));
      setStep('error');
    }
  };

  const handlePresent = async () => {
    if (agentState.status !== 'ready' || !resolvedRequest) return;
    const { agent } = agentState;
    setStep('presenting');
    try {
      console.log('[present] presenting credentials...');
      await presentCredentials(agent, resolvedRequest);
      console.log('[present] presentation successful');
      setStep('done');
    } catch (e: unknown) {
      console.error('[present] handlePresent FAILED:', e);
      if (e instanceof Error && e.stack) console.error('[present] stack:', e.stack.slice(0, 600));
      setErrorMsg(e instanceof Error ? e.message : t('present.present_error'));
      setStep('error');
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      scrollEnabled={step === 'qr' || step === 'confirm'}
    >
      {step === 'resolving' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={branding.primaryColor} />
          <Text style={styles.statusText}>{t('present.loading')}</Text>
        </View>
      )}

      {step === 'confirm' && requestInfo && (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>{t('present.label_verifier')}</Text>
            <Text style={styles.value}>{requestInfo.verifier}</Text>
            <Text style={[styles.label, { marginTop: 16 }]}>{t('present.label_purpose')}</Text>
            <Text style={styles.value}>{requestInfo.purpose}</Text>
            {requestInfo.requestedTypes.length > 0 && (
              <>
                <Text style={[styles.label, { marginTop: 16 }]}>{t('present.label_creds')}</Text>
                {requestInfo.requestedTypes.map((type, i) => (
                  <View key={i} style={styles.credRow}>
                    <Text style={styles.credName}>🔍  {type}</Text>
                  </View>
                ))}
              </>
            )}
            {requestInfo.requestedFields.length > 0 && (
              <>
                <Text style={[styles.label, { marginTop: 16 }]}>{t('present.label_fields')}</Text>
                {requestInfo.requestedFields.map((f, i) => (
                  <View key={i} style={styles.credRow}>
                    <Text style={styles.credName}>📋  {f}</Text>
                  </View>
                ))}
              </>
            )}
          </View>

          <View style={styles.notice}>
            <Text style={styles.noticeText}>{t('present.auto_select')}</Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: branding.primaryColor }]}
            onPress={handlePresent}
          >
            <Text style={styles.btnText}>{t('present.present_btn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </>
      )}

      {step === 'qr' && (
        <View style={styles.qrContainer}>
          <Text style={styles.qrTitle}>{t('present.qr_title')}</Text>
          <Text style={styles.qrSubtitle}>{t('present.qr_subtitle')}</Text>

          {compactSdJwt ? (
            <View style={styles.qrBox}>
              <QRCode value={compactSdJwt} size={260} color="#111827" backgroundColor="#fff" />
            </View>
          ) : (
            <View style={[styles.qrBox, styles.qrBoxEmpty]}>
              <Text style={styles.qrBoxEmptyText}>{t('present.qr_not_supported')}</Text>
            </View>
          )}

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>o</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: branding.primaryColor }]}
            onPress={() => { router.back(); router.replace({ pathname: '/(tabs)/scan', params: { context: 'present' } }); }}
          >
            <Text style={styles.btnText}>{t('present.scan_verifier_btn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelText}>{t('present.back_btn')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'presenting' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={branding.primaryColor} />
          <Text style={styles.statusText}>{t('present.sending')}</Text>
        </View>
      )}

      {step === 'done' && (
        <View style={styles.center}>
          <Text style={styles.doneIcon}>✅</Text>
          <Text style={styles.doneTitle}>{t('present.success_title')}</Text>
          <Text style={styles.doneBody}>{t('present.success_body')}</Text>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: branding.primaryColor }]}
            onPress={() => { router.dismiss(); router.replace('/(tabs)/credentials'); }}
          >
            <Text style={styles.btnText}>{t('present.return_btn')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'error' && (
        <View style={styles.center}>
          <Text style={styles.doneIcon}>❌</Text>
          <Text style={styles.doneTitle}>{t('common.error')}</Text>
          <Text style={styles.errorBody}>{errorMsg}</Text>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#DC2626' }]}
            onPress={() => router.back()}
          >
            <Text style={styles.btnText}>{t('present.back_btn')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { flexGrow: 1, padding: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: 300 },
  statusText: { marginTop: 16, fontSize: 15, color: '#6B7280' },
  card: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 20, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  value: { fontSize: 15, color: '#111827' },
  credRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB', marginTop: 4 },
  credName: { fontSize: 15, color: '#111827' },
  notice: { backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 20 },
  noticeText: { fontSize: 13, color: '#92400E', lineHeight: 18 },
  btn: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12, width: '100%' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { height: 44, justifyContent: 'center', alignItems: 'center' },
  cancelText: { color: '#6B7280', fontSize: 15 },
  doneIcon: { fontSize: 56, marginBottom: 16 },
  doneTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  doneBody: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  errorBody: { fontSize: 14, color: '#DC2626', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  qrContainer: { flex: 1, alignItems: 'center', paddingTop: 8 },
  qrTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8, textAlign: 'center' },
  qrSubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  qrBox: { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 28, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 4 },
  qrBoxEmpty: { width: 300, height: 160, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  qrBoxEmptyText: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dividerText: { marginHorizontal: 12, fontSize: 13, color: '#9CA3AF' },
});
