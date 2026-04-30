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
import { branding } from '../branding.config';
import { useAgentState } from '../src/agent/context';

type Step = 'resolving' | 'confirm' | 'qr' | 'presenting' | 'done' | 'error';

type RequestInfo = {
  verifier: string;
  purpose: string;
  requestedTypes: string[];
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
  const [resolvedRequest, setResolvedRequest] = useState<unknown>(null);
  const [compactSdJwt, setCompactSdJwt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (agentState.status !== 'ready') return;
    if (url) {
      resolveOID4VP();
    } else if (id) {
      loadCredentialQr();
    }
  }, [url, id, agentState.status]);

  const resolveOID4VP = async () => {
    if (agentState.status !== 'ready' || !url) return;
    const { agent } = agentState;
    try {
      const resolved = await agent.modules.openid4vc.holder.resolveOpenId4VpAuthorizationRequest(url);
      setResolvedRequest(resolved);

      const r = resolved as Record<string, unknown>;
      const verifierInfo = r.verifier as Record<string, string> | undefined;
      const verifier = verifierInfo?.effectiveClientId ?? 'Verificador';

      const pex = r.presentationExchange as Record<string, unknown> | undefined;
      const definition = pex?.definition as Record<string, unknown> | undefined;
      const purpose = (definition?.purpose as string | undefined) ?? 'Verificación de credencial';
      const inputDescriptors = definition?.input_descriptors as Array<Record<string, string>> | undefined;
      const requestedTypes = inputDescriptors?.map((d) => d.name ?? d.id ?? 'Credencial') ?? [];

      setRequestInfo({ verifier, purpose, requestedTypes });
      setStep('confirm');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al leer la solicitud.');
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
      const resolved = resolvedRequest as Record<string, unknown>;

      // Auto-select credentials for Presentation Exchange (PEX)
      let pexCredentials = undefined;
      const pex = resolved.presentationExchange as Record<string, unknown> | undefined;
      if (pex?.credentialsForRequest) {
        pexCredentials = agent.modules.openid4vc.holder.selectCredentialsForPresentationExchangeRequest(
          pex.credentialsForRequest as Parameters<
            typeof agent.modules.openid4vc.holder.selectCredentialsForPresentationExchangeRequest
          >[0]
        );
      }

      // Auto-select credentials for DCQL
      let dcqlCredentials = undefined;
      const dcql = resolved.dcql as Record<string, unknown> | undefined;
      if (dcql?.queryResult) {
        dcqlCredentials = agent.modules.openid4vc.holder.selectCredentialsForDcqlRequest(
          dcql.queryResult as Parameters<
            typeof agent.modules.openid4vc.holder.selectCredentialsForDcqlRequest
          >[0]
        );
      }

      await agent.modules.openid4vc.holder.acceptOpenId4VpAuthorizationRequest({
        authorizationRequestPayload: resolved.authorizationRequestPayload as Parameters<
          typeof agent.modules.openid4vc.holder.acceptOpenId4VpAuthorizationRequest
        >[0]['authorizationRequestPayload'],
        ...(pexCredentials ? { presentationExchange: { credentials: pexCredentials } } : {}),
        ...(dcqlCredentials ? { dcql: { credentials: dcqlCredentials } } : {}),
      });

      setStep('done');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al presentar la credencial.');
      setStep('error');
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      scrollEnabled={step === 'qr'}
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
              <QRCode
                value={compactSdJwt}
                size={260}
                color="#111827"
                backgroundColor="#fff"
              />
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
          <Text style={styles.doneBody}>
            El verificador recibió y validó tu credencial.
          </Text>
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
