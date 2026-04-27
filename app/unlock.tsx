import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { branding } from '../branding.config';
import { setupAgent } from '../src/agent/setup';
import { getWalletKey, verifyPin } from '../src/utils/storage';

export default function Unlock() {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUnlock = async () => {
    if (pin.length < 6) return;
    setLoading(true);
    setError('');
    try {
      const valid = await verifyPin(pin);
      if (!valid) {
        setError('PIN incorrecto. Intenta de nuevo.');
        setPin('');
        return;
      }
      const key = await getWalletKey();
      if (!key) throw new Error('Wallet key not found');
      await setupAgent(key);
      router.replace('/(tabs)/credentials');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al desbloquear.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.logoBox, { backgroundColor: branding.secondaryColor }]}>
        <Text style={[styles.logoText, { color: branding.primaryColor }]}>
          {branding.appName.charAt(0)}
        </Text>
      </View>
      <Text style={styles.title}>Ingresa tu PIN</Text>
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
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: branding.primaryColor },
            pin.length < 6 && styles.buttonDisabled,
          ]}
          disabled={pin.length < 6}
          onPress={handleUnlock}
        >
          <Text style={styles.buttonText}>Desbloquear</Text>
        </TouchableOpacity>
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
    backgroundColor: '#fff',
  },
  logoBox: {
    width: 72,
    height: 72,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  logoText: { fontSize: 32, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 24 },
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
    color: '#111827',
  },
  button: {
    width: '100%',
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#DC2626', fontSize: 14, marginBottom: 8 },
});
