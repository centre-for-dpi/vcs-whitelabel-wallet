import 'reflect-metadata';
import 'react-native-get-random-values';
import '../src/i18n'; // initialize i18next before any screen renders
import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') global.Buffer = Buffer;
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { AgentProvider } from '../src/agent/context';
import { UserProvider } from '../src/auth/UserContext';
import { initLanguagePreference } from '../src/i18n';

export default function RootLayout() {
  const { t } = useTranslation();

  useEffect(() => {
    initLanguagePreference();
  }, []);

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
        </Stack>
      </AgentProvider>
    </UserProvider>
  );
}
