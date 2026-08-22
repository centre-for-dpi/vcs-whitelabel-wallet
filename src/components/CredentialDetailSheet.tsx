import type { SdJwtVcRecord } from '@credo-ts/core';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { branding } from '../../branding.config';
import { checkRevocationStatus, type RevocationStatus } from '../agent/revocation';
import {
  CredentialEntry,
  daysUntilExpiry,
  claimImageUri,
  formatClaimKey,
  formatClaimValue,
  getExpiryStatus,
  getSdJwtCompact,
  issuerCardColor,
} from '../utils/credential';

type Props = {
  entry: CredentialEntry | null;
  onClose: () => void;
  onPresent: (entry: CredentialEntry) => void;
  onDelete: (entry: CredentialEntry) => void;
};

/**
 * Bottom-sheet modal that shows a credential's full data inline, instead of
 * navigating to a detail screen. Driven by `entry`: non-null opens the sheet.
 */
export const CredentialDetailSheet: React.FC<Props> = ({ entry, onClose, onPresent, onDelete }) => {
  const { t, i18n } = useTranslation();
  const [revocationStatus, setRevocationStatus] = useState<RevocationStatus | 'checking'>('checking');

  useEffect(() => {
    if (!entry) return;
    setRevocationStatus('checking');
    if (entry.format !== 'sdjwt') {
      setRevocationStatus('unknown');
      return;
    }
    let compact: string | undefined;
    try {
      compact = (entry.rawRecord as SdJwtVcRecord).firstCredential.compact;
    } catch {
      compact = getSdJwtCompact(entry.rawRecord as SdJwtVcRecord);
    }
    if (compact) {
      checkRevocationStatus(compact).then(setRevocationStatus).catch(() => setRevocationStatus('unknown'));
    } else {
      setRevocationStatus('unknown');
    }
  }, [entry]);

  const confirmDelete = () => {
    if (!entry) return;
    Alert.alert(
      t('credentials.delete_confirm_title'),
      t('credentials.delete_confirm_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('credentials.delete_confirm_ok'), style: 'destructive', onPress: () => onDelete(entry) },
      ],
    );
  };

  const dateStr = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' });

  const expiryStatus = entry ? getExpiryStatus(entry.expiryDate) : 'none';
  const selective = (entry?.sdFields.length ?? 0) > 0;

  let expiryLabel: string | null = null;
  if (entry?.expiryDate) {
    const days = daysUntilExpiry(entry.expiryDate);
    if (expiryStatus === 'expired') expiryLabel = t('credentials.expired_badge');
    else if (expiryStatus === 'expiring') expiryLabel = t('credentials.expiring_badge', { days });
    else expiryLabel = `${t('credentials.label_expiry')}: ${dateStr(entry.expiryDate)}`;
  }

  const headerBg = !entry
    ? branding.primaryColor
    : revocationStatus === 'revoked' || expiryStatus === 'expired'
    ? '#DC2626'
    : expiryStatus === 'expiring'
    ? '#D97706'
    : issuerCardColor(entry.issuer);

  return (
    <Modal visible={entry !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <View style={styles.sheet}>
          {entry && (
            <>
              {/* Header */}
              <View style={[styles.header, { backgroundColor: headerBg }]}>
                <View style={styles.handle} />
                <Text style={styles.headerIssuer} numberOfLines={1}>{entry.issuer}</Text>
                <Text style={styles.headerType} numberOfLines={2}>{entry.type}</Text>
                <Text style={styles.headerDate}>{dateStr(entry.issuanceDate)}</Text>

                {/* Disclosure mode — below the issuance date */}
                <View style={styles.headerDisclosure}>
                  <View style={[styles.disclosureDot, { backgroundColor: selective ? '#C7D2FE' : 'rgba(255,255,255,0.75)' }]} />
                  <Text style={styles.headerDisclosureText}>
                    {selective ? t('credentials.disclosure_selective') : t('credentials.disclosure_full')}
                  </Text>
                </View>

                {expiryLabel && <Text style={styles.headerMeta}>{expiryLabel}</Text>}
                {revocationStatus === 'revoked' && (
                  <Text style={styles.headerMeta}>{t('credentials.revoked_badge')}</Text>
                )}
                {revocationStatus === 'checking' && entry.format === 'sdjwt' && (
                  <View style={styles.checkingRow}>
                    <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" />
                    <Text style={[styles.headerMeta, { opacity: 0.7 }]}>{t('credentials.checking_revocation')}</Text>
                  </View>
                )}
                <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10}>
                  <Text style={styles.closeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Fixed: actions — side by side */}
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: branding.primaryColor }]}
                  onPress={() => onPresent(entry)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionIcon}>📤</Text>
                  <Text style={styles.actionBtnText}>{t('credentials.present_short')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, styles.deleteBtn]}
                  onPress={confirmDelete}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionIcon}>🗑️</Text>
                  <Text style={styles.deleteBtnText}>{t('credentials.delete_short')}</Text>
                </TouchableOpacity>
              </View>

              {/* Scrollable: only the attributes */}
              <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                <View style={styles.section}>
                  {entry.selectiveFields.map((key) => (
                    <View key={key} style={styles.claim}>
                      <Text style={styles.claimKey}>{formatClaimKey(key)}</Text>
                      {/* Image-valued claims (portrait) render as the picture
                          itself; formatClaimValue would otherwise print a
                          mime/size summary, since dumping the raw bytes was
                          what produced a wall of digits. */}
                      {claimImageUri(entry.claims[key]) ? (
                        <Image
                          source={{ uri: claimImageUri(entry.claims[key]) as string }}
                          style={styles.claimImage}
                          resizeMode="contain"
                          accessibilityLabel={formatClaimKey(key)}
                        />
                      ) : (
                        <Text style={styles.claimValue}>{formatClaimValue(entry.claims[key])}</Text>
                      )}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheet: {
    maxHeight: '88%',
    backgroundColor: '#F9FAFB',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  header: { padding: 24, paddingTop: 12 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.5)', marginBottom: 16 },
  headerIssuer: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.8)', marginBottom: 2, paddingRight: 28 },
  headerType: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 4, paddingRight: 28 },
  headerDate: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  headerDisclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  headerDisclosureText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  headerMeta: { fontSize: 13, fontWeight: '600', color: '#fff', marginTop: 8 },
  checkingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  closeBtn: { position: 'absolute', top: 14, right: 16, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: 'rgba(255,255,255,0.9)', fontSize: 16, fontWeight: '700' },

  body: { flexShrink: 1 },   // uses content height, but shrinks (and scrolls) when the sheet caps
  bodyContent: { paddingBottom: 24 },
  section: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 16, borderRadius: 12, padding: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8 },
  disclosureDot: { width: 7, height: 7, borderRadius: 3.5 },

  claim: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  claimKey: { fontSize: 12, color: '#6B7280', marginBottom: 2 },
  claimValue: { fontSize: 15, color: '#111827', fontWeight: '500' },
  // Portrait-sized, not full-bleed: an ISO 18013-5 portrait is a small
  // headshot and stretching it across the sheet reads as a banner.
  claimImage: {
    width: 120,
    height: 150,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
    marginTop: 4,
  },

  // Action buttons, side by side
  actionsRow: { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 16 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
  },
  actionIcon: { fontSize: 16 },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  deleteBtn: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FCA5A5' },
  deleteBtnText: { color: '#DC2626', fontSize: 15, fontWeight: '600' },
});
