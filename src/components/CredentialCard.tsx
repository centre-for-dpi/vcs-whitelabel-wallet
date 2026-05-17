import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { branding } from '../../branding.config';
import type { CredentialEntry } from '../utils/credential';
import { getExpiryStatus, daysUntilExpiry } from '../utils/credential';

type Props = {
  entry: CredentialEntry;
  onPress: () => void;
};

export const CredentialCard: React.FC<Props> = ({ entry, onPress }) => {
  const { t, i18n } = useTranslation();
  const status = getExpiryStatus(entry.expiryDate);

  const date = new Date(entry.issuanceDate).toLocaleDateString(i18n.language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const accentColor =
    status === 'expired' ? '#DC2626' :
    status === 'expiring' ? '#D97706' :
    branding.primaryColor;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.accent, { backgroundColor: accentColor }]} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={[styles.type, { color: branding.textColor }]} numberOfLines={1}>
            {entry.type}
          </Text>
          {status === 'expired' && (
            <View style={styles.badgeExpired}>
              <Text style={styles.badgeText}>{t('credentials.expired_badge')}</Text>
            </View>
          )}
          {status === 'expiring' && entry.expiryDate && (
            <View style={styles.badgeExpiring}>
              <Text style={styles.badgeText}>
                {t('credentials.expiring_badge', { days: daysUntilExpiry(entry.expiryDate) })}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.issuer} numberOfLines={1}>{entry.issuer}</Text>
        <Text style={styles.date}>{date}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: branding.secondaryColor,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  accent: {
    width: 5,
  },
  body: {
    flex: 1,
    padding: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  type: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  issuer: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 4,
  },
  date: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  badgeExpired: {
    backgroundColor: '#FEE2E2',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeExpiring: {
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#374151',
  },
});
