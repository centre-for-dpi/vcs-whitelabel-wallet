import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';
import type { OpenId4VpResolvedAuthorizationRequest } from '@credo-ts/openid4vc';
import { branding, trustRegistry } from '../branding.config';
import { useAgentState } from '../src/agent/context';
import { checkTrust, TRUST_COLORS, TRUST_ICONS, type TrustStatus } from '../src/agent/trust';
import i18n from '../src/i18n';
import { normalizeAuthorizationRequestUrl, isHttpOid4VpRequest, resolveHttpOid4VpRequest } from '../src/agent/oid4vp/normalizeRequest';
import { selectCredentialsForRequest } from '../src/agent/oid4vp/selectCredentials';
import { presentCredentials } from '../src/agent/oid4vp/presentCredentials';
import { fromSdJwtRecord, getSdJwtCompact, getSdJwtPrettyClaims } from '../src/utils/credential';
import { addPresentation } from '../src/utils/presentationHistory';

type Step = 'resolving' | 'confirm' | 'qr' | 'presenting' | 'done' | 'error';

type RequestInfo = {
  verifier: string;
  purpose: string;
  requestedTypes: string[];
  requestedFields: string[];
};

type DisclosureInfo = {
  credentialType: string;
  beingShared: string[];    // claim keys the verifier will receive
  stayingPrivate: string[]; // claim keys in the credential that will NOT be sent
};

