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
import type { OpenId4VpResolvedAuthorizationRequest } from '@credo-ts/openid4vc';
import { branding } from '../branding.config';
import { useAgentState } from '../src/agent/context';
import { normalizeAuthorizationRequestUrl } from '../src/agent/oid4vp/normalizeRequest';
import { presentCredentials } from '../src/agent/oid4vp/presentCredentials';

type Step = 'resolving' | 'confirm' | 'qr' | 'presenting' | 'done' | 'error';

type RequestInfo = {
  verifier: string;
  purpose: string;
  requestedTypes: string[];
  requestedFields: string[];
};

export default function Present() {
  const { url, id, format } = useLocalSearchParams<{
    url?: string;
    id?: string;
    format?: string;
  }>();
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
  }, [url, id, agentState.status]);

  const resolveOID4VP = async () => {
    if (agentState.status !== 'ready' || !url) return;
    const { agent } = agentState;
    try {
      console.log('[present] url param:', url.slice(0, 200));
      const resolveUrl = await normalizeAuthorizationRequestUrl(url);
      console.log('[present] normalized url:', resolveUrl.slice(0, 200));

      const resolved = await agent.modules.openid4vc.holder.resolveOpenId4VpAuthorizationRequest(resolveUrl);
      setResolvedRequest(resolved);

      const r = resolved as Record<string, unknown>;
      const verifierInfo = r.verifier as Record<string, string> | undefined;
      const verifier = verifierInfo?.effectiveClientId ?? 'Verificador';

      const pex = r.presentationExchange as Record<string, unknown> | undefined;
      const dcql = r.dcql as Record<string, unknown> | undefined;
      console.log('[present] pex:', !!pex, '| dcql:', !!dcql);

      let purpose = 'Verificación de credencial';
      let requestedTypes: string[] = [];
      let requestedFields: string[] = [];

      if (pex) {
        const definition = pex.definition as Record<string, unknown> | undefined;
        purpose = (definition?.purpose as string | undefined) ?? purpose;
        const descriptors = (definition?.input_descriptors as Array<Record<string, unknown>>) ?? [];
        requestedTypes = descriptors.map((d) => (d.name ?? d.id ?? 'Credencial') as string);
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
        // Credo embeds the original credential queries inside queryResult.credentials
        const queryResult = dcql.queryResult as Record<string, unknown> | undefined;
        const credQueries = (queryResult?.credentials as Array<Record<string, unknown>>) ?? [];

        // For each DCQL credential query, prefer the matching wallet record's credentialName tag.
        // The VCT URL ends in a UUID which is not human-readable, so we cross-reference
        // the wallet to find a name. If no match by VCT, fall back to first wallet credential name.
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
              ?? 'Credencial';
          }
          const lastSeg = vcts[0]?.split('/').pop() ?? '';
          return /^[0-9a-f-]{36}$/i.test(lastSeg) ? 'Credencial' : (lastSeg || (q.id as string) || 'Credencial');
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
      setErrorMsg(
        isExpired
          ? 'La solicitud de verificación ha expirado o ya fue utilizada. Pide al verificador que genere un nuevo QR.'
          : msg,
      );
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
      setErrorMsg(e instanceof Error ? e.message : 'Error al cargar la credencial.');
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
      setErrorMsg(e instanceof Error ? e.message : 'Error al presentar la credencial.');
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
          <Text style={styles.statusText}>Leyendo solicitud...</Text>
        </View>
      )}

      {step === 'confirm' && requestInfo && (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>Verificador</Text>
            <Text style={styles.value}>{requestInfo.verifier}</Text>
            <Text style={[styles.label, { marginTop: 16 }]}>Propósito</Text>
            <Text style={styles.value}>{requestInfo.purpose}</Text>
            {requestInfo.requestedTypes.length > 0 && (
              <>
                <Text style={[styles.label, { marginTop: 16 }]}>Credenciales solicitadas</Text>
                {requestInfo.requestedTypes.map((t, i) => (
                  <View key={i} style={styles.credRow}>
                    <Text style={styles.credName}>🔍  {t}</Text>
                  </View>
                ))}
              </>
            )}
            {requestInfo.requestedFields.length > 0 && (
              <>
                <Text style={[styles.label, { marginTop: 16 }]}>Campos solicitados</Text>
                {requestInfo.requestedFields.map((f, i) => (
                  <View key={i} style={styles.credRow}>
                    <Text style={styles.credName}>📋  {f}</Text>
                  </View>
                ))}
              </>
            )}
          </View>

          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Se seleccionarán automáticamente las credenciales que satisfagan la solicitud.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: branding.primaryColor }]}
            onPress={handlePresent}
          >
            <Text style={styles.btnText}>Presentar credencial</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
        </>
      )}

      {step === 'qr' && (
        <View style={styles.qrContainer}>
          <Text style={styles.qrTitle}>Presentación presencial</Text>
          <Text style={styles.qrSubtitle}>
            Muestra este QR al verificador para que escanee tu credencial directamente.
          </Text>

          {compactSdJwt ? (
            <View style={styles.qrBox}>
              <QRCode value={compactSdJwt} size={260} color="#111827" backgroundColor="#fff" />
            </View>
          ) : (
            <View style={[styles.qrBox, styles.qrBoxEmpty]}>
              <Text style={styles.qrBoxEmptyText}>
                Este tipo de credencial no admite presentación QR directa.
              </Text>
            </View>
          )}

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>o</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: branding.primaryColor }]}
            onPress={() => {
              router.back();
              router.replace({ pathname: '/(tabs)/scan', params: { context: 'present' } });
            }}
          >
            <Text style={styles.btnText}>Escanear QR del verificador</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelText}>Volver</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'presenting' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={branding.primaryColor} />
          <Text style={styles.statusText}>Enviando presentación al verificador...</Text>
        </View>
      )}

      {step === 'done' && (
        <View style={styles.center}>
          <Text style={styles.doneIcon}>✅</Text>
          <Text style={styles.doneTitle}>¡Presentación exitosa!</Text>
          <Text style={styles.doneBody}>El verificador recibió y validó tu credencial.</Text>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: branding.primaryColor }]}
            onPress={() => {
              router.dismiss();
              router.replace('/(tabs)/credentials');
            }}
          >
            <Text style={styles.btnText}>Volver a mis credenciales</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'error' && (
        <View style={styles.center}>
          <Text style={styles.doneIcon}>❌</Text>
          <Text style={styles.doneTitle}>Error</Text>
          <Text style={styles.errorBody}>{errorMsg}</Text>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#DC2626' }]}
            onPress={() => router.back()}
          >
            <Text style={styles.btnText}>Volver</Text>
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
  qrBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  qrBoxEmpty: { width: 300, height: 160, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  qrBoxEmptyText: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dividerText: { marginHorizontal: 12, fontSize: 13, color: '#9CA3AF' },
});
