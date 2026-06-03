import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  LayoutChangeEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { branding } from '../../../branding.config';
import { useAgentState } from '../../../src/agent/context';
import { useUser } from '../../../src/auth/UserContext';
import { CredentialCard, CARD_HEIGHT, TAB_RX, TAB_RY, TAB_SHOULDER } from '../../../src/components/CredentialCard';
import {
  NotchedSurface,
  PocketDivider,
  WalletFrame,
  POCKET_RADIUS,
  DIVIDER_GAP,
} from '../../../src/components/NotchedSurface';
import {
  CredentialEntry,
  fromSdJwtRecord,
  fromW3cRecord,
  fromW3cV2Record,
} from '../../../src/utils/credential';
import { OidcUser, getUserDisplayName } from '../../../src/utils/storage';

const SCREEN_BG = '#F9FAFB';
const WALLET_PAD = 14;            // padding vertical interno (arriba/abajo) del wallet
const ADD_BG     = '#4B5563';

// 🎛️ Colores
const POCKET_BG           = '#e9ebec'; // color de fondo de los pockets
const POCKET_BORDER_COLOR = '#D7DBE0'; // color del borde del fondo gris

// 🎛️ Separaciones horizontales (de afuera hacia adentro)
const POCKET_SCREEN_GAP = 10; // fondo gris ↔ borde de la pantalla
const FRAME_BG_GAP      = 12; // líneas punteadas ↔ borde del fondo gris
const CARD_FRAME_GAP    = 14;  // tarjetas ↔ líneas punteadas

// 🎛️ Otros
const POCKET_BORDER_WIDTH = 6; // grosor del borde del fondo gris
const POCKET_BG_RADIUS    = 18;  // radio de las esquinas del fondo gris (arriba y abajo)
const KNOT_TO_NEXT_CARD   = 60;  // 🎛️ separación entre el knot y la siguiente tarjeta (alto del pocket)

// The add card uses a bigger, rounder knot so the "+" can nest inside it.
const ADD_TAB_RX = 48;
const ADD_TAB_RY = 36;

// Best-effort initial wallet width so the first frame already draws correctly
// (corrected precisely by onLayout). The wallet = the gray-bg area; the deck
// pads it away from the screen by POCKET_SCREEN_GAP on each side.
const INITIAL_WALLET_WIDTH = Dimensions.get('window').width - POCKET_SCREEN_GAP * 2;

