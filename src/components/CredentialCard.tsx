import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CredentialEntry } from '../utils/credential';
import { getExpiryStatus, daysUntilExpiry, issuerCardColor } from '../utils/credential';
import { NotchedSurface } from './NotchedSurface';
import { walletDesign } from '../../branding.config';

export const CARD_HEIGHT  = walletDesign.cardHeight;
export const TAB_RX       = walletDesign.tabRX;
export const TAB_RY       = walletDesign.tabRY;
export const TAB_SHOULDER = walletDesign.tabShoulder;
const CORNER_RADIUS       = walletDesign.cardCornerRadius;

type Props = {
  entry: CredentialEntry;
  /** Pixel width measured by the parent deck — required for the notch geometry. */
  width: number;
  onPress: () => void;
};

function issuerInitials(issuer: string): string {
  const words = issuer.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

export const CredentialCard: React.FC<Props> = ({ entry, width, onPress }) => {
  const { t } = useTranslation();
  const status = getExpiryStatus(entry.expiryDate);

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
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <NotchedSurface
        width={width}
        height={CARD_HEIGHT + TAB_RY}
        color={issuerCardColor(entry.issuer)}
        cornerRadius={CORNER_RADIUS}
        tabRX={TAB_RX}
        tabRY={TAB_RY}
        tabShoulder={TAB_SHOULDER}
      >
        <View style={styles.content}>
          <View style={styles.leftSection}>
            <View style={styles.iconBox}>
              <Text style={styles.iconText}>{issuerInitials(entry.issuer)}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.rightSection}>
            <Text style={styles.credentialName} numberOfLines={2}>
              {entry.type}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.issuerName} numberOfLines={1}>
                {entry.issuer}
              </Text>
              <View style={[styles.badge, { backgroundColor: badgeBg }]}>
                <View style={[styles.badgeDot, { backgroundColor: badgeAccent }]} />
                <Text style={[styles.badgeText, { color: badgeAccent }]}>{badgeLabel}</Text>
              </View>
            </View>
          </View>
        </View>
      </NotchedSurface>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  // The tab lives in its own band below the body, so content fills the body freely.
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  leftSection: {
    width: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  issuerName: {
    flex: 1,                            // ocupa el espacio y empuja el badge a la derecha
    fontSize: 12,                       // 🎛️ tamaño del nombre del emisor (subtítulo)
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.2,
  },
  divider: {
    width: 1,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginHorizontal: 14,
  },
  rightSection: {
    flex: 1,
    justifyContent: 'center',
    gap: 5,
  },
  credentialName: {
    fontSize: 19,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.2,
    lineHeight: 22,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  badgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
