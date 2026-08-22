import 'reflect-metadata';
import 'react-native-get-random-values';
import '../src/i18n'; // initialize i18next before any screen renders
import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') global.Buffer = Buffer;
import React, { useEffect, useMemo } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isGetCredentialActivity } from '@animo-id/expo-digital-credentials-api';
import { AgentProvider } from '../src/agent/context';
import { UserProvider } from '../src/auth/UserContext';
import { initLanguagePreference } from '../src/i18n';

export default function RootLayout() {
  const { t } = useTranslation();

  // Expo Router auto-boots this root layout even when Android launched the
  // GET_CREDENTIAL activity (index.js's registerGetCredentialComponent
  // handles that intent separately) — without this guard the full app would
  // mount invisibly underneath the credential-picker overlay. Per the
  // package README's "Note on Expo Router" section: must only be called
  // once this component is already mounted, not at module scope, or app
  // loading can get stuck.
  //
  // Platform-gated: @animo-id/expo-digital-credentials-api declares
  // "platforms": ["android"] and ships no ios/ implementation.
  // isGetCredentialActivity() calls ensureAndroid() (throws a plain JS Error
  // on iOS) before ever touching the native module — but this hook runs on
  // every launch, unguarded, on both platforms. index.js's entry-point guard
  // only covers registerGetCredentialComponent; this call site was missed.
  const isDcApiActivity = useMemo(
    () => (Platform.OS === 'android' ? isGetCredentialActivity() : false),
    []
  );

  useEffect(() => {
    initLanguagePreference();
  }, []);

  if (isDcApiActivity) return null;

  return (
    <UserProvider>
      <AgentProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="unlock" />
          <Stack.Screen name="auth" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="receive"
            options={{ presentation: 'modal', headerShown: true, title: t('modals.receive') }}
          />
          <Stack.Screen
            name="present"
            options={{ presentation: 'modal', headerShown: true, title: t('modals.present') }}
          />
          <Stack.Screen name="notifications" options={{ presentation: 'modal', headerShown: false }} />
        </Stack>
      </AgentProvider>
    </UserProvider>
  );
}
