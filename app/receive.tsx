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

type Step = 'resolving' | 'confirm' | 'accepting' | 'done' | 'error';

type OfferInfo = {
  issuer: string;
  credentials: string[];
};

export default function Receive() {
  const { url, mode } = useLocalSearchParams<{ url: string; mode?: string }>();
  const agentState = useAgentState();
  const [step, setStep] = useState<Step>('resolving');
  const [offerInfo, setOfferInfo] = useState<OfferInfo | null>(null);
  const [resolvedOffer, setResolvedOffer] = useState<unknown>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!url || agentState.status !== 'ready') return;
    if (mode === 'didcomm') {
      handleDIDCommOOB();
    } else {
      resolveOID4VCI();
    }
  }, [url, agentState.status]);

  const resolveOID4VCI = async () => {
    if (agentState.status !== 'ready') return;
    const { agent } = agentState;
    try {
      const offer = await agent.modules.openId4VcHolder.resolveCredentialOffer(url);
      setResolvedOffer(offer);

      const configs = offer.offeredCredentialConfigurations ?? {};
      const credNames = Object.values(configs).map(
        (c: unknown) => {
          const cfg = c as Record<string, unknown>;
          const display = cfg.display as Array<Record<string, string>> | undefined;
          return display?.[0]?.name ?? (cfg.vct as string) ?? 'Credencial';
        },
      );

      setOfferInfo({
        issuer: offer.metadata?.issuer ?? offer.credentialOfferPayload?.credential_issuer ?? 'Emisor desconocido',
        credentials: credNames,
      });
      setStep('confirm');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al resolver la oferta.');
      setStep('error');
    }
  };

  const acceptOID4VCI = async () => {
    if (agentState.status !== 'ready' || !resolvedOffer) return;
    const { agent } = agentState;
    setStep('accepting');
    try {
      const offer = resolvedOffer as Record<string, unknown>;
      const configs = (offer.offeredCredentialConfigurations ?? {}) as Record<string, unknown>;
      await agent.modules.openId4VcHolder.acceptCredentialOffer({
        resolvedCredentialOffer: resolvedOffer,
        acceptedCredentialConfigurations: Object.fromEntries(
          Object.keys(configs).map((id) => [id, {}]),
        ),
      });
      setStep('done');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al aceptar la oferta.');
      setStep('error');
    }
  };

  // Phase 4: DIDComm OOB — auto-accept connection and wait for credential offer
  const handleDIDCommOOB = async () => {
    if (agentState.status !== 'ready') return;
    const { agent } = agentState;
    setStep('accepting');
    try {
      // Parse OOB invitation from URL query param ?d_m= or ?oob=
      const parsed = new URL(url.replace(/\?/, 'http://x.co?'));
      const encoded = parsed.searchParams.get('d_m') ?? parsed.searchParams.get('oob');
      if (!encoded) throw new Error('No se encontró la invitación DIDComm en el QR.');

      const invitation = JSON.parse(
        Buffer.from(encoded, 'base64').toString('utf-8'),
      );

      await agent.oob.receiveInvitation(invitation);
      setStep('done');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al procesar la invitación DIDComm.');
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
          <Text style={styles.statusText}>Leyendo oferta de credencial...</Text>
        </View>
      )}

      {step === 'confirm' && offerInfo && (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>Emisor</Text>
            <Text style={styles.value}>{offerInfo.issuer}</Text>
            <Text style={[styles.label, { marginTop: 16 }]}>Credenciales ofrecidas</Text>
            {offerInfo.credentials.map((name, i) => (
              <View key={i} style={styles.credRow}>
                <Text style={styles.credName}>🪪  {name}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: branding.primaryColor }]}
            onPress={acceptOID4VCI}
          >
            <Text style={styles.btnText}>Aceptar y guardar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
        </>
      )}

      {step === 'accepting' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={branding.primaryColor} />
          <Text style={styles.statusText}>
            {mode === 'didcomm'
              ? 'Conectando con el emisor...'
              : 'Recibiendo credencial...'}
          </Text>
        </View>
      )}

      {step === 'done' && (
        <View style={styles.center}>
          <Text style={styles.doneIcon}>✅</Text>
          <Text style={styles.doneTitle}>
            {mode === 'didcomm'
              ? '¡Conexión establecida!'
              : '¡Credencial recibida!'}
          </Text>
          <Text style={styles.doneBody}>
            {mode === 'didcomm'
              ? 'El emisor enviará la credencial. Revisa tu lista en unos momentos.'
              : 'La credencial fue guardada en tu billetera.'}
          </Text>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: branding.primaryColor }]}
            onPress={() => {
              router.dismiss();
              router.replace('/(tabs)/credentials');
            }}
          >
            <Text style={styles.btnText}>Ver mis credenciales</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'error' && (
        <View style={styles.center}>
          <Text style={styles.doneIcon}>❌</Text>
          <Text style={styles.doneTitle}>Error</Text>
          <Text style={styles.errorBody}>{errorMsg}</Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: '#DC2626' }]} onPress={() => router.back()}>
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
  card: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  label: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  value: { fontSize: 15, color: '#111827' },
  credRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB', marginTop: 4 },
  credName: { fontSize: 15, color: '#111827' },
  btn: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { height: 44, justifyContent: 'center', alignItems: 'center' },
  cancelText: { color: '#6B7280', fontSize: 15 },
  doneIcon: { fontSize: 56, marginBottom: 16 },
  doneTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  doneBody: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  errorBody: { fontSize: 14, color: '#DC2626', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
});
