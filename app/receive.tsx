import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SdJwtVcRecord, W3cCredentialRecord } from '@credo-ts/core';
import { branding } from '../branding.config';
import { useAgentState } from '../src/agent/context';
import { credentialBindingResolver } from '../src/agent/credentialBinding';

const PRE_AUTH_GRANT = 'urn:ietf:params:oauth:grant-type:pre-authorized_code';

const formatConfigId = (id: string): string => {
  const clean = id.replace(/[-_](sdjwt|sd[-_]jwt|jwt|vc|mdoc)$/i, '');
  return clean
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

type Step = 'resolving' | 'confirm' | 'accepting' | 'done' | 'error';

type OfferInfo = {
  issuer: string;
  credentials: string[];
  txCodeRequired: boolean;
  txCodeDescription?: string;
};

export default function Receive() {
  const { url, mode } = useLocalSearchParams<{ url: string; mode?: string }>();
  const agentState = useAgentState();
  const [step, setStep] = useState<Step>('resolving');
  const [offerInfo, setOfferInfo] = useState<OfferInfo | null>(null);
  const [resolvedOffer, setResolvedOffer] = useState<unknown>(null);
  const [txCode, setTxCode] = useState('');
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
      const offer = await agent.modules.openid4vc.holder.resolveCredentialOffer(url);
      setResolvedOffer(offer);

      const configs = offer.offeredCredentialConfigurations ?? {};
      const credNames = Object.entries(configs).map(([configId, c]: [string, unknown]) => {
        const cfg = c as Record<string, unknown>;
        // Check top-level display, then credential_metadata.display (CREDEBL), then format config ID
        const display = cfg.display as Array<Record<string, string>> | undefined;
        const metaDisplay = (cfg.credential_metadata as Record<string, unknown> | undefined)
          ?.display as Array<Record<string, string>> | undefined;
        return display?.[0]?.name ?? metaDisplay?.[0]?.name ?? formatConfigId(configId);
      });

      // Extract human-readable issuer name from display metadata
      const credentialIssuer = (offer.metadata as Record<string, unknown>)
        ?.credentialIssuer as Record<string, unknown> | undefined;
      const issuerDisplay = credentialIssuer?.display as Array<Record<string, string>> | undefined;
      const issuerName =
        issuerDisplay?.[0]?.name ??
        (credentialIssuer?.credential_issuer as string | undefined) ??
        offer.credentialOfferPayload?.credential_issuer ??
        'Emisor desconocido';

      const preAuthGrant = (offer.credentialOfferPayload?.grants as Record<string, unknown> | undefined)?.[PRE_AUTH_GRANT] as Record<string, unknown> | undefined;
      const txCodeInfo = preAuthGrant?.tx_code as Record<string, unknown> | undefined;
      const txCodeRequired = typeof txCodeInfo === 'object' && txCodeInfo !== null;

      setOfferInfo({
        issuer: issuerName,
        credentials: credNames,
        txCodeRequired,
        txCodeDescription: txCodeInfo?.description as string | undefined,
      });
      setStep('confirm');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al resolver la oferta.');
      setStep('error');
    }
  };

  const acceptOID4VCI = async () => {
    if (agentState.status !== 'ready' || !resolvedOffer || !offerInfo) return;
    if (offerInfo.txCodeRequired && !txCode.trim()) return;
    const { agent } = agentState;
    setStep('accepting');
    try {
      const holder = agent.modules.openid4vc.holder;
      const { accessToken, cNonce, dpop } = await holder.requestToken({
        resolvedCredentialOffer: resolvedOffer,
        ...(offerInfo.txCodeRequired ? { txCode: txCode.trim() } : {}),
      });
      const { credentials } = await holder.requestCredentials({
        resolvedCredentialOffer: resolvedOffer,
        accessToken,
        cNonce,
        dpop,
        credentialBindingResolver,
      });
      for (const { record, credentialConfigurationId } of credentials) {
        if (record instanceof SdJwtVcRecord) {
          const stored = await agent.sdJwtVc.store({ record });
          stored.setTag('issuerName', offerInfo.issuer);
          stored.setTag('credentialName', formatConfigId(credentialConfigurationId));
          await agent.sdJwtVc.update(stored);
        } else if (record instanceof W3cCredentialRecord) {
          await agent.w3cCredentials.store({ record });
        }
      }
      setStep('done');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Error al aceptar la oferta.');
      setStep('error');
    }
  };

  const handleDIDCommOOB = async () => {
    setErrorMsg('El flujo DIDComm no está disponible en esta versión. Usa OID4VCI para recibir credenciales.');
    setStep('error');
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

          {offerInfo.txCodeRequired && (
            <View style={styles.txCodeBox}>
              <Text style={styles.txCodeLabel}>
                {offerInfo.txCodeDescription ?? 'El emisor requiere un código de transacción'}
              </Text>
              <TextInput
                style={styles.txCodeInput}
                value={txCode}
                onChangeText={setTxCode}
                placeholder="Código enviado por el emisor"
                placeholderTextColor="#9CA3AF"
                keyboardType="default"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.btn,
              { backgroundColor: branding.primaryColor },
              offerInfo.txCodeRequired && !txCode.trim() && styles.btnDisabled,
            ]}
            disabled={offerInfo.txCodeRequired && !txCode.trim()}
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
          <Text style={styles.statusText}>Recibiendo credencial...</Text>
        </View>
      )}

      {step === 'done' && (
        <View style={styles.center}>
          <Text style={styles.doneIcon}>✅</Text>
          <Text style={styles.doneTitle}>¡Credencial recibida!</Text>
          <Text style={styles.doneBody}>La credencial fue guardada en tu billetera.</Text>
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
    marginBottom: 16,
  },
  label: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  value: { fontSize: 15, color: '#111827' },
  credRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB', marginTop: 4 },
  credName: { fontSize: 15, color: '#111827' },
  txCodeBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  txCodeLabel: { fontSize: 13, color: '#92400E', marginBottom: 10, lineHeight: 18 },
  txCodeInput: {
    borderWidth: 1.5,
    borderColor: '#D97706',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#fff',
  },
  btn: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { height: 44, justifyContent: 'center', alignItems: 'center' },
  cancelText: { color: '#6B7280', fontSize: 15 },
  doneIcon: { fontSize: 56, marginBottom: 16 },
  doneTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  doneBody: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  errorBody: { fontSize: 14, color: '#DC2626', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
});
