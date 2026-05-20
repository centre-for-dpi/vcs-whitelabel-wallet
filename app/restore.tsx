import { router } from 'expo-router';
import React, { useState } from 'react';
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
import { branding } from '../branding.config';
import { useInitializeAgent } from '../src/agent/context';
import { saveWalletKey, savePin, getWalletKey } from '../src/utils/storage';
import { pickBackupFile, decryptBackup, restoreAskarWallet } from '../src/utils/backup';

type Step = 'pick' | 'phrase' | 'pin' | 'confirm_pin';

export default function RestoreScreen() {
  const { t } = useTranslation();
  const initializeAgent = useInitializeAgent();

  const [step, setStep] = useState<Step>('pick');
  const [fileUri, setFileUri] = useState('');
  const [phrase, setPhrase] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePickFile = async () => {
    setError('');
    const uri = await pickBackupFile();
    if (!uri) return;
    setFileUri(uri);
    setStep('phrase');
  };

  const handleRestore = async () => {
    setError('');
    const normalizedPhrase = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
    if (normalizedPhrase.split(' ').length < 12) {
      setError(t('backup.restore_error_phrase'));
      return;
    }

    setLoading(true);
    try {
      const payload = await decryptBackup(fileUri, normalizedPhrase);
      await restoreAskarWallet(payload.askarData, payload.walletKey, normalizedPhrase);
      // Store the wallet key — the user will set a new PIN next
      await saveWalletKey(payload.walletKey);
      setStep('pin');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'invalid_phrase') {
        setError(t('backup.restore_error_phrase'));
      } else if (msg === 'invalid_file') {
        setError(t('backup.restore_error_file'));
      } else {
        setError(t('backup.restore_error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSetPin = () => {
    if (pin.length < 6) return;
    setStep('confirm_pin');
  };

  const handleConfirmPin = async () => {
    if (pin !== confirmPin) {
      setError(t('onboarding.pin_mismatch'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      await savePin(pin);
      const walletKey = await getWalletKey();
      if (!walletKey) throw new Error('no key');
      await initializeAgent(walletKey);
      router.replace('/(tabs)/credentials');
    } catch {
      setError(t('backup.restore_error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backBtnText}>← {t('common.back')}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{t('backup.restore_title')}</Text>

      {/* Step 1: Pick file */}
      {step === 'pick' && (
        <>
          <Text style={styles.subtitle}>{t('backup.restore_pick_title')}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.button, { backgroundColor: branding.primaryColor }]}
            onPress={handlePickFile}
          >
            <Text style={styles.buttonText}>{t('backup.restore_pick_btn')}</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Step 2: Enter recovery phrase */}
      {step === 'phrase' && (
        <>
          <Text style={styles.subtitle}>{t('backup.restore_phrase_title')}</Text>
          <TextInput
            style={styles.phraseInput}
            value={phrase}
            onChangeText={setPhrase}
            placeholder={t('backup.restore_phrase_placeholder')}
            placeholderTextColor="#9CA3AF"
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {loading ? (
            <ActivityIndicator size="large" color={branding.primaryColor} style={{ marginTop: 24 }} />
          ) : (
            <TouchableOpacity
              style={[styles.button, { backgroundColor: branding.primaryColor }]}
              onPress={handleRestore}
            >
              <Text style={styles.buttonText}>{t('backup.restore_phrase_btn')}</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Step 3: Set new PIN */}
      {(step === 'pin' || step === 'confirm_pin') && (
        <>
          <Text style={styles.subtitle}>
            {step === 'pin' ? t('backup.restore_pin_title') : t('onboarding.confirm_pin')}
          </Text>
          <Text style={styles.hint}>
            {step === 'pin' ? t('backup.restore_pin_subtitle') : t('onboarding.pin_repeat')}
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
              onPress={step === 'pin' ? handleSetPin : handleConfirmPin}
            >
              <Text style={styles.buttonText}>
                {step === 'pin' ? t('onboarding.next') : t('onboarding.create_wallet')}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 32, paddingTop: 60, flexGrow: 1 },
  backBtn: { marginBottom: 24 },
  backBtnText: { fontSize: 15, color: '#6B7280' },
  title: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 8 },
  subtitle: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 8, marginTop: 8 },
  hint: { fontSize: 14, color: '#6B7280', marginBottom: 24, lineHeight: 20 },
  phraseInput: {
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#111827',
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 16,
    marginTop: 8,
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
    marginTop: 16,
    color: '#111827',
    alignSelf: 'center',
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
  error: { color: '#DC2626', fontSize: 14, marginBottom: 8, marginTop: 4 },
});
