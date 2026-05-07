import 'reflect-metadata';
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
if (typeof global.Buffer === 'undefined') global.Buffer = Buffer;
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AgentProvider } from '../src/agent/context';
import { UserProvider } from '../src/auth/UserContext';

export default function RootLayout() {
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
            options={{ presentation: 'modal', headerShown: true, title: 'Recibir credencial' }}
          />
          <Stack.Screen
            name="present"
            options={{ presentation: 'modal', headerShown: true, title: 'Presentar credencial' }}
          />
        </Stack>
      </AgentProvider>
    </UserProvider>
  );
}