function userInitials(user: OidcUser): string {
  if (user.given_name && user.family_name)
    return (user.given_name[0] + user.family_name[0]).toUpperCase();
  if (user.given_name) return user.given_name.slice(0, 2).toUpperCase();
  if (user.name) {
    const parts = user.name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  return user.email?.slice(0, 2).toUpperCase() ?? '??';
}

export default function CredentialList() {
  const { t } = useTranslation();
  const agentState = useAgentState();
  const { user }   = useUser();
  const [entries,    setEntries]    = useState<CredentialEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [walletW, setWalletW] = useState(INITIAL_WALLET_WIDTH);
  const [walletH, setWalletH] = useState(0);

  // Horizontal layers, outer → inner:
  //   gray bg (= walletW)  →  FRAME_BG_GAP  →  dashed frame  →  CARD_FRAME_GAP  →  card
  const frameW    = walletW - FRAME_BG_GAP * 2;
  const cardWidth = frameW - CARD_FRAME_GAP * 2;

  // The frame starts at the first divider (below the first card), so the first
  // row has no lines. The pocket corners now curve DOWN, so the rails begin at
  // the straight run (card bottom + gap) plus the corner drop (pocketRadius).
  const frameTopInset = WALLET_PAD + CARD_HEIGHT + DIVIDER_GAP + POCKET_RADIUS;

  const onWalletLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && Math.abs(width - walletW) > 0.5) setWalletW(width);
    if (height > 0 && Math.abs(height - walletH) > 0.5) setWalletH(height);
  };

  const load = useCallback(async () => {
    if (agentState.status !== 'ready') return;
    const { agent } = agentState;
    try {
      const [sdJwtRecords, w3cRecords, w3cV2Records] = await Promise.all([
        agent.sdJwtVc.getAll(),
        agent.w3cCredentials.getAll(),
        agent.w3cV2Credentials.getAll(),
      ]);
      const all: CredentialEntry[] = [];
      for (const r of sdJwtRecords)  { try { all.push(fromSdJwtRecord(r));  } catch (e) { console.error('[cred] sdjwt:', e); } }
      for (const r of w3cRecords)    { try { all.push(fromW3cRecord(r));    } catch (e) { console.error('[cred] w3c:', e);   } }
      for (const r of w3cV2Records)  { try { all.push(fromW3cV2Record(r));  } catch (e) { console.error('[cred] w3cv2:', e); } }
      all.sort((a, b) => new Date(b.issuanceDate).getTime() - new Date(a.issuanceDate).getTime());
      setEntries(all);
    } catch (e) {
      console.error('[cred] load:', e);
      setEntries([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agentState]);

  useEffect(()       => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  if (agentState.status !== 'ready' || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={branding.primaryColor} />
      </View>
    );
  }

  const displayName = user ? getUserDisplayName(user) : undefined;
  const initials    = user ? userInitials(user) : undefined;
  const credCount   = entries.length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={branding.primaryColor} />
      }
    >
      {/* ── User profile ────────────────────────────────────────────────── */}
      {(displayName || initials) && (
        <View style={styles.profileSection}>
          <View style={[styles.avatarCircle, { backgroundColor: branding.primaryColor + '22' }]}>
            <Text style={[styles.avatarText, { color: branding.primaryColor }]}>
              {initials ?? '??'}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            {displayName && <Text style={styles.profileName}>{displayName}</Text>}
            <Text style={styles.profileCount}>
              {credCount === 1
                ? t('credentials.count_one',   { count: 1 })
                : t('credentials.count_other', { count: credCount })}
            </Text>
          </View>
        </View>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🪪</Text>
          <Text style={styles.emptyTitle}>{t('credentials.empty_title')}</Text>
          <Text style={styles.emptyBody}>{t('credentials.empty_body')}</Text>
          <TouchableOpacity
            style={[styles.scanBtn, { backgroundColor: branding.primaryColor }]}
            onPress={() => router.push('/(tabs)/scan')}
          >
            <Text style={styles.scanBtnText}>{t('credentials.scan_btn')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.tapHint}>{t('credentials.tap_hint')}</Text>

          {/* ── Card holder (dashed wallet) ───────────────────────────── */}
          <View style={styles.deck}>
            <View style={styles.wallet} onLayout={onWalletLayout}>
              {/* Gray pocket fill (with border), behind everything. Starts right
                  under the first card and spans the full wallet (= outer layer). */}
              <View
                style={[
                  styles.pocketBg,
                  {
                    top: WALLET_PAD + CARD_HEIGHT,
                    backgroundColor: POCKET_BG,
                    borderColor: POCKET_BORDER_COLOR,
                    borderLeftWidth: POCKET_BORDER_WIDTH,
                    borderRightWidth: POCKET_BORDER_WIDTH,
                    borderBottomWidth: POCKET_BORDER_WIDTH,
                  },
                ]}
              />
              {/* Dashed frame, inset from the gray bg by FRAME_BG_GAP */}
              <WalletFrame
                width={frameW}
                height={walletH}
                topInset={frameTopInset}
                style={{ position: 'absolute', top: 0, left: FRAME_BG_GAP }}
              />

              <View style={styles.walletInner}>
                {entries.map((entry) => (
                  <View key={entry.id}>
                    <View style={styles.cardWrap}>
                      <CredentialCard
                        entry={entry}
                        width={cardWidth}
                        onPress={() =>
                          router.push({
                            pathname: '/(tabs)/credentials/[id]',
                            params: { id: entry.id, format: entry.format },
                          })
                        }
                      />
                    </View>
                    {/* Dashed line hugging the tab, reaching the side frame */}
                    <View style={styles.dividerWrap}>
                      <PocketDivider width={frameW} tabRX={TAB_RX} tabRY={TAB_RY} />
                    </View>
                  </View>
                ))}

                {/* ── Add card (same tab shape, opens scan) ───────────── */}
                <View style={styles.cardWrap}>
                  <TouchableOpacity
                    onPress={() => router.push('/(tabs)/scan')}
                    activeOpacity={0.8}
                  >
                    <NotchedSurface
                      width={cardWidth}
                      height={CARD_HEIGHT + ADD_TAB_RY}
                      color={ADD_BG}
                      tabRX={ADD_TAB_RX}
                      tabRY={ADD_TAB_RY}
                      tabShoulder={TAB_SHOULDER}
                    >
                      <View style={styles.addCard}>
                        <Text style={styles.addLabel}>{t('credentials.add_card')}</Text>
                        {/* "+" nested inside the knot at the bottom-center */}
                        <View style={styles.addCircleWrap} pointerEvents="none">
                          <View style={styles.addCircle}>
                            <Text style={styles.addPlus}>+</Text>
                          </View>
                        </View>
                      </View>
                    </NotchedSurface>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SCREEN_BG },
  content:   { paddingBottom: 48 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: SCREEN_BG },

  // ── Profile ──────────────────────────────────────────────────────────────────
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    gap: 14,
  },
  avatarCircle: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText:   { fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  profileInfo:  { gap: 2 },
  profileName:  { fontSize: 18, fontWeight: '700', color: '#111827' },
  profileCount: { fontSize: 13, color: '#6B7280', fontWeight: '500' },

  // ── Tap hint ─────────────────────────────────────────────────────────────────
  tapHint: {
    fontSize: 13, color: '#9CA3AF',
    textAlign: 'center', marginTop: 8, marginBottom: 14,
  },

  // ── Deck / wallet holder ──────────────────────────────────────────────────────
  deck:   { paddingHorizontal: POCKET_SCREEN_GAP },  // gray bg ↔ screen edge
  wallet: { position: 'relative' },                  // = the gray-bg area; layers drawn as children
  walletInner: { paddingVertical: WALLET_PAD },      // top/bottom padding inside
  cardWrap: { marginHorizontal: FRAME_BG_GAP + CARD_FRAME_GAP }, // card ↔ screen (past frame)
  // Pocket fill behind the cards; fills the wallet width, `top` set inline.
  pocketBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: POCKET_BG_RADIUS,
  },
  // Divider positions itself vertically; here we inset it to the dashed frame
  // and set the separation before the next card.
  dividerWrap: {
    marginHorizontal: FRAME_BG_GAP,
    marginBottom: KNOT_TO_NEXT_CARD,
  },

  // ── Add card ─────────────────────────────────────────────────────────────────
  addCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Anchors the "+" to the bottom-center; the negative offset dips it into the knot.
  addCircleWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -22,
    alignItems: 'center',
  },
  addCircle: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  addPlus:  { fontSize: 26, color: 'rgba(255,255,255,0.75)', lineHeight: 30, fontWeight: '300' },
  addLabel: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },

  // ── Empty state ───────────────────────────────────────────────────────────────
  empty:       { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, paddingTop: 64 },
  emptyIcon:   { fontSize: 48, marginBottom: 16 },
  emptyTitle:  { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptyBody:   { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  scanBtn:     { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  scanBtnText: { color: '#fff', fontWeight: '600' },
});
