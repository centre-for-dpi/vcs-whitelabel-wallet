import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { branding } from '../../branding.config';
import { clearHistory, loadHistory, PresentationRecord } from '../../src/utils/presentationHistory';

export default function HistoryScreen() {
  const { t, i18n } = useTranslation();
  const [records, setRecords] = useState<PresentationRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetch = useCallback(async () => {
    setRecords(await loadHistory());
  }, []);

  useFocusEffect(useCallback(() => { void fetch(); }, [fetch]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetch();
    setRefreshing(false);
  }, [fetch]);

  const handleClear = () => {
    Alert.alert('', t('history.clear_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('history.clear_btn'),
        style: 'destructive',
        onPress: async () => {
          await clearHistory();
          setRecords([]);
        },
      },
    ]);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const renderItem = ({ item }: { item: PresentationRecord }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.dateText}>{formatDate(item.timestamp)}</Text>
        <View style={[styles.badge, { backgroundColor: branding.primaryColor + '18' }]}>
          <Text style={[styles.badgeText, { color: branding.primaryColor }]}>OID4VP</Text>
        </View>
      </View>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t('history.label_verifier')}</Text>
        <Text style={styles.rowValue} numberOfLines={1}>{item.verifier}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t('history.label_purpose')}</Text>
        <Text style={styles.rowValue}>{item.purpose}</Text>
      </View>

      {item.credentialTypes.length > 0 && (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('history.label_credentials')}</Text>
          <Text style={styles.rowValue}>{item.credentialTypes.join(', ')}</Text>
        </View>
      )}

      {item.sharedFields.length > 0 && (
        <View style={styles.tagsRow}>
          <Text style={styles.rowLabel}>{t('history.label_fields')}</Text>
          <View style={styles.tags}>
            {item.sharedFields.map((f) => (
              <View key={f} style={styles.tag}>
                <Text style={styles.tagText}>{f}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={records.length === 0 ? styles.emptyContainer : styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={branding.primaryColor} />}
        ListEmptyComponent={
          <View style={styles.emptyInner}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>{t('history.empty_title')}</Text>
            <Text style={styles.emptyBody}>{t('history.empty_body')}</Text>
          </View>
        }
        ListFooterComponent={
          records.length > 0 ? (
            <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
              <Text style={styles.clearText}>{t('history.clear_btn')}</Text>
            </TouchableOpacity>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  listContent: { padding: 16, paddingBottom: 40 },
  emptyContainer: { flex: 1, padding: 24 },
  emptyInner: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptyBody: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  dateText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', marginBottom: 6, gap: 8 },
  rowLabel: { fontSize: 12, color: '#9CA3AF', fontWeight: '600', width: 80, flexShrink: 0, paddingTop: 1 },
  rowValue: { fontSize: 14, color: '#111827', flex: 1 },
  tagsRow: { flexDirection: 'row', marginTop: 4, gap: 8 },
  tags: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: '#F3F4F6', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 12, color: '#374151' },
  clearBtn: { marginTop: 8, paddingVertical: 12, alignItems: 'center' },
  clearText: { fontSize: 14, color: '#DC2626' },
});