export default function Present() {
  const { t } = useTranslation();
  const { url, id, format } = useLocalSearchParams<{ url?: string; id?: string; format?: string }>();
  const agentState = useAgentState();
  const [step, setStep] = useState<Step>('resolving');
  const [requestInfo, setRequestInfo] = useState<RequestInfo | null>(null);
  const [disclosureInfo, setDisclosureInfo] = useState<DisclosureInfo | null>(null);
  const [resolvedRequest, setResolvedRequest] = useState<OpenId4VpResolvedAuthorizationRequest | null>(null);
  const [compactSdJwt, setCompactSdJwt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [optionalFields, setOptionalFields] = useState<Set<string>>(new Set());
  const [deselectedFields, setDeselectedFields] = useState<Set<string>>(new Set());
  const [verifierTrust, setVerifierTrust] = useState<TrustStatus>('unknown');

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
      setVerifierTrust(checkTrust(verifier, trustRegistry));

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
        const optFieldSet = new Set<string>();
        for (const d of descriptors) {
          const fields = ((d.constraints as Record<string, unknown> | undefined)
            ?.fields as Array<Record<string, unknown>>) ?? [];
          for (const f of fields) {
            const paths = f.path as string[] | undefined;
            const leaf = paths?.[0]?.split('.').pop()?.replace(/[[\]]/g, '');
            if (leaf && leaf !== '$' && leaf !== 'vct' && leaf !== 'type') {
              requestedFields.push(leaf);
              if (f.optional === true) optFieldSet.add(leaf);
            }
          }
        }
        setOptionalFields(optFieldSet);
      } else if (dcql) {
        const queryResult = dcql.queryResult as Record<string, unknown> | undefined;
        const credQueries = (queryResult?.credentials as Array<Record<string, unknown>>) ?? [];

        const allSdJwt = await agent.sdJwtVc.getAll();
        requestedTypes = credQueries.map((q) => {
          const vcts = ((q.meta as Record<string, unknown> | undefined)
            ?.vct_values as string[] | undefined) ?? [];
          const matched = vcts.length > 0
            ? allSdJwt.find((rec) => {
                const vct = getSdJwtPrettyClaims(rec).vct as string | undefined;
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

      // Pre-select credentials to validate the request CAN be satisfied
      // and to compute the selective disclosure breakdown for the UI.
      try {
        const selected = await selectCredentialsForRequest(agent, resolved);

        // PEX: extract the first matched credential and compute disclosed / private split
        if (selected.presentationExchange) {
          const firstEntry = Object.values(selected.presentationExchange.credentials)[0]?.[0];
          if (firstEntry) {
            const credEntry = fromSdJwtRecord(firstEntry.credentialRecord);
            const beingShared = requestedFields.filter((f) => credEntry.selectiveFields.includes(f));
            const stayingPrivate = credEntry.selectiveFields.filter((f) => !requestedFields.includes(f));
            setDisclosureInfo({ credentialType: credEntry.type, beingShared, stayingPrivate });
          }
        }

        // DCQL: no easy access to the matched record — show requested fields as being shared
        if (selected.dcql) {
          setDisclosureInfo({
            credentialType: requestedTypes[0] ?? i18n.t('present.credential_fallback'),
            beingShared: requestedFields,
            stayingPrivate: [],
          });
        }
      } catch (selErr) {
        // Selection failed (no matching credential) — bubble up as a resolve error
        throw selErr;
      }

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
        const compact = getSdJwtCompact(record);
        // QR codes hold ~2,953 bytes max; large SD-JWTs (e.g. INJI) exceed this limit.
        setCompactSdJwt(compact && compact.length <= 2500 ? compact : null);
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
      await presentCredentials(agent, resolvedRequest, deselectedFields.size > 0 ? deselectedFields : undefined);
      console.log('[present] presentation successful');
      if (requestInfo) {
        const effectiveShared = disclosureInfo
          ? disclosureInfo.beingShared.filter((f) => !deselectedFields.has(f))
          : requestInfo.requestedFields;
        addPresentation({
          timestamp: new Date().toISOString(),
          verifier: requestInfo.verifier,
          purpose: requestInfo.purpose,
          credentialTypes: requestInfo.requestedTypes,
          sharedFields: effectiveShared,
          privateFields: disclosureInfo?.stayingPrivate,
          trustStatus: verifierTrust,
          protocol: resolvedRequest
            ? ((resolvedRequest as unknown as Record<string, unknown>).dcql ? 'dcql' : 'pex')
            : undefined,
        }).catch((e) => console.error('[history] save error:', e));
      }
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
          {/* Verifier + purpose */}
          <View style={styles.card}>
            <Text style={styles.label}>{t('present.label_verifier')}</Text>
            <View style={styles.trustRow}>
              <Text style={styles.value}>{requestInfo.verifier}</Text>
              <View style={[styles.trustBadge, { backgroundColor: TRUST_COLORS[verifierTrust] + '1A', borderColor: TRUST_COLORS[verifierTrust] }]}>
                <Text style={[styles.trustBadgeText, { color: TRUST_COLORS[verifierTrust] }]}>
                  {TRUST_ICONS[verifierTrust]} {t(`trust.${verifierTrust}`)}
                </Text>
              </View>
            </View>
            <Text style={[styles.label, { marginTop: 16 }]}>{t('present.label_purpose')}</Text>
            <Text style={styles.value}>{requestInfo.purpose}</Text>
          </View>

          {/* Selective disclosure breakdown */}
          {disclosureInfo && (
            <View style={styles.disclosureCard}>
              <Text style={styles.label}>{t('present.credential_used')}</Text>
              <Text style={styles.credentialType}>{disclosureInfo.credentialType}</Text>

              {disclosureInfo.beingShared.length > 0 && (
                <>
                  <View style={styles.disclosureDivider} />
                  <View style={styles.disclosureHeaderRow}>
                    <Text style={[styles.label, { color: '#059669' }]}>{t('present.label_disclosed')}</Text>
                    {optionalFields.size > 0 && (
                      <Text style={styles.optionalHint}>{t('present.optional_hint')}</Text>
                    )}
                  </View>
                  {disclosureInfo.beingShared.map((field) => {
                    const isOptional = optionalFields.has(field);
                    const isOn = !deselectedFields.has(field);
                    return (
                      <View key={field} style={styles.fieldRow}>
                        {isOptional ? (
                          <Switch
                            value={isOn}
                            onValueChange={(val) => {
                              setDeselectedFields((prev) => {
                                const next = new Set(prev);
                                if (!val) next.add(field); else next.delete(field);
                                return next;
                              });
                            }}
                            trackColor={{ false: '#E5E7EB', true: branding.primaryColor }}
                            thumbColor="#fff"
                            style={styles.fieldSwitch}
                          />
                        ) : (
                          <Text style={styles.fieldIcon}>✓</Text>
                        )}
                        <Text style={[styles.fieldName, !isOn && styles.fieldNameDeselected]}>
                          {field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                        </Text>
                        {isOptional && (
                          <View style={styles.optionalBadge}>
                            <Text style={styles.optionalBadgeText}>{t('present.optional_badge')}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </>
              )}

              {disclosureInfo.stayingPrivate.length > 0 && (
                <>
                  <View style={styles.disclosureDivider} />
                  <Text style={[styles.label, { color: '#6B7280' }]}>{t('present.label_private')}</Text>
                  {disclosureInfo.stayingPrivate.map((field) => (
                    <View key={field} style={styles.fieldRow}>
                      <Text style={styles.fieldIcon}>🔒</Text>
                      <Text style={[styles.fieldName, styles.fieldNamePrivate]}>
                        {field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          )}

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
  card: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 20, marginBottom: 12 },
  disclosureCard: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 20, marginBottom: 20 },
  label: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  trustBadge: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  trustBadgeText: { fontSize: 12, fontWeight: '600' },
  value: { fontSize: 15, color: '#111827', flex: 1 },
  credentialType: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 4 },
  disclosureDivider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 12 },
  disclosureHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  optionalHint: { fontSize: 11, color: '#6B7280' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  fieldIcon: { fontSize: 14, marginRight: 8, width: 20 },
  fieldSwitch: { marginRight: 8, transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
  fieldName: { fontSize: 14, color: '#111827', flex: 1 },
  fieldNamePrivate: { color: '#9CA3AF' },
  fieldNameDeselected: { color: '#9CA3AF', textDecorationLine: 'line-through' },
  optionalBadge: { backgroundColor: '#F3F4F6', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 6 },
  optionalBadgeText: { fontSize: 10, fontWeight: '600', color: '#6B7280' },
  btn: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12, width: '100%', alignSelf: 'stretch' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { height: 44, justifyContent: 'center', alignItems: 'center', alignSelf: 'stretch' },
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
