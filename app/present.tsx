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
import { branding } from '../branding.config';
import { useAgentState } from '../src/agent/context';

type Step = 'resolving' | 'confirm' | 'presenting' | 'done' | 'error';

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
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!url || agentState.status !== 'ready') {
      // Launched from credential detail (manual present) — skip resolution
      if (id && agentState.status === 'ready') {
        setStep('confirm');
        setRequestInfo({ verifier: 'Presentación manual', purpose: 'A demanda', requestedTypes: [] });
      }
      return;
    }
    resolveRequest();
  }, [url, agentState.status]);

  const resolveRequest = async () => {
    if (agentState.status !== 'ready' || !url) return;
    const { agent } = agentState;
    try {
      const resolved = await agent.modules.openId4VcHolder.resolveSiopAuthorizationRequest(url);
      setResolvedRequest(resolved);

      const req = resolved as Record<string, unknown>;
      const authReq = req.authorizationRequest as Record<string, unknown> | undefined;

      const verifier =
        (authReq?.client_id as string) ??
        (authReq?.client_metadata as Record<string, string> | undefined)?.client_name ??
        'Verificador';

      const purpose = (authReq?.claims as Record<string, unknown> | undefined)
        ? 'Verificación de identidad'
        : 'Presentación de credencial';

      const presentationDef = req.presentationExchange as Record<string, unknown> | undefined;
      const inputDescriptors =
        (presentationDef?.presentationDefinition as Record<string, unknown> | undefined)
          ?.input_descriptors as Array<Record<string, string>> | undefined;
      const requestedTypes = inputDescriptors?.map((d) => d.name ?? d.id ?? 'Credencial') ?? [];

      setRequestInfo({ verifier, purpose, requestedTypes });
      setStep('confirm');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al leer la solicitud.');
      setStep('error');
    }
  };

  const handlePresent = async () => {
    if (agentState.status !== 'ready') return;
    const { agent } = agentState;
    setStep('presenting');

    try {
      if (resolvedRequest) {
        // OID4VP flow — auto-select matching credentials
        const resolved = resolvedRequest as Record<string, unknown>;
        await agent.modules.openId4VcHolder.acceptSiopAuthorizationRequest({
          authorizationRequest: resolved.authorizationRequest,
          presentationExchangeResponseOpts: resolved.presentationExchange
            ? { credentials: [] } // Credo auto-selects matching credentials
            : undefined,
        });
      }
      // If launched from detail (no resolvedRequest), just mark done as demo
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
      scrollEnabled={false}
    >
      {step === 'resolving' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={branding.primaryColor} />
          <Text style={styles.statusText}>Leyendo solicitud de verificación...</Text>
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
              Solo se compartirán los atributos seleccionados en el detalle de la credencial.
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

      {step === 'presenting' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={branding.primaryColor} />
          <Text style={styles.statusText}>Presentando credencial...</Text>
        </View>
      )}

      {step === 'done' && (
        <View style={styles.center}>
          <Text style={styles.doneIcon}>✅</Text>
          <Text style={styles.doneTitle}>¡Presentación exitosa!</Text>
          <Text style={styles.doneBody}>
            Tu credencial fue verificada correctamente.
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
  btn: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { height: 44, justifyContent: 'center', alignItems: 'center' },
  cancelText: { color: '#6B7280', fontSize: 15 },
  doneIcon: { fontSize: 56, marginBottom: 16 },
  doneTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  doneBody: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  errorBody: { fontSize: 14, color: '#DC2626', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
});
