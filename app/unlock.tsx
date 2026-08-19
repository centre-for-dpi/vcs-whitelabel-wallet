import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { checkBiometricSupport, authenticateWithBiometrics } from '../src/auth/biometric';
import {
  getWalletKey,
  verifyPin,
  OidcUser,
  getLockoutUntil,
  incrementFailCount,
  lockoutDurationFor,
  resetFailCount,
  setLockout,
  LOCKOUT_WARNING_THRESHOLD,
  getBiometricsEnabled,
  saveOidcTokens,
} from '../src/utils/storage';

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URI = oidcConfig.redirectUri;

export default function Unlock() {
  const { t } = useTranslation();
  const initializeAgent = useInitializeAgent();
  const { setUser } = useUser();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const startLockoutCountdown = (secondsRemaining: number) => {
    if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current);
    setLockoutSeconds(secondsRemaining);
    lockoutTimerRef.current = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(lockoutTimerRef.current!);
          lockoutTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const unlockWithKey = useCallback(async () => {
    const key = await getWalletKey();
    if (!key) throw new Error('Wallet key not found');
    await initializeAgent(key);
    router.replace('/(tabs)/credentials');
  }, [initializeAgent]);

  const triggerBiometrics = useCallback(async () => {
    const success = await authenticateWithBiometrics(t('unlock.biometrics_prompt'));
    if (success) {
      setLoading(true);
      try {
        await unlockWithKey();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t('unlock.unlock_error'));
      } finally {
        setLoading(false);
      }
    }
  }, [t, unlockWithKey]);

  // On mount: check lockout and biometrics, then auto-trigger if applicable
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const until = await getLockoutUntil();
      const remaining = Math.ceil((until - Date.now()) / 1000);
      if (remaining > 0) {
        startLockoutCountdown(remaining);
        return;
      }

      const [enabled, support] = await Promise.all([
        getBiometricsEnabled(),
        checkBiometricSupport(),
      ]);

      if (!cancelled && enabled && support.available) {
        setBiometricsAvailable(true);
        triggerBiometrics();
      }
    })();
    return () => {
      cancelled = true;
      if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!response) return;
    console.log('[oidc] response type:', response.type);
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

      await saveOidcTokens(tokenResp.refreshToken, tokenResp.expiresIn, tokenResp.idToken, tokenResp.accessToken);

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

      await unlockWithKey();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('unlock.auth_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = async () => {
    codeVerifierRef.current = request?.codeVerifier ?? undefined;
    setError('');
    await promptAsync();
  };

  const handleUnlock = async () => {
    if (pin.length < 6) return;

    const until = await getLockoutUntil();
    const remaining = Math.ceil((until - Date.now()) / 1000);
    if (remaining > 0) {
      startLockoutCountdown(remaining);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const valid = await verifyPin(pin);
      if (!valid) {
        const count = await incrementFailCount();
        const duration = lockoutDurationFor(count);
        if (duration > 0) {
          await setLockout(duration);
          startLockoutCountdown(Math.ceil(duration / 1000));
        } else {
          const attemptsBeforeLock = LOCKOUT_WARNING_THRESHOLD - count;
          if (attemptsBeforeLock > 0 && attemptsBeforeLock <= 2) {
            setError(t('unlock.pin_wrong_attempts', { count: attemptsBeforeLock }));
          } else {
            setError(t('unlock.pin_wrong'));
          }
        }
        setPin('');
        return;
      }
      await resetFailCount();
      await unlockWithKey();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('unlock.unlock_error'));
    } finally {
      setLoading(false);
    }
  };

  const isLocked = lockoutSeconds > 0;

  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />

      {isLocked ? (
        <View style={styles.lockedBox}>
          <Text style={styles.lockedTitle}>{t('unlock.locked_title')}</Text>
          <Text style={styles.lockedBody}>
            {t('unlock.locked_body', { seconds: lockoutSeconds })}
          </Text>
        </View>
      ) : (
        <>
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
            autoFocus={!biometricsAvailable}
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

              {biometricsAvailable && (
                <TouchableOpacity style={styles.biometricBtn} onPress={triggerBiometrics}>
                  <Text style={[styles.biometricBtnText, { color: branding.primaryColor }]}>
                    {t('unlock.use_biometrics')}
                  </Text>
                </TouchableOpacity>
              )}

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
  error: { color: '#DC2626', fontSize: 14, marginBottom: 8, textAlign: 'center' },
  biometricBtn: { marginTop: 16, height: 44, justifyContent: 'center', alignItems: 'center', width: '100%' },
  biometricBtnText: { fontSize: 15, fontWeight: '600' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dividerLabel: { marginHorizontal: 12, fontSize: 13, color: '#9CA3AF' },
  oidcButton: { width: '100%', height: 52, borderRadius: 12, borderWidth: 1.5, borderColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center' },
  oidcButtonText: { fontSize: 15, fontWeight: '600' },
  lockedBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
    width: '100%',
  },
  lockedTitle: { fontSize: 18, fontWeight: '700', color: '#DC2626', marginBottom: 10 },
  lockedBody: { fontSize: 14, color: '#7F1D1D', textAlign: 'center', lineHeight: 22 },
});
