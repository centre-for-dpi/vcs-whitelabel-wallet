import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { branding, oidcConfig } from '../branding.config';
import { useInitializeAgent } from '../src/agent/context';
import { useUser } from '../src/auth/UserContext';
import { getWalletKey, verifyPin, OidcUser } from '../src/utils/storage';

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URI = oidcConfig.redirectUri;

export default function Unlock() {
  const { t } = useTranslation();
  const initializeAgent = useInitializeAgent();
  const { setUser } = useUser();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const discovery = AuthSession.useAutoDiscovery(
    oidcConfig.enabled ? oidcConfig.issuerUrl : null,
  );

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: oidcConfig.clientId,
      scopes: oidcConfig.scopes ?? ['openid', 'profile', 'email'],
      redirectUri: REDIRECT_URI,
      responseType: AuthSession.ResponseType.Code,
    },
    oidcConfig.enabled ? discovery : null,
  );

  const codeVerifierRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!response) return;
    console.log('[oidc] response type:', response.type, JSON.stringify(response));
    if (response.type === 'success') {
      setLoading(true);
      exchangeCode(response.params.code);
    } else if (response.type === 'error') {
      const desc = (response as { params?: { error_description?: string } }).params?.error_description ?? '';
      setError(t('unlock.oidc_error', { desc: desc || t('common.try_again') }));
    } else if (response.type === 'dismiss') {
      setError(t('unlock.oidc_cancelled'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  const exchangeCode = async (code: string) => {
    if (!discovery?.tokenEndpoint) {
      setError(t('unlock.config_error'));
      setLoading(false);
      return;
    }
    try {
      const tokenResp = await AuthSession.exchangeCodeAsync(
        {
          clientId: oidcConfig.clientId,
          code,
          redirectUri: REDIRECT_URI,
          extraParams: codeVerifierRef.current
            ? { code_verifier: codeVerifierRef.current }
            : {},
        },
        discovery,
      );

      if (discovery.userInfoEndpoint) {
        const uiResp = await fetch(discovery.userInfoEndpoint, {
          headers: { Authorization: `Bearer ${tokenResp.accessToken}` },
        });
        const info = await uiResp.json() as Record<string, string>;
        const oidcUser: OidcUser = {
          sub: info.sub,
          name: info.name,
          given_name: info.given_name,
          family_name: info.family_name,
          email: info.email,
        };
        await setUser(oidcUser);
      }

      const key = await getWalletKey();
      if (!key) throw new Error('Wallet key not found');
      await initializeAgent(key);
      router.replace('/(tabs)/credentials');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('unlock.auth_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = async () => {
    console.log('[oidc] discovery:', JSON.stringify(discovery));
    console.log('[oidc] request url:', request?.url);
    console.log('[oidc] redirect_uri:', REDIRECT_URI);
    codeVerifierRef.current = request?.codeVerifier ?? undefined;
    setError('');
    await promptAsync();
  };

  const handleUnlock = async () => {
    if (pin.length < 6) return;
    setLoading(true);
    setError('');
    try {
      const valid = await verifyPin(pin);
      if (!valid) {
        setError(t('unlock.pin_wrong'));
        setPin('');
        return;
      }
      const key = await getWalletKey();
      if (!key) throw new Error('Wallet key not found');
      await initializeAgent(key);
      router.replace('/(tabs)/credentials');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('unlock.unlock_error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />

      <Text style={styles.title}>{t('unlock.title')}</Text>
      <TextInput
        style={styles.pinInput}
        value={pin}
        onChangeText={setPin}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        placeholder="••••••"
        placeholderTextColor="#9CA3AF"
        autoFocus
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator size="large" color={branding.primaryColor} style={{ marginTop: 24 }} />
      ) : (
        <>
          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: branding.primaryColor },
              pin.length < 6 && styles.buttonDisabled,
            ]}
            disabled={pin.length < 6}
            onPress={handleUnlock}
          >
            <Text style={styles.buttonText}>{t('unlock.unlock_btn')}</Text>
          </TouchableOpacity>

          {oidcConfig.enabled && (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerLabel}>o</Text>
                <View style={styles.dividerLine} />
              </View>
              <TouchableOpacity
                style={[styles.oidcButton, !request && styles.buttonDisabled]}
                disabled={!request}
                onPress={handleOidcLogin}
              >
                <Text style={[styles.oidcButtonText, { color: branding.primaryColor }]}>
                  {oidcConfig.buttonLabel}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: branding.loginBackgroundColor,
  },
  logo: { width: 280, height: 67, marginBottom: 32, resizeMode: 'contain' },
  title: { fontSize: 22, fontWeight: '700', color: branding.textColor, marginBottom: 24 },
  pinInput: {
    width: 180,
    height: 56,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 24,
    letterSpacing: 8,
    marginBottom: 16,
    color: branding.textColor,
  },
  button: { width: '100%', height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#DC2626', fontSize: 14, marginBottom: 8 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dividerLabel: { marginHorizontal: 12, fontSize: 13, color: '#9CA3AF' },
  oidcButton: { width: '100%', height: 52, borderRadius: 12, borderWidth: 1.5, borderColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center' },
  oidcButtonText: { fontSize: 15, fontWeight: '600' },
});
