import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DigitalCredentialsRequest } from '@animo-id/expo-digital-credentials-api';
import { sendErrorResponse } from '@animo-id/expo-digital-credentials-api';
import { branding } from '../../branding.config';
import { parseRequestedFieldNames } from '../agent/mdl/parseDigitalCredentialsRequest';

/**
 * Consent overlay Android launches when the user picks cdpi-wallet from the
 * system credential picker (Digital Credentials API, C.7.3b — registration
 * side in src/agent/mdl/registerDigitalCredentials.ts). Registered via
 * registerGetCredentialComponent per the package's documented entry-point
 * pattern; see index.js for the registration call and isGetCredentialActivity
 * guard.
 *
 * Renders full-screen with a transparent background — see the package's
 * README "Handling Credential Request" section — so this looks like an
 * overlay on top of whatever launched it, not a full app screen.
 *
 * STOPS SHORT of building and returning a real response. Completing that
 * needs a signed mdoc DeviceResponse whose SessionTranscript is derived from
 * the OpenID4VP handshake (ISO/IEC 18013-7 Annex C), not the BLE proximity
 * one signDeviceResponse.ts's buildDeviceResponse already knows how to build
 * for present-mdl.tsx. The spec this session is following
 * (docs/superpowers/specs/2026-08-17-mdl-iso18013-5-poc-design.md, decision
 * #9) explicitly scopes "mdoc via OID4VP / ISO 18013-7" OUT of Tramos A-D —
 * it says in so many words that it "needs its own spec." So the crypto here
 * is intentionally NOT implemented yet: doing it now would be solving 18013-7
 * without the spec the plan says that work requires. What IS in scope and
 * done: cdpi-wallet appearing in the system picker at all (registration) and
 * this screen correctly parsing and displaying what's being asked for before
 * any decision to build the signing path is made.
 */
export function DigitalCredentialsRequestOverlay({ request }: { request: DigitalCredentialsRequest }) {
  const { t } = useTranslation();

  const requestedFields = useMemo(() => {
    const names = new Set<string>();
    // request.request is a discriminated union: either `providers` (deprecated,
    // v0.x shape) or `requests` (the field the package says is the eventual
    // only one) — read whichever is present rather than assuming one.
    const entries =
      'requests' in request.request && request.request.requests
        ? request.request.requests.map((r) => r.data)
        : 'providers' in request.request && request.request.providers
          ? request.request.providers.map((p) => p.request)
          : [];
    for (const raw of entries) {
      for (const name of parseRequestedFieldNames(raw)) names.add(name);
    }
    return Array.from(names);
  }, [request]);

  const handleDeny = () => {
    sendErrorResponse({ errorMessage: t('digitalCredentials.error_generic') });
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.title}>{t('digitalCredentials.title')}</Text>
        <Text style={styles.subtitle}>{t('digitalCredentials.subtitle')}</Text>
        {requestedFields.map((name) => (
          <View key={name} style={styles.fieldRow}>
            <Text style={styles.fieldName}>{name}</Text>
          </View>
        ))}
        {/* Approve is intentionally absent: wiring it to a real signed
            response is the 18013-7 work this component's doc comment
            explains is out of scope for now. Only "deny" is wired, so the
            request at least resolves cleanly (an explicit error, not a
            silent hang) instead of pretending approval works. */}
        <TouchableOpacity style={styles.denyBtn} onPress={handleDeny}>
          <Text style={styles.denyText}>{t('digitalCredentials.deny_btn')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  card: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  title: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#6B7280', marginBottom: 16 },
  fieldRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  fieldName: { fontSize: 15, color: '#111827' },
  denyBtn: { height: 48, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  denyText: { color: branding.primaryColor, fontSize: 15, fontWeight: '600' },
});
