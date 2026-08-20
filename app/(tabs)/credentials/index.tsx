import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  LayoutChangeEvent,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SdJwtVcRepository } from '@credo-ts/core';
import { branding, walletDesign, discoveryConfig } from '../../../branding.config';
import { useAgentState } from '../../../src/agent/context';
import { useUser } from '../../../src/auth/UserContext';
import { CredentialCard, CARD_HEIGHT, TAB_RX, TAB_RY, TAB_SHOULDER } from '../../../src/components/CredentialCard';
import { CredentialDetailSheet } from '../../../src/components/CredentialDetailSheet';
import {
  NotchedSurface,
  PocketDivider,
  WalletFrame,
  POCKET_RADIUS,
  DIVIDER_GAP,
} from '../../../src/components/NotchedSurface';
import {
  CredentialEntry,
  fromMdocRecord,
  fromSdJwtRecord,
  fromW3cRecord,
  fromW3cV2Record,
} from '../../../src/utils/credential';
import { OidcUser, getUserDisplayName } from '../../../src/utils/storage';
import { registerMdlDigitalCredentials } from '../../../src/agent/mdl/registerDigitalCredentials';

// Best-effort initial wallet width (corrected precisely by onLayout).
const INITIAL_WALLET_WIDTH = Dimensions.get('window').width - walletDesign.pocketScreenGap * 2;

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
  const [selected, setSelected] = useState<CredentialEntry | null>(null);

  // Horizontal layers, outer → inner:
  //   gray bg (= walletW)  →  frameBgGap  →  dashed frame  →  cardFrameGap  →  card
  const frameW    = walletW - walletDesign.frameBgGap * 2;
  const cardWidth = frameW - walletDesign.cardFrameGap * 2;

  // The frame starts at the first divider (below the first card), so the first
  // row has no lines. The pocket corners now curve DOWN, so the rails begin at
  // the straight run (card bottom + gap) plus the corner drop (pocketRadius).
  const frameTopInset = walletDesign.walletPad + CARD_HEIGHT + DIVIDER_GAP + POCKET_RADIUS;

  const onWalletLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && Math.abs(width - walletW) > 0.5) setWalletW(width);
    if (height > 0 && Math.abs(height - walletH) > 0.5) setWalletH(height);
  };

  const load = useCallback(async () => {
    if (agentState.status !== 'ready') return;
    const { agent } = agentState;
    try {
      const [sdJwtRecords, w3cRecords, w3cV2Records, mdocRecords] = await Promise.all([
        agent.sdJwtVc.getAll(),
        agent.w3cCredentials.getAll(),
        agent.w3cV2Credentials.getAll(),
        agent.mdoc.getAll(),
      ]);
      const all: CredentialEntry[] = [];
      for (const r of sdJwtRecords)  { try { all.push(fromSdJwtRecord(r));  } catch (e) { console.error('[cred] sdjwt:', e); } }
      for (const r of w3cRecords)    { try { all.push(fromW3cRecord(r));    } catch (e) { console.error('[cred] w3c:', e);   } }
      for (const r of w3cV2Records)  { try { all.push(fromW3cV2Record(r));  } catch (e) { console.error('[cred] w3cv2:', e); } }
      for (const r of mdocRecords)   { try { all.push(fromMdocRecord(r));   } catch (e) { console.error('[cred] mdoc:', e);  } }
      all.sort((a, b) => new Date(b.issuanceDate).getTime() - new Date(a.issuanceDate).getTime());
      setEntries(all);

      // C.7.3b: keep the Android system credential picker's registry in sync
      // with whatever mdocs this wallet actually holds, on every load —
      // registerCredentials' own contract is "call again whenever the set of
      // credentials changes," and this is the one place that already knows
      // the current mdocRecords. Android-only (Platform check happens inside
      // the package itself; harmless no-op on iOS) and never allowed to break
      // the credential list UI if it fails — registration is best-effort.
      if (Platform.OS === 'android') {
        registerMdlDigitalCredentials(mdocRecords).catch((e) =>
          console.error('[cred] digital credentials registration:', e)
        );
      }
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

  const handlePresent = (entry: CredentialEntry) => {
    setSelected(null);
    // mso_mdoc presentation is BLE proximity (ISO 18013-5 device retrieval),
    // an entirely different transport/flow from /present's OID4VP HTTP
    // request-object flow that every other format uses — routing an mdoc
    // through /present would 404 on `id` lookup against the wrong record type.
    const pathname = entry.format === 'mdoc' ? '/present-mdl' : '/present';
    router.push({ pathname, params: { id: entry.id, format: entry.format } });
  };

  const handleDelete = async (entry: CredentialEntry) => {
    if (agentState.status !== 'ready') return;
    const { agent } = agentState;
    try {
      if (entry.format === 'sdjwt') {
        try {
          await agent.sdJwtVc.deleteById(entry.id);
        } catch {
          const repo = agent.dependencyManager.resolve(SdJwtVcRepository);
          await repo.deleteById(agent.context, entry.id);
        }
      } else if (entry.format === 'mdoc') {
        await agent.mdoc.deleteById(entry.id);
      } else {
        try {
          await agent.w3cV2Credentials.deleteById(entry.id);
        } catch {
          await agent.w3cCredentials.deleteById(entry.id);
        }
      }
    } catch { /* ignore — refresh regardless */ }
    setSelected(null);
    load();
  };

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
          {discoveryConfig.enabled && (
            <TouchableOpacity
              style={[styles.scanBtn, styles.discoverBtn]}
              onPress={() => router.push('/(tabs)/discover')}
            >
              <Text style={[styles.scanBtnText, { color: branding.primaryColor }]}>
                {t('credentials.discover_btn')}
              </Text>
            </TouchableOpacity>
          )}
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
                    top: walletDesign.walletPad + CARD_HEIGHT,
                    backgroundColor: walletDesign.pocketBgColor,
                    borderColor: walletDesign.pocketBorderColor,
                    borderLeftWidth: walletDesign.pocketBorderWidth,
                    borderRightWidth: walletDesign.pocketBorderWidth,
                    borderBottomWidth: walletDesign.pocketBorderWidth,
                  },
                ]}
              />
              {/* Dashed frame, inset from the gray bg by frameBgGap */}
              <WalletFrame
                width={frameW}
                height={walletH}
                topInset={frameTopInset}
                style={{ position: 'absolute', top: 0, left: walletDesign.frameBgGap }}
              />

              <View style={styles.walletInner}>
                {entries.map((entry) => (
                  <View key={entry.id}>
                    <View style={styles.cardWrap}>
                      <CredentialCard
                        entry={entry}
                        width={cardWidth}
                        onPress={() => setSelected(entry)}
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
                      height={CARD_HEIGHT + walletDesign.tabRY}
                      color={walletDesign.addCardBgColor}
                      tabRX={walletDesign.tabRX}
                      tabRY={walletDesign.tabRY}
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

      <CredentialDetailSheet
        entry={selected}
        onClose={() => setSelected(null)}
        onPresent={handlePresent}
        onDelete={handleDelete}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: walletDesign.screenBgColor },
  content:   { paddingBottom: 48 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: walletDesign.screenBgColor },

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
  deck:   { paddingHorizontal: walletDesign.pocketScreenGap },  // gray bg ↔ screen edge
  wallet: { position: 'relative' },                              // = the gray-bg area; layers drawn as children
  walletInner: { paddingVertical: walletDesign.walletPad },      // top/bottom padding inside
  cardWrap: { marginHorizontal: walletDesign.frameBgGap + walletDesign.cardFrameGap }, // card ↔ screen (past frame)
  // Pocket fill behind the cards; fills the wallet width, `top` set inline.
  pocketBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: walletDesign.pocketBgRadius,
  },
  // Divider positions itself vertically; here we inset it to the dashed frame
  // and set the separation before the next card.
  dividerWrap: {
    marginHorizontal: walletDesign.frameBgGap,
    marginBottom: walletDesign.knotToNextCard,
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
  discoverBtn: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: branding.primaryColor, marginTop: 10 },
  scanBtnText: { color: '#fff', fontWeight: '600' },
});
