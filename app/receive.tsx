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
import { useTranslation } from 'react-i18next';
import type { OpenId4VciResolvedCredentialOffer } from '@credo-ts/openid4vc';
import { branding, trustRegistry } from '../branding.config';
import { useAgentState } from '../src/agent/context';
import i18n from '../src/i18n';
import { checkTrust, TRUST_COLORS, TRUST_ICONS, type TrustStatus } from '../src/agent/trust';
import { normalizeOffer } from '../src/agent/oid4vci/normalizeOffer';
import { requestOid4VciCredentials } from '../src/agent/oid4vci/requestCredentials';
import { storeOid4VciCredential, formatConfigId } from '../src/agent/oid4vci/storeCredential';

const PRE_AUTH_GRANT = 'urn:ietf:params:oauth:grant-type:pre-authorized_code';

async function resolveHttpCredentialOffer(offerUri: string): Promise<Record<string, unknown>> {
  console.log('[receive] resolveHttpCredentialOffer — offer URI:', offerUri);
  const offerResp = await fetch(offerUri);
  if (!offerResp.ok) {
    if (offerResp.status === 404 || offerResp.status === 410) {
      throw new Error(i18n.t('receive.offer_expired'));
    }
    throw new Error(i18n.t('receive.fetch_error', { status: offerResp.status }));
  }
  const offerPayload = await offerResp.json() as Record<string, unknown>;

  const issuerUrl = (offerPayload.credential_issuer as string | undefined)?.replace(/\/$/, '');
  if (!issuerUrl) throw new Error('credential_issuer missing from offer payload');

  console.log('[receive] resolveHttpCredentialOffer — credential_issuer:', issuerUrl);
  const wellKnownResp = await fetch(`${issuerUrl}/.well-known/openid-credential-issuer`);
  console.log('[receive] resolveHttpCredentialOffer — well-known status:', wellKnownResp.status);
  if (!wellKnownResp.ok) throw new Error(`Failed to fetch issuer metadata (${wellKnownResp.status})`);
  const issuerMeta = await wellKnownResp.json() as Record<string, unknown>;

  const configsSupported = (issuerMeta.credential_configurations_supported ?? {}) as Record<string, unknown>;
  const offeredIds = (offerPayload.credential_configuration_ids as string[] | undefined) ?? [];

  const offeredConfigs: Record<string, unknown> = {};
  for (const id of offeredIds) {
    if (configsSupported[id]) offeredConfigs[id] = configsSupported[id];
  }

  return {
    credentialOfferPayload: offerPayload,
    metadata: {
      credentialIssuer: issuerMeta,
      originalDraftVersion: 'Draft15',
      knownCredentialConfigurations: configsSupported,
    },
    offeredCredentialConfigurations: offeredConfigs,
  };
}

type Step = 'resolving' | 'confirm' | 'accepting' | 'done' | 'error';

type OfferInfo = {
  issuer: string;
  credentials: string[];
  txCodeRequired: boolean;
  txCodeDescription?: string;
};

