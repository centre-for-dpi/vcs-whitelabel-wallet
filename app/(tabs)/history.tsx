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
import { TRUST_COLORS, TRUST_ICONS } from '../../src/agent/trust';
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

  const renderItem = ({ item }: { item: PresentationRecord }) => {
    const trust = item.trustStatus ?? 'unknown';
    const protocol = item.protocol?.toUpperCase() ?? 'OID4VP';
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.dateText}>{formatDate(item.timestamp)}</Text>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: TRUST_COLORS[trust] + '18', borderColor: TRUST_COLORS[trust] }]}>
              <Text style={[styles.badgeText, { color: TRUST_COLORS[trust] }]}>
                {TRUST_ICONS[trust]} {t(`trust.${trust}`)}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: branding.primaryColor + '18', borderColor: branding.primaryColor }]}>
              <Text style={[styles.badgeText, { color: branding.primaryColor }]}>{protocol}</Text>
            </View>
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

        {(item.privateFields ?? []).length > 0 && (
          <View style={styles.tagsRow}>
            <Text style={styles.rowLabel}>{t('history.label_private')}</Text>
            <View style={styles.tags}>
              {(item.privateFields ?? []).map((f) => (
                <View key={f} style={styles.tagPrivate}>
                  <Text style={styles.tagPrivateText}>🔒 {f}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

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
  dateText: { fontSize: 13, color: '#6B7280', fontWeight: '500', flex: 1 },
  badgeRow: { flexDirection: 'row', gap: 4 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  row: { flexDirection: 'row', marginBottom: 6, gap: 8 },
  rowLabel: { fontSize: 12, color: '#9CA3AF', fontWeight: '600', width: 80, flexShrink: 0, paddingTop: 1 },
  rowValue: { fontSize: 14, color: '#111827', flex: 1 },
  tagsRow: { flexDirection: 'row', marginTop: 4, gap: 8 },
  tags: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: '#F3F4F6', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 12, color: '#374151' },
  tagPrivate: { backgroundColor: '#F9FAFB', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#E5E7EB' },
  tagPrivateText: { fontSize: 12, color: '#9CA3AF' },
  clearBtn: { marginTop: 8, paddingVertical: 12, alignItems: 'center' },
  clearText: { fontSize: 14, color: '#DC2626' },
});
