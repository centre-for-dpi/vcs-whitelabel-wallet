import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { branding } from '../../../branding.config';
import { useAgentState } from '../../../src/agent/context';
import {
  CredentialEntry,
  formatClaimKey,
  formatClaimValue,
  fromSdJwtRecord,
  fromW3cRecord,
} from '../../../src/utils/credential';

export default function CredentialDetail() {
  const { id, format } = useLocalSearchParams<{ id: string; format: string }>();
  const agentState = useAgentState();
  const [entry, setEntry] = useState<CredentialEntry | null>(null);
  const [disclosed, setDisclosed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (agentState.status !== 'ready' || !id) return;
    const { agent } = agentState;
    (async () => {
      try {
        if (format === 'sdjwt') {
          const record = await agent.sdJwtVc.getById(id);
          const e = fromSdJwtRecord(record);
          setEntry(e);
          setDisclosed(Object.fromEntries(e.selectiveFields.map((f) => [f, true])));
        } else {
          const record = await agent.w3cCredentials.getCredentialRecordById(id);
          setEntry(fromW3cRecord(record));
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
        await agent.w3cCredentials.removeCredentialRecord(entry.id);
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

  const date = new Date(entry.issuanceDate).toLocaleDateString('es', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: branding.primaryColor }]}>
        <Text style={styles.headerType}>{entry.type}</Text>
        <Text style={styles.headerDate}>{date}</Text>
      </View>

      {/* Issuer */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Emisor</Text>
        <Text style={styles.sectionValue}>{entry.issuer}</Text>
      </View>

      {/* Claims */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Atributos</Text>
        {entry.selectiveFields.map((key) => {
          const value = entry.claims[key];
          return (
            <View key={key} style={styles.claim}>
              <View style={styles.claimLeft}>
                <Text style={styles.claimKey}>{formatClaimKey(key)}</Text>
                <Text style={styles.claimValue}>{formatClaimValue(value)}</Text>
              </View>
              {entry.format === 'sdjwt' && (
                <View style={styles.claimRight}>
                  <Text style={styles.disclosureLabel}>
                    {disclosed[key] ? 'Revelar' : 'Ocultar'}
                  </Text>
                  <Switch
                    value={disclosed[key] ?? true}
                    onValueChange={(v) =>
                      setDisclosed((prev) => ({ ...prev, [key]: v }))
                    }
                    trackColor={{ true: branding.primaryColor, false: '#D1D5DB' }}
                  />
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Present */}
      <TouchableOpacity
        style={[styles.actionBtn, { backgroundColor: branding.primaryColor }]}
        onPress={() =>
          router.push({
            pathname: '/present',
            params: { id: entry.id, format: entry.format },
          })
        }
      >
        <Text style={styles.actionBtnText}>Presentar esta credencial</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
        <Text style={styles.deleteBtnText}>Eliminar credencial</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  content: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    padding: 24,
    paddingTop: 32,
  },
  headerType: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 4 },
  headerDate: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  sectionValue: { fontSize: 15, color: '#111827' },
  claim: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  claimLeft: { flex: 1, marginRight: 8 },
  claimKey: { fontSize: 12, color: '#6B7280', marginBottom: 2 },
  claimValue: { fontSize: 15, color: '#111827', fontWeight: '500' },
  claimRight: { alignItems: 'center' },
  disclosureLabel: { fontSize: 10, color: '#9CA3AF', marginBottom: 2 },
  actionBtn: {
    margin: 16,
    marginTop: 24,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteBtn: {
    marginHorizontal: 16,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  deleteBtnText: { color: '#DC2626', fontSize: 15, fontWeight: '500' },
});