export default function Receive() {
  const { t } = useTranslation();
  const { url, mode } = useLocalSearchParams<{ url: string; mode?: string }>();
  const agentState = useAgentState();
  const [step, setStep] = useState<Step>('resolving');
  const [offerInfo, setOfferInfo] = useState<OfferInfo | null>(null);
  const [normalizedOffer, setNormalizedOffer] = useState<Record<string, unknown> | null>(null);
  const [txCode, setTxCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [issuerTrust, setIssuerTrust] = useState<TrustStatus>('unknown');

  useEffect(() => {
    if (!url || agentState.status !== 'ready') return;
    if (mode === 'didcomm') {
      setErrorMsg(t('receive.didcomm_unsupported'));
      setStep('error');
    } else {
      resolveOID4VCI();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, agentState.status]);

  const resolveOID4VCI = async () => {
    if (agentState.status !== 'ready') return;
    const { agent } = agentState;
    try {
      const offerUriParam = url.includes('credential_offer_uri=')
        ? url.slice(url.indexOf('credential_offer_uri=') + 'credential_offer_uri='.length).split('&')[0]
        : '';
      const offerUri = decodeURIComponent(offerUriParam);
      const isHttpOffer = !branding.requireHttps && offerUri.startsWith('http://');

      let rawOffer: OpenId4VciResolvedCredentialOffer;
      if (isHttpOffer) {
        rawOffer = await resolveHttpCredentialOffer(offerUri) as unknown as OpenId4VciResolvedCredentialOffer;
      } else {
        try {
          rawOffer = await agent.modules.openid4vc.holder.resolveCredentialOffer(url);
        } catch (e) {
          // The offer_uri may be HTTPS but the returned payload contains an
          // http:// credential_issuer that Credo rejects. Fall back to the
          // manual resolver (which skips the https constraint) when allowed.
          if (!branding.requireHttps && e instanceof Error && e.message.includes('Url must be an https://')) {
            rawOffer = await resolveHttpCredentialOffer(offerUri) as unknown as OpenId4VciResolvedCredentialOffer;
          } else {
            throw e;
          }
        }
      }

      const offer = normalizeOffer(rawOffer);
      setNormalizedOffer(offer);

      const offerMeta = offer.metadata as Record<string, unknown>;
      const credentialIssuer = offerMeta?.credentialIssuer as Record<string, unknown> | undefined;
      const issuerDisplay = credentialIssuer?.display as Array<Record<string, string>> | undefined;

      const configs = (offer.offeredCredentialConfigurations as Record<string, unknown> | undefined) ?? {};

      const firstConfigDesc = (Object.values(configs)[0] as Record<string, unknown> | undefined);
      const firstDisplayDesc = (firstConfigDesc?.display as Array<Record<string, string>> | undefined)?.[0]?.description;
      const issuerFromDesc = firstDisplayDesc?.includes(' · ')
        ? firstDisplayDesc.split(' · ').pop()?.replace(/^Issued by /i, '') || undefined
        : undefined;

      const issuerName =
        issuerDisplay?.[0]?.name ??
        issuerFromDesc ??
        (credentialIssuer?.credential_issuer as string | undefined) ??
        (rawOffer.credentialOfferPayload?.credential_issuer as string | undefined) ??
        t('receive.unknown_issuer');

      const credNames = Object.entries(configs).map(([configId, c]) => {
        const cfg = c as Record<string, unknown>;
        const display = cfg.display as Array<Record<string, string>> | undefined;
        const metaDisplay = (cfg.credential_metadata as Record<string, unknown> | undefined)
          ?.display as Array<Record<string, string>> | undefined;
        return display?.[0]?.name ?? metaDisplay?.[0]?.name ?? formatConfigId(configId);
      });

      const preAuthGrant = (rawOffer.credentialOfferPayload?.grants as Record<string, unknown> | undefined)?.[PRE_AUTH_GRANT] as Record<string, unknown> | undefined;
      const txCodeInfo = preAuthGrant?.tx_code as Record<string, unknown> | undefined;

      const rawIssuerUrl =
        (credentialIssuer?.credential_issuer as string | undefined) ??
        (rawOffer.credentialOfferPayload?.credential_issuer as string | undefined) ?? '';
      setIssuerTrust(checkTrust(rawIssuerUrl, trustRegistry));

      setOfferInfo({
        issuer: issuerName,
        credentials: credNames,
        txCodeRequired: typeof txCodeInfo === 'object' && txCodeInfo !== null,
        txCodeDescription: txCodeInfo?.description as string | undefined,
      });
      setStep('confirm');
    } catch (e: unknown) {
      console.error('[receive] resolveOID4VCI FAILED:', e);
      setErrorMsg(e instanceof Error ? e.message : t('receive.resolve_error'));
      setStep('error');
    }
  };

  const acceptOID4VCI = async () => {
    if (agentState.status !== 'ready' || !normalizedOffer || !offerInfo) return;
    if (offerInfo.txCodeRequired && !txCode.trim()) return;
    const { agent } = agentState;
    setStep('accepting');
    try {
      const holder = agent.modules.openid4vc.holder;

      const issuerMeta = (normalizedOffer.metadata as Record<string, unknown>)
        ?.credentialIssuer as Record<string, unknown> | undefined;
      const tokenEndpoint = issuerMeta?.token_endpoint as string | undefined;

      let accessToken: string;
      let cNonce: string | undefined;
      let dpop: unknown;

      if (!branding.requireHttps && tokenEndpoint?.startsWith('http://')) {
        const offerPayload = normalizedOffer.credentialOfferPayload as Record<string, unknown>;
        const preAuth = (offerPayload?.grants as Record<string, unknown> | undefined)
          ?.[PRE_AUTH_GRANT] as Record<string, unknown> | undefined;
        const preAuthCode = preAuth?.['pre-authorized_code'] as string;

        const body = new URLSearchParams({ grant_type: PRE_AUTH_GRANT, 'pre-authorized_code': preAuthCode });
        if (offerInfo.txCodeRequired && txCode.trim()) body.set('tx_code', txCode.trim());

        const resp = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        if (!resp.ok) throw new Error(`Token request failed (${resp.status}): ${await resp.text()}`);
        const data = await resp.json() as Record<string, unknown>;
        accessToken = data.access_token as string;
        cNonce = data.c_nonce as string | undefined;
        console.log('[receive] token ok (manual HTTP), cNonce:', cNonce);
      } else {
        const tokenResp = await holder.requestToken({
          resolvedCredentialOffer: normalizedOffer as unknown as OpenId4VciResolvedCredentialOffer,
          ...(offerInfo.txCodeRequired ? { txCode: txCode.trim() } : {}),
        });
        accessToken = tokenResp.accessToken;
        cNonce = tokenResp.cNonce;
        dpop = tokenResp.dpop;
        console.log('[receive] token ok, cNonce:', cNonce);
      }

      const results = await requestOid4VciCredentials(agent, normalizedOffer, { accessToken, cNonce, dpop });

      for (const result of results) {
        await storeOid4VciCredential(agent, result, { issuerName: offerInfo.issuer });
      }

      setStep('done');
    } catch (e: unknown) {
      console.error('[receive] acceptOID4VCI FAILED:', e);
      setErrorMsg(e instanceof Error ? e.message : t('receive.accept_error'));
      setStep('error');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} scrollEnabled={false}>
      {step === 'resolving' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={branding.primaryColor} />
          <Text style={styles.statusText}>{t('receive.loading')}</Text>
        </View>
      )}

      {step === 'confirm' && offerInfo && (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>{t('receive.label_issuer')}</Text>
            <View style={styles.trustRow}>
              <Text style={styles.value}>{offerInfo.issuer}</Text>
              <View style={[styles.trustBadge, { backgroundColor: TRUST_COLORS[issuerTrust] + '1A', borderColor: TRUST_COLORS[issuerTrust] }]}>
                <Text style={[styles.trustBadgeText, { color: TRUST_COLORS[issuerTrust] }]}>
                  {TRUST_ICONS[issuerTrust]} {t(`trust.${issuerTrust}`)}
                </Text>
              </View>
            </View>
            <Text style={[styles.label, { marginTop: 16 }]}>{t('receive.label_offered')}</Text>
            {offerInfo.credentials.map((name, i) => (
              <View key={i} style={styles.credRow}>
                <Text style={styles.credName}>🪪  {name}</Text>
              </View>
            ))}
          </View>

          {offerInfo.txCodeRequired && (
            <View style={styles.txCodeBox}>
              <Text style={styles.txCodeLabel}>
                {t('receive.tx_code_default')}
              </Text>
              <TextInput
                style={styles.txCodeInput}
                value={txCode}
                onChangeText={setTxCode}
                placeholder={t('receive.tx_code_placeholder')}
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
            <Text style={styles.btnText}>{t('receive.accept_btn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </>
      )}

      {step === 'accepting' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={branding.primaryColor} />
          <Text style={styles.statusText}>{t('receive.accepting')}</Text>
        </View>
      )}

      {step === 'done' && (
        <View style={styles.center}>
          <Text style={styles.doneIcon}>✅</Text>
          <Text style={styles.doneTitle}>{t('receive.success_title')}</Text>
          <Text style={styles.doneBody}>{t('receive.success_body')}</Text>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: branding.primaryColor }]}
            onPress={() => { router.dismiss(); router.replace('/(tabs)/credentials'); }}
          >
            <Text style={styles.btnText}>{t('receive.view_btn')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'error' && (
        <View style={styles.center}>
          <Text style={styles.doneIcon}>❌</Text>
          <Text style={styles.doneTitle}>{t('common.error')}</Text>
          <Text style={styles.errorBody}>{errorMsg}</Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: '#DC2626' }]} onPress={() => router.back()}>
            <Text style={styles.btnText}>{t('receive.back_btn')}</Text>
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
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  trustBadge: { flexDirection: 'row', alignItems: 'center', borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  trustBadgeText: { fontSize: 12, fontWeight: '600' },
  value: { fontSize: 15, color: '#111827', flex: 1 },
  credRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB', marginTop: 4 },
  credName: { fontSize: 15, color: '#111827' },
  txCodeBox: { backgroundColor: '#FFFBEB', borderRadius: 10, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#FDE68A' },
  txCodeLabel: { fontSize: 13, color: '#92400E', marginBottom: 10, lineHeight: 18 },
  txCodeInput: { borderWidth: 1.5, borderColor: '#D97706', borderRadius: 8, padding: 12, fontSize: 16, color: '#111827', backgroundColor: '#fff' },
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
