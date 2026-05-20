import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CredentialEntry } from '../utils/credential';
import { getExpiryStatus, daysUntilExpiry, issuerCardColor } from '../utils/credential';

type Props = {
  entry: CredentialEntry;
  onPress: () => void;
};

function issuerInitials(issuer: string): string {
  const words = issuer.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

export const CredentialCard: React.FC<Props> = ({ entry, onPress }) => {
  const { t, i18n } = useTranslation();
  const status = getExpiryStatus(entry.expiryDate);

  const date = new Date(entry.issuanceDate).toLocaleDateString(i18n.language, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const badgeLabel =
    status === 'expired'
      ? t('credentials.expired_badge').toUpperCase()
      : status === 'expiring'
      ? t('credentials.expiring_badge', { days: daysUntilExpiry(entry.expiryDate!) }).toUpperCase()
      : t('credentials.valid_badge').toUpperCase();

  const badgeBg =
    status === 'expired' ? 'rgba(127,29,29,0.8)' :
    status === 'expiring' ? 'rgba(120,53,15,0.8)' :
    'rgba(20,83,45,0.8)';

  const badgeAccent =
    status === 'expired' ? '#fca5a5' :
    status === 'expiring' ? '#fcd34d' :
    '#86efac';

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: issuerCardColor(entry.issuer) }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.topRow}>
        <View style={styles.iconBox}>
          <Text style={styles.iconText}>{issuerInitials(entry.issuer)}</Text>
        </View>
        <View style={styles.issuerBlock}>
          <Text style={styles.issuerName} numberOfLines={1}>
            {entry.issuer.toUpperCase()}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: badgeBg }]}>
          <View style={[styles.badgeDot, { backgroundColor: badgeAccent }]} />
          <Text style={[styles.badgeText, { color: badgeAccent }]}>{badgeLabel}</Text>
        </View>
      </View>

      <Text style={styles.credentialName} numberOfLines={2}>
        {entry.type}
      </Text>

      <View style={styles.bottomRow}>
        <Text style={styles.bottomLabel}>{t('credentials.issued_label').toUpperCase()}</Text>
        <Text style={styles.bottomValue}>{date}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    marginBottom: 14,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 7,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    gap: 10,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },
  issuerBlock: {
    flex: 1,
  },
  issuerName: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 0.8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  credentialName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 22,
    letterSpacing: 0.2,
    lineHeight: 28,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottomLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.8,
  },
  bottomValue: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.8,
  },
});
