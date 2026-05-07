import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { branding } from '../../../branding.config';
import { useAgentState } from '../../../src/agent/context';
import { useUser } from '../../../src/auth/UserContext';
import { CredentialCard } from '../../../src/components/CredentialCard';
import {
  CredentialEntry,
  fromSdJwtRecord,
  fromW3cRecord,
  fromW3cV2Record,
} from '../../../src/utils/credential';

export default function CredentialList() {
  const agentState = useAgentState();
  const { user } = useUser();
  const [entries, setEntries] = useState<CredentialEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (agentState.status !== 'ready') return;
    const { agent } = agentState;
    try {
      const [sdJwtRecords, w3cRecords, w3cV2Records] = await Promise.all([
        agent.sdJwtVc.getAll(),
        agent.w3cCredentials.getAll(),
        agent.w3cV2Credentials.getAll(),
      ]);
      console.log('[credentials] sdJwt:', sdJwtRecords.length, '| w3c:', w3cRecords.length, '| w3cV2:', w3cV2Records.length);
      const all: CredentialEntry[] = [];
      for (const r of sdJwtRecords) {
        try { all.push(fromSdJwtRecord(r)); } catch (e) { console.error('[credentials] fromSdJwtRecord failed:', e); }
      }
      for (const r of w3cRecords) {
        try { all.push(fromW3cRecord(r)); } catch (e) { console.error('[credentials] fromW3cRecord failed:', e); }
      }
      for (const r of w3cV2Records) {
        try { all.push(fromW3cV2Record(r)); } catch (e) { console.error('[credentials] fromW3cV2Record failed:', e); }
      }
      all.sort((a, b) => new Date(b.issuanceDate).getTime() - new Date(a.issuanceDate).getTime());
      console.log('[credentials] total entries after parse:', all.length);
      setEntries(all);
    } catch (e) {
      console.error('[credentials] load failed:', e);
      setEntries([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agentState]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (agentState.status !== 'ready') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={branding.primaryColor} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={branding.primaryColor} />
      </View>
    );
  }

  const firstName = user?.given_name ?? user?.name?.split(' ')[0];

  return (
    <View style={styles.container}>
      {firstName && (
        <View style={styles.greeting}>
          <Text style={styles.greetingText}>Hola, {firstName} 👋</Text>
        </View>
      )}
      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🪪</Text>
          <Text style={styles.emptyTitle}>Sin credenciales</Text>
          <Text style={styles.emptyBody}>
            Escanea el QR de tu emisor o pega un enlace OpenID para recibir tu primera credencial.
          </Text>
          <TouchableOpacity
            style={[styles.scanBtn, { backgroundColor: branding.primaryColor }]}
            onPress={() => router.push('/(tabs)/scan')}
          >
            <Text style={styles.scanBtnText}>Ir a escanear</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <CredentialCard
              entry={item}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/credentials/[id]',
                  params: { id: item.id, format: item.format },
                })
              }
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={branding.primaryColor}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  greeting: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  greetingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  list: { padding: 16 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptyBody: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  scanBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  scanBtnText: { color: '#fff', fontWeight: '600' },
});
