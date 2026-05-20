import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SdJwtVcRecord } from '@credo-ts/core';
import { branding } from '../../../branding.config';
import { useAgentState } from '../../../src/agent/context';
import {
  CredentialEntry,
  daysUntilExpiry,
  formatClaimKey,
  formatClaimValue,
  fromSdJwtRecord,
  fromW3cRecord,
  fromW3cV2Record,
  getExpiryStatus,
  issuerCardColor,
} from '../../../src/utils/credential';
import { checkRevocationStatus, type RevocationStatus } from '../../../src/agent/revocation';

export default function CredentialDetail() {
  const { t, i18n } = useTranslation();
  const { id, format } = useLocalSearchParams<{ id: string; format: string }>();
  const agentState = useAgentState();
  const [entry, setEntry] = useState<CredentialEntry | null>(null);
  const [revocationStatus, setRevocationStatus] = useState<RevocationStatus | 'checking'>('checking');

  useEffect(() => {
    if (agentState.status !== 'ready' || !id) return;
    const { agent } = agentState;
    (async () => {
      try {
        if (format === 'sdjwt') {
          const record = await agent.sdJwtVc.getById(id);
          setEntry(fromSdJwtRecord(record));
          const compact = (record as SdJwtVcRecord).firstCredential.compact;
          checkRevocationStatus(compact)
            .then(setRevocationStatus)
            .catch(() => setRevocationStatus('unknown'));
        } else {
          try {
            const record = await agent.w3cV2Credentials.getById(id);
            setEntry(fromW3cV2Record(record));
          } catch {
            const record = await agent.w3cCredentials.getById(id);
            setEntry(fromW3cRecord(record));
          }
          setRevocationStatus('unknown');
        }
      } catch {
        router.back();
      }
    })();
  }, [agentState, id, format]);

  const handleDelete = () => {
    Alert.alert(
      t('credentials.delete_confirm_title'),
      t('credentials.delete_confirm_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('credentials.delete_confirm_ok'),
          style: 'destructive',
          onPress: performDelete,
        },
      ],
    );
  };

  const performDelete = async () => {
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

  const expiryStatus = getExpiryStatus(entry.expiryDate);
  const issuanceDateStr = new Date(entry.issuanceDate).toLocaleDateString(i18n.language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let expiryLabel: string | null = null;
  if (entry.expiryDate) {
    const days = daysUntilExpiry(entry.expiryDate);
    if (expiryStatus === 'expired') {
      expiryLabel = t('credentials.expired_badge');
    } else if (expiryStatus === 'expiring') {
      expiryLabel = t('credentials.expiring_badge', { days });
    } else {
      expiryLabel = new Date(entry.expiryDate).toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  }

  const headerBg =
    revocationStatus === 'revoked' ? '#DC2626' :
    expiryStatus === 'expired' ? '#DC2626' :
    expiryStatus === 'expiring' ? '#D97706' :
    issuerCardColor(entry.issuer);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={[styles.header, { backgroundColor: headerBg }]}>
        <Text style={styles.headerType}>{entry.type}</Text>
        <Text style={styles.headerDate}>{issuanceDateStr}</Text>
        {expiryLabel && (
          <View style={styles.expiryRow}>
            <Text style={styles.expiryLabel}>
              {expiryStatus === 'expired' || expiryStatus === 'expiring'
                ? expiryLabel
                : `${t('credentials.label_expiry')}: ${expiryLabel}`}
            </Text>
          </View>
        )}
        {revocationStatus === 'revoked' && (
          <View style={styles.expiryRow}>
            <Text style={styles.expiryLabel}>{t('credentials.revoked_badge')}</Text>
          </View>
        )}
        {revocationStatus === 'checking' && format === 'sdjwt' && (
          <View style={[styles.expiryRow, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
            <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />
            <Text style={[styles.expiryLabel, { opacity: 0.7 }]}>{t('credentials.checking_revocation')}</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('credentials.label_issuer')}</Text>
        <Text style={styles.sectionValue}>{entry.issuer}</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionLabelRow}>
          <Text style={styles.sectionLabel}>{t('credentials.label_attributes')}</Text>
          {entry.sdFields.length > 0 && (
            <Text style={styles.sdLegend}>{t('credentials.sd_legend')}</Text>
          )}
        </View>
        {entry.selectiveFields.map((key) => {
          const value = entry.claims[key];
          const isSd = entry.sdFields.includes(key);
          return (
            <View key={key} style={styles.claim}>
              <View style={styles.claimHeader}>
                <Text style={styles.claimKey}>{formatClaimKey(key)}</Text>
                {isSd && (
                  <View style={styles.sdBadge}>
                    <Text style={styles.sdBadgeText}>SD</Text>
                  </View>
                )}
              </View>
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
  expiryRow: { marginTop: 8 },
  expiryLabel: { fontSize: 13, fontWeight: '600', color: '#fff' },
  section: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 16, borderRadius: 12, padding: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionValue: { fontSize: 15, color: '#111827' },
  sectionLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sdLegend: { fontSize: 11, color: '#6B7280' },
  claim: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  claimHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 2, gap: 6 },
  claimKey: { fontSize: 12, color: '#6B7280' },
  sdBadge: { backgroundColor: '#EEF2FF', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  sdBadgeText: { fontSize: 10, fontWeight: '700', color: '#4F46E5', letterSpacing: 0.5 },
  claimValue: { fontSize: 15, color: '#111827', fontWeight: '500' },
  actionBtn: { margin: 16, marginTop: 24, height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteBtn: { marginHorizontal: 16, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#FCA5A5' },
  deleteBtnText: { color: '#DC2626', fontSize: 15, fontWeight: '500' },
});
