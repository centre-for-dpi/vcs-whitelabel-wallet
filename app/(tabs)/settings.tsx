import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { branding } from '../../branding.config';
import { useAgentState } from '../../src/agent/context';
import { useUser } from '../../src/auth/UserContext';
import { checkBiometricSupport, authenticateWithBiometrics } from '../../src/auth/biometric';
import { SUPPORTED_LANGS, setLanguagePreference, type Language } from '../../src/i18n';
import { getUserDisplayName, getBiometricsEnabled, setBiometricsEnabled, getRecoveryPhrase, saveRecoveryPhrase, verifyPin, savePin } from '../../src/utils/storage';
import { exportBackup, generateRecoveryPhrase } from '../../src/utils/backup';

const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
  </View>
);

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { user, clearUser } = useUser();
  const agentState = useAgentState();
  const [biometricsOn, setBiometricsOn] = useState(false);
  const [biometricsAvailable, setBiometricsAvailableState] = useState(false);
  const [holderDids, setHolderDids] = useState<string[]>([]);
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [phraseVisible, setPhraseVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [generatingPhrase, setGeneratingPhrase] = useState(false);

  const [changePinVisible, setChangePinVisible] = useState(false);
  const [changePinStep, setChangePinStep] = useState<'verify' | 'new' | 'confirm'>('verify');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [changePinError, setChangePinError] = useState('');
  const [changePinLoading, setChangePinLoading] = useState(false);

  const displayName = user ? (getUserDisplayName(user) ?? '') : '';
  const initials = displayName
    ? displayName.split(' ').slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('')
    : '?';

  useEffect(() => {
    (async () => {
      const [enabled, support, phrase] = await Promise.all([
        getBiometricsEnabled(),
        checkBiometricSupport(),
        getRecoveryPhrase(),
      ]);
      setBiometricsOn(enabled);
      setBiometricsAvailableState(support.available);
      if (phrase) setRecoveryPhrase(phrase);
    })();
  }, []);

  useEffect(() => {
    if (agentState.status !== 'ready') return;
    agentState.agent.dids.getCreatedDids().then((records) => {
      const dids = records.map((r) => r.did as string).filter(Boolean);
      setHolderDids([...new Set(dids)]);
    }).catch(() => {});
  }, [agentState]);

  const handleShareDid = (did: string) => {
    Share.share({ message: did }).catch(() => {});
  };

  const truncateDid = (did: string) =>
    did.length > 36 ? `${did.slice(0, 20)}…${did.slice(-10)}` : did;

  const handleBiometricsToggle = async (value: boolean) => {
    if (value) {
      // Require a successful biometric auth before enabling
      const success = await authenticateWithBiometrics(t('settings.biometrics_enable_prompt'));
      if (!success) return; // user cancelled or auth failed — keep disabled
    }
    await setBiometricsEnabled(value);
    setBiometricsOn(value);
  };

  const handleBiometricsUnavailable = () => {
    Alert.alert(t('settings.biometrics_row'), t('settings.biometrics_unavailable'));
  };

  const handleLanguage = async (lang: Language) => {
    await setLanguagePreference(lang);
  };

  const openChangePin = () => {
    setChangePinStep('verify');
    setCurrentPin('');
    setNewPin('');
    setConfirmNewPin('');
    setChangePinError('');
    setChangePinVisible(true);
  };

  const handleChangePinVerify = async () => {
    setChangePinLoading(true);
    const ok = await verifyPin(currentPin);
    setChangePinLoading(false);
    if (!ok) {
      setChangePinError(t('settings.change_pin_wrong'));
      setCurrentPin('');
      return;
    }
    setChangePinError('');
    setChangePinStep('new');
  };

  const handleChangePinConfirm = async () => {
    if (newPin !== confirmNewPin) {
      setChangePinError(t('onboarding.pin_mismatch'));
      return;
    }
    setChangePinLoading(true);
    await savePin(newPin);
    setChangePinLoading(false);
    setChangePinVisible(false);
    Alert.alert('', t('settings.change_pin_success'));
  };

  const handleSetupRecoveryPhrase = async () => {
    setGeneratingPhrase(true);
    try {
      const phrase = await generateRecoveryPhrase();
      await saveRecoveryPhrase(phrase);
      setRecoveryPhrase(phrase);
      setPhraseVisible(true);
    } catch {
      Alert.alert(t('common.error'), t('backup.setup_phrase_error'));
    } finally {
      setGeneratingPhrase(false);
    }
  };

  const handleExportBackup = async () => {
    if (agentState.status !== 'ready' || !recoveryPhrase) return;
    setExporting(true);
    try {
      await exportBackup(agentState.agent, recoveryPhrase);
    } catch (e) {
      console.error('[exportBackup] failed:', e);
      Alert.alert(t('common.error'), t('backup.export_error'));
    } finally {
      setExporting(false);
    }
  };

  const changePinActiveValue =
    changePinStep === 'verify' ? currentPin : changePinStep === 'new' ? newPin : confirmNewPin;
  const changePinSetter =
    changePinStep === 'verify' ? setCurrentPin : changePinStep === 'new' ? setNewPin : setConfirmNewPin;

  return (
    <>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {user && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.section_session')}</Text>
          <View style={styles.userCard}>
            <View style={[styles.avatar, { backgroundColor: branding.primaryColor }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.userInfo}>
              {user.name && <Text style={styles.userName}>{user.name}</Text>}
              {user.email && <Text style={styles.userEmail}>{user.email}</Text>}
            </View>
          </View>
          <TouchableOpacity style={styles.signOutBtn} onPress={clearUser}>
            <Text style={styles.signOutText}>{t('settings.sign_out')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.section_security')}</Text>
        {biometricsAvailable ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('settings.biometrics_row')}</Text>
            <Switch
              value={biometricsOn}
              onValueChange={handleBiometricsToggle}
              trackColor={{ false: '#E5E7EB', true: branding.primaryColor }}
              thumbColor="#fff"
            />
          </View>
        ) : (
          <TouchableOpacity style={styles.row} onPress={handleBiometricsUnavailable}>
            <Text style={styles.rowLabel}>{t('settings.biometrics_row')}</Text>
            <Text style={styles.rowValueMuted}>{t('settings.biometrics_unavailable')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.row} onPress={openChangePin}>
          <Text style={styles.rowLabel}>{t('settings.change_pin_row')}</Text>
          <Text style={styles.rowValueMuted}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.section_wallet')}</Text>
        <Row label={t('settings.row_name')} value={branding.appName} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('backup.section_title')}</Text>
        {recoveryPhrase ? (
          <>
            <View style={styles.phraseRow}>
              <Text style={styles.rowLabel}>{t('backup.recovery_phrase_row')}</Text>
              <TouchableOpacity onPress={() => setPhraseVisible((v) => !v)}>
                <Text style={[styles.rowValue, { color: branding.primaryColor }]}>
                  {phraseVisible ? t('backup.hide_phrase') : t('backup.show_phrase')}
                </Text>
              </TouchableOpacity>
            </View>
            {phraseVisible && (
              <View style={styles.phraseBox}>
                <Text style={styles.phraseText}>{recoveryPhrase}</Text>
                <Text style={styles.phraseWarning}>{t('backup.phrase_warning')}</Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.exportBtn, { backgroundColor: branding.primaryColor }, exporting && styles.exportBtnDisabled]}
              onPress={handleExportBackup}
              disabled={exporting}
            >
              <Text style={styles.exportBtnText}>
                {exporting ? t('backup.exporting') : t('backup.export_btn')}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.setupPhraseHint}>{t('backup.setup_phrase_hint')}</Text>
            {generatingPhrase ? (
              <ActivityIndicator size="small" color={branding.primaryColor} style={{ marginTop: 16 }} />
            ) : (
              <TouchableOpacity
                style={[styles.exportBtn, { backgroundColor: branding.primaryColor }]}
                onPress={handleSetupRecoveryPhrase}
              >
                <Text style={styles.exportBtnText}>{t('backup.setup_phrase_btn')}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {holderDids.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.section_dids')}</Text>
          {holderDids.map((did) => (
            <TouchableOpacity key={did} style={styles.didRow} onPress={() => handleShareDid(did)}>
              <View style={styles.didInfo}>
                <Text style={styles.didLabel}>{t('settings.did_label')}</Text>
                <Text style={styles.didValue} numberOfLines={1}>{truncateDid(did)}</Text>
              </View>
              <Text style={styles.didShareIcon}>⬆</Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.didHint}>{t('settings.did_hint')}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.section_protocols')}</Text>
        <Row label="OID4VCI" value={t('settings.active')} />
        <Row label="OID4VP" value={t('settings.active')} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settings.section_language')}</Text>
        <View style={styles.langRow}>
          {SUPPORTED_LANGS.map((lang) => (
            <TouchableOpacity
              key={lang}
              style={[
                styles.langBtn,
                i18n.language === lang && { backgroundColor: branding.primaryColor, borderColor: branding.primaryColor },
              ]}
              onPress={() => handleLanguage(lang)}
            >
              <Text style={[styles.langBtnText, i18n.language === lang && styles.langBtnTextActive]}>
                {t(`language.${lang}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Text style={styles.footer}>{branding.appName} • Powered by Credo 0.6.3</Text>
    </ScrollView>

    <Modal visible={changePinVisible} animationType="slide" transparent onRequestClose={() => setChangePinVisible(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{t('settings.change_pin_title')}</Text>
          <Text style={styles.modalSubtitle}>
            {changePinStep === 'verify'
              ? t('settings.change_pin_current')
              : changePinStep === 'new'
              ? t('settings.change_pin_new')
              : t('settings.change_pin_confirm')}
          </Text>
          <TextInput
            style={styles.modalPinInput}
            value={changePinActiveValue}
            onChangeText={changePinSetter}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            placeholder="••••••"
            placeholderTextColor="#9CA3AF"
            autoFocus
          />
          {changePinError ? <Text style={styles.modalError}>{changePinError}</Text> : null}
          {changePinLoading ? (
            <ActivityIndicator size="large" color={branding.primaryColor} style={{ marginTop: 16 }} />
          ) : (
            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: branding.primaryColor }, changePinActiveValue.length < 6 && styles.modalBtnDisabled]}
              disabled={changePinActiveValue.length < 6}
              onPress={
                changePinStep === 'verify'
                  ? handleChangePinVerify
                  : changePinStep === 'new'
                  ? () => { setChangePinError(''); setChangePinStep('confirm'); }
                  : handleChangePinConfirm
              }
            >
              <Text style={styles.modalBtnText}>
                {changePinStep === 'confirm' ? t('settings.change_pin_save') : t('onboarding.next')}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setChangePinVisible(false)}>
            <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { padding: 16, paddingBottom: 40 },
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  userCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatar: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 2 },
  userEmail: { fontSize: 13, color: '#6B7280' },
  signOutBtn: { paddingVertical: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  signOutText: { fontSize: 14, fontWeight: '600', color: '#DC2626' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  rowLabel: { fontSize: 14, color: '#374151', flex: 1 },
  rowValue: { fontSize: 13, color: '#6B7280', flex: 1, textAlign: 'right' },
  rowValueMuted: { fontSize: 13, color: '#D1D5DB', textAlign: 'right' },
  langRow: { flexDirection: 'row', gap: 8 },
  langBtn: { flex: 1, height: 40, borderRadius: 8, borderWidth: 1.5, borderColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center' },
  langBtnText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  langBtnTextActive: { color: '#fff' },
  footer: { textAlign: 'center', fontSize: 12, color: '#9CA3AF', marginTop: 8 },
  didRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  didInfo: { flex: 1 },
  didLabel: { fontSize: 11, color: '#9CA3AF', marginBottom: 2 },
  didValue: { fontSize: 13, color: '#374151', fontFamily: 'monospace' },
  didShareIcon: { fontSize: 16, color: '#9CA3AF', marginLeft: 8 },
  didHint: { fontSize: 11, color: '#9CA3AF', marginTop: 8 },
  phraseRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  phraseBox: { backgroundColor: '#F9FAFB', borderRadius: 10, padding: 14, marginTop: 12, marginBottom: 4 },
  phraseText: { fontSize: 14, color: '#111827', lineHeight: 22, fontFamily: 'monospace' },
  phraseWarning: { fontSize: 11, color: '#D97706', marginTop: 10, lineHeight: 16 },
  setupPhraseHint: { fontSize: 13, color: '#6B7280', lineHeight: 20, marginBottom: 4 },
  exportBtn: { marginTop: 14, height: 46, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  exportBtnDisabled: { opacity: 0.5 },
  exportBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 48 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 6 },
  modalSubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 24 },
  modalPinInput: { width: 180, height: 56, borderWidth: 2, borderColor: '#E5E7EB', borderRadius: 12, textAlign: 'center', fontSize: 24, letterSpacing: 8, marginBottom: 12, color: '#111827', alignSelf: 'center' },
  modalError: { color: '#DC2626', fontSize: 13, textAlign: 'center', marginBottom: 8 },
  modalBtn: { height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  modalBtnDisabled: { opacity: 0.4 },
  modalBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalCancelBtn: { height: 44, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  modalCancelText: { fontSize: 15, color: '#6B7280' },
});
