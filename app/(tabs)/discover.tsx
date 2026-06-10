import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { branding, discoveryConfig, trustRegistry } from '../../branding.config';
import { useUser } from '../../src/auth/UserContext';
import { getOidcIdToken } from '../../src/utils/storage';
import { checkTrust, TRUST_COLORS, TRUST_ICONS, type TrustStatus } from '../../src/agent/trust';

// Shapes returned by the hub catalog: GET ${hubUrl}/api/v1/discovery/credentials
// → { issuers: [{ did, name, service_endpoint, credentials: [...] }] }.
type CatalogCredential = {
  id: string;
  format?: string;
  display?: string;
  issuer?: string;
  claims?: string[];
};
type CatalogIssuer = {
  did: string;
  name?: string;
  service_endpoint?: string;
  credentials: CatalogCredential[] | null;
};

export default function Discover() {
  const { t } = useTranslation();
  const { user, refreshUser } = useUser();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorKey, setErrorKey] = useState<'error' | 'error_unavailable'>('error');
  const [issuers, setIssuers] = useState<CatalogIssuer[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setState('loading');
    try {
      const resp = await fetch(`${discoveryConfig.hubUrl}/api/v1/discovery/credentials`);
      if (!resp.ok) throw new Error(`catalog ${resp.status}`);
      const data = (await resp.json()) as { issuers?: CatalogIssuer[] };
      setIssuers(Array.isArray(data.issuers) ? data.issuers : []);
      setState('ready');
    } catch (e) {
      console.error('[discover] load failed:', e);
      setErrorKey(e instanceof TypeError ? 'error_unavailable' : 'error');
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (discoveryConfig.enabled && user) load();
    else if (!user) setState('ready');
  }, [load, user]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  // Obtener: present the citizen's verified id_token to the issuing member's
  // self-service endpoint. On success it returns a pre-auth credential offer we
  // hand straight to the existing /receive (OID4VCI) flow.
  const onGet = async (issuer: CatalogIssuer, cred: CatalogCredential) => {
    await refreshUser().catch(() => {}); // best-effort: ensure the id_token isn't stale
    const idToken = await getOidcIdToken();
    if (!idToken) {
      Alert.alert(t('discover.title'), t('discover.login_required'));
      return;
    }
    const base = (issuer.service_endpoint ?? '').replace(/\/$/, '');
    if (!base) {
      Alert.alert(t('discover.title'), t('discover.issue_error'));
      return;
    }
    setBusyId(cred.id);
    try {
      const resp = await fetch(`${base}/api/v1/credentials/self-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken, credential_configuration_id: cred.id }),
      });
      if (resp.status === 403) {
        Alert.alert(t('discover.title'), t('discover.not_eligible'));
        return;
      }
      if (!resp.ok) throw new Error(`self-issue ${resp.status}`);
      const data = (await resp.json()) as { offer_uri?: string };
      if (!data.offer_uri) throw new Error('no offer_uri in response');
      router.push({ pathname: '/receive', params: { url: data.offer_uri } });
    } catch (e) {
      console.error('[discover] self-issue failed:', e);
      Alert.alert(t('discover.title'), t('discover.issue_error'));
    } finally {
      setBusyId(null);
    }
  };

  if (state === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={branding.primaryColor} />
        <Text style={styles.statusText}>{t('discover.loading')}</Text>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.bigIcon}>📡</Text>
        <Text style={styles.errorText}>{t(`discover.${errorKey}`)}</Text>
        <TouchableOpacity style={[styles.btn, { backgroundColor: branding.primaryColor }]} onPress={() => load()}>
          <Text style={styles.btnText}>{t('discover.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.center}>
        <Text style={styles.bigIcon}>🔐</Text>
        <Text style={styles.loginRequiredTitle}>{t('discover.login_required_title')}</Text>
        <Text style={styles.loginRequiredBody}>{t('discover.login_required_body')}</Text>
      </View>
    );
  }

  const hasAny = issuers.some((i) => (i.credentials?.length ?? 0) > 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={branding.primaryColor} />}
    >
      <Text style={styles.subtitle}>{t('discover.subtitle')}</Text>

      {!hasAny && <Text style={styles.empty}>{t('discover.empty')}</Text>}

      {issuers.map((issuer) => {
        const creds = issuer.credentials ?? [];
        if (creds.length === 0) return null;
        const trust: TrustStatus = checkTrust(issuer.service_endpoint ?? issuer.did, trustRegistry);
        return (
          <View key={issuer.did} style={styles.issuerSection}>
            <View style={styles.issuerHeader}>
              <Text style={styles.issuerName} numberOfLines={1}>
                {issuer.name || issuer.did}
              </Text>
              <View style={[styles.trustBadge, { backgroundColor: TRUST_COLORS[trust] + '1A', borderColor: TRUST_COLORS[trust] }]}>
                <Text style={[styles.trustBadgeText, { color: TRUST_COLORS[trust] }]}>
                  {TRUST_ICONS[trust]} {t(`trust.${trust}`)}
                </Text>
              </View>
            </View>

            {creds.map((cred) => {
              const busy = busyId === cred.id;
              return (
                <View key={cred.id} style={styles.credCard}>
                  <View style={styles.credInfo}>
                    <Text style={styles.credName}>🪪  {cred.display || cred.id}</Text>
                    {!!cred.claims?.length && (
                      <Text style={styles.credClaims} numberOfLines={2}>
                        {t('discover.includes')}: {cred.claims.join(', ')}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[styles.getBtn, { backgroundColor: branding.primaryColor }, busy && styles.btnDisabled]}
                    disabled={busy || !!busyId}
                    onPress={() => onGet(issuer, cred)}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.getBtnText}>{t('discover.get_btn')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  statusText: { marginTop: 16, fontSize: 15, color: '#6B7280' },
  bigIcon: { fontSize: 48, marginBottom: 12 },
  errorText: { fontSize: 15, color: '#6B7280', textAlign: 'center', marginBottom: 20 },
  subtitle: { fontSize: 14, color: '#6B7280', lineHeight: 20, marginBottom: 16 },
  empty: { fontSize: 15, color: '#9CA3AF', textAlign: 'center', marginTop: 40 },
  loginRequiredTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 10, textAlign: 'center' },
  loginRequiredBody: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },
  issuerSection: { marginBottom: 24 },
  issuerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  issuerName: { fontSize: 13, fontWeight: '700', color: '#374151', flex: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  trustBadge: { flexDirection: 'row', alignItems: 'center', borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  trustBadgeText: { fontSize: 11, fontWeight: '600' },
  credCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 12, padding: 16, marginBottom: 10, gap: 12 },
  credInfo: { flex: 1 },
  credName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  credClaims: { fontSize: 12, color: '#6B7280', marginTop: 4, lineHeight: 16 },
  getBtn: { minWidth: 84, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  getBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  btn: { height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
