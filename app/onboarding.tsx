import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { branding } from '../branding.config';
import { useInitializeAgent } from '../src/agent/context';
import { savePin, saveWalletKey } from '../src/utils/storage';

export default function Onboarding() {
  const initializeAgent = useInitializeAgent();
  const [step, setStep] = useState<'welcome' | 'pin' | 'confirm'>('welcome');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    if (pin !== confirmPin) {
      setError('Los PINs no coinciden.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const key = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        `cdpi-wallet-${pin}-${Date.now()}`,
      );
      await saveWalletKey(key);
      await savePin(pin);
      await initializeAgent(key);
      router.replace('/(tabs)/credentials');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al configurar la billetera.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'welcome') {
    return (
      <View style={styles.container}>
        <Image
          source={require('../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>{branding.appName}</Text>
        <Text style={styles.subtitle}>
          Tu billetera de credenciales verificables. Segura, privada, tuya.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: branding.primaryColor }]}
          onPress={() => setStep('pin')}
        >
          <Text style={styles.buttonText}>Configurar billetera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {step === 'pin' ? 'Elige un PIN de 6 dígitos' : 'Confirma tu PIN'}
      </Text>
      <Text style={styles.subtitle}>
        {step === 'pin'
          ? 'Este PIN protege el acceso a tu billetera.'
          : 'Ingresa el PIN nuevamente para confirmar.'}
      </Text>
      <TextInput
        style={styles.pinInput}
        value={step === 'pin' ? pin : confirmPin}
        onChangeText={step === 'pin' ? setPin : setConfirmPin}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        placeholder="••••••"
        placeholderTextColor="#9CA3AF"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <ActivityIndicator size="large" color={branding.primaryColor} style={{ marginTop: 24 }} />
      ) : (
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: branding.primaryColor },
            (step === 'pin' ? pin : confirmPin).length < 6 && styles.buttonDisabled,
          ]}
          disabled={(step === 'pin' ? pin : confirmPin).length < 6}
          onPress={step === 'pin' ? () => setStep('confirm') : handleConfirm}
        >
          <Text style={styles.buttonText}>
            {step === 'pin' ? 'Siguiente' : 'Crear billetera'}
          </Text>
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
  logo: {
    width: 120,
    height: 120,
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
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
