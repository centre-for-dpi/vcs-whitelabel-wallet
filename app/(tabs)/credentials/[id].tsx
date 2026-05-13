import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { branding } from '../../../branding.config';
import { useAgentState } from '../../../src/agent/context';
import {
  CredentialEntry,
  formatClaimKey,
  formatClaimValue,
  fromSdJwtRecord,
  fromW3cRecord,
  fromW3cV2Record,
} from '../../../src/utils/credential';

export default function CredentialDetail() {
  const { t, i18n } = useTranslation();
  const { id, format } = useLocalSearchParams<{ id: string; format: string }>();
  const agentState = useAgentState();
  const [entry, setEntry] = useState<CredentialEntry | null>(null);

  useEffect(() => {
    if (agentState.status !== 'ready' || !id) return;
    const { agent } = agentState;
    (async () => {
      try {
        if (format === 'sdjwt') {
          const record = await agent.sdJwtVc.getById(id);
          setEntry(fromSdJwtRecord(record));
        } else {
          try {
            const record = await agent.w3cV2Credentials.getById(id);
            setEntry(fromW3cV2Record(record));
          } catch {
            const record = await agent.w3cCredentials.getById(id);
            setEntry(fromW3cRecord(record));
          }
        }
      } catch {
        router.back();
      }
    })();
  }, [agentState, id, format]);

  const handleDelete = async () => {
    if (agentState.status !== 'ready' || !entry) return;
    const { agent } = agentState;
    try {
      if (format === 'sdjwt') {
        await agent.sdJwtVc.deleteById(entry.id);
      } else {
        try {
          await agent.w3cV2Credentials.deleteById(entry.id);
        } catch {
          await agent.w3cCredentials.deleteById(entry.id);
        }
      }
      router.back();
    } catch { /* ignore */ }
  };

  if (!entry) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={branding.primaryColor} />
      </View>
    );
  }

  const date = new Date(entry.issuanceDate).toLocaleDateString(i18n.language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.header, { backgroundColor: branding.primaryColor }]}>
        <Text style={styles.headerType}>{entry.type}</Text>
        <Text style={styles.headerDate}>{date}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('credentials.label_issuer')}</Text>
        <Text style={styles.sectionValue}>{entry.issuer}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('credentials.label_attributes')}</Text>
        {entry.selectiveFields.map((key) => {
          const value = entry.claims[key];
          return (
            <View key={key} style={styles.claim}>
              <Text style={styles.claimKey}>{formatClaimKey(key)}</Text>
              <Text style={styles.claimValue}>{formatClaimValue(value)}</Text>
            </View>
          );
        })}
      </View>

      <TouchableOpacity
        style={[styles.actionBtn, { backgroundColor: branding.primaryColor }]}
        onPress={() =>
          router.push({
            pathname: '/present',
            params: { id: entry.id, format: entry.format },
          })
        }
      >
        <Text style={styles.actionBtnText}>{t('credentials.present_btn')}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
        <Text style={styles.deleteBtnText}>{t('credentials.delete_btn')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 24, paddingTop: 32 },
  headerType: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 4 },
  headerDate: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  section: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 16, borderRadius: 12, padding: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  sectionValue: { fontSize: 15, color: '#111827' },
  claim: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  claimKey: { fontSize: 12, color: '#6B7280', marginBottom: 2 },
  claimValue: { fontSize: 15, color: '#111827', fontWeight: '500' },
  actionBtn: { margin: 16, marginTop: 24, height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteBtn: { marginHorizontal: 16, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#FCA5A5' },
  deleteBtnText: { color: '#DC2626', fontSize: 15, fontWeight: '500' },
});
