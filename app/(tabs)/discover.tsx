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
import { getOidcAccessToken, getOidcIdToken } from '../../src/utils/storage';
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

// isJwtExpired decodes the payload of a JWT (base64url, no signature check) and
// returns true when the exp claim is within 60 s of expiry or already past.
// The 60 s buffer ensures the wallet refreshes proactively before the server
// rejects the token, absorbing clock skew and network latency.
// Returns false on malformed tokens so the server gets a chance to decide.
const JWT_EXPIRY_BUFFER_MS = 60_000;
function isJwtExpired(token: string): boolean {
  try {
    const part = token.split('.')[1];
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + JWT_EXPIRY_BUFFER_MS;
  } catch {
    return false;
  }
}

// tokenHasNationalId decodes the JWT payload (no signature check — client-side
// only) and returns true when the token carries a national-ID-equivalent claim.
// Covers the same aliases as verifiably-go identity_prefill.go so the gating
// decision and the server's eligibility check stay in lockstep.
function tokenHasNationalId(token: string): boolean {
  try {
    const part = token.split('.')[1];
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(base64)) as Record<string, unknown>;
    return !!(p.national_id || p.nationalId || p.cedula || p.dni);
  } catch {
    return false;
  }
}

// EligibilityMap maps "serviceEndpoint|credentialId" → true for eligible credentials.
type EligibilityMap = Set<string>;

function eligibilityKey(serviceEndpoint: string, credId: string): string {
  return `${serviceEndpoint}|${credId}`;
}

export default function Discover() {
  const { t } = useTranslation();
  const { user, refreshUser } = useUser();
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'no_national_id'>('loading');
  const [errorKey, setErrorKey] = useState<'error' | 'error_unavailable'>('error');
  const [issuers, setIssuers] = useState<CatalogIssuer[]>([]);
  const [eligibility, setEligibility] = useState<EligibilityMap | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setState('loading');
    try {
      // Verify the citizen has a national_id before fetching the catalog.
      // Without it they cannot self-issue any credential, so show a clear
      // "verify your identity" screen rather than an empty list.
      await refreshUser().catch(() => {});
      let token = await getOidcAccessToken() ?? await getOidcIdToken();
      // Force a real IdP refresh if the JWT is near-expiry/expired or doesn't
      // carry national_id yet (stale stored expiry or pre-mapper token).
      if (!token || isJwtExpired(token) || !tokenHasNationalId(token)) {
        const refreshOk = await refreshUser(true).catch(() => false);
        if (refreshOk) token = await getOidcAccessToken() ?? await getOidcIdToken();
      }
      // If we still don't have a token with national_id, block with the
      // appropriate screen.
      if (!token || !tokenHasNationalId(token)) {
        setState('no_national_id');
        return;
      }
      // If the session is truly expired (refresh_token also gone), tell the
      // user to sign in again rather than silently calling APIs with a dead token.
      if (isJwtExpired(token)) {
        setErrorKey('error');
        setState('error');
        return;
      }

      const resp = await fetch(`${discoveryConfig.hubUrl}/api/v1/discovery/credentials`);
      if (!resp.ok) throw new Error(`catalog ${resp.status}`);
      const data = (await resp.json()) as { issuers?: CatalogIssuer[] };
      const loadedIssuers = Array.isArray(data.issuers) ? data.issuers : [];
      setIssuers(loadedIssuers);

      // Check eligibility per issuer. Failures are non-fatal: if a check
      // fails, we still show eligible credentials from other issuers and the
      // server enforces eligibility at self-issue time anyway.
      const eligible = new Set<string>();
      await Promise.all(
        loadedIssuers.map(async (issuer) => {
          const base = (issuer.service_endpoint ?? '').replace(/\/$/, '');
          if (!base) return;
          try {
            const er = await fetch(`${base}/api/v1/credentials/eligible`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ access_token: token }),
            });
            if (!er.ok) {
              console.warn('[discover] eligibility fetch failed', base, er.status);
              return;
            }
            const ed = (await er.json()) as { credentials?: { id: string; available: boolean }[] };
            for (const c of ed.credentials ?? []) {
              if (c.available) eligible.add(eligibilityKey(base, c.id));
            }
          } catch (e) {
            console.warn('[discover] eligibility error', base, e);
          }
        })
      );
      setEligibility(eligible);
      setState('ready');
    } catch (e) {
      console.error('[discover] load failed:', e);
      setErrorKey(e instanceof TypeError ? 'error_unavailable' : 'error');
      setState('error');
    }
  }, [refreshUser]);

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
    await refreshUser().catch(() => {}); // ensures access_token is current
    const accessToken = await getOidcAccessToken() ?? await getOidcIdToken();
    if (!accessToken) {
      Alert.alert(t('discover.title'), t('discover.login_required'));
      return;
    }
    // If the refresh failed (e.g. refresh_token also expired), the stored
    // access_token may still be expired. Catch it before the server does.
    if (isJwtExpired(accessToken)) {
      Alert.alert(t('discover.title'), t('discover.session_expired'));
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
        body: JSON.stringify({ access_token: accessToken, credential_configuration_id: cred.id }),
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

  if (state === 'no_national_id') {
    return (
      <View style={styles.center}>
        <Text style={styles.bigIcon}>🪪</Text>
        <Text style={styles.loginRequiredTitle}>{t('discover.no_national_id_title')}</Text>
        <Text style={styles.loginRequiredBody}>{t('discover.no_national_id_body')}</Text>
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
        const base = (issuer.service_endpoint ?? '').replace(/\/$/, '');
        const allCreds = issuer.credentials ?? [];
        // When eligibility data is loaded, show only credentials the citizen
        // can actually obtain. Fall back to all credentials if the check failed.
        const creds = eligibility !== null
          ? allCreds.filter((c) => eligibility.has(eligibilityKey(base, c.id)))
          : allCreds;
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
