import { MdocRecord } from '@credo-ts/core';
import { registerCredentials, type RegisterCredentialsOptions } from '@animo-id/expo-digital-credentials-api';

// CredentialItem / CredentialConfigurationMdoc are defined in the package's
// encodeCredentials module but not re-exported from its public index — only
// RegisterCredentialsOptions is. Derive the shapes from that instead of
// reaching into the package's internal module path.
type CredentialItem = RegisterCredentialsOptions['credentials'][number];
type CredentialConfigurationMdoc = Extract<CredentialItem['credential'], { format: 'mso_mdoc' }>;

/**
 * Registers every mdoc the wallet holds with Android's Credential Manager
 * (C.7.3b), so cdpi-wallet appears in the system credential picker —
 * androidx.credentials.registry — alongside Google Wallet whenever a site or
 * app requests a credential via the Digital Credentials API. This is a
 * SEPARATE presentation path from present-mdl.tsx's BLE proximity flow
 * (C.7.3): that one is the holder advertising over Bluetooth to a reader
 * physically nearby; this one is the OS handing the request to whichever
 * registered wallet the user picks, no radio involved.
 *
 * Registration only tells Android what credentials exist and how to
 * summarize them for the picker's matcher — it does NOT hand over the mdoc's
 * actual claim VALUES at this point. The real disclosure happens later, in
 * the consent screen the OS launches after the user picks this wallet (see
 * MyCredentialRequestOverlay.tsx), the same "show what's asked, require
 * approval before sending" pattern present-mdl.tsx already implements for
 * BLE (spec §S-3 criterion (c)).
 *
 * Must be called again every time the set of held mdocs changes (credential
 * added, deleted, or its content changes) — the registered set is NOT
 * derived live from the wallet's storage on demand.
 */
export async function registerMdlDigitalCredentials(mdocRecords: MdocRecord[]): Promise<void> {
  const credentials = mdocRecords
    .map(toCredentialItem)
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Registering with an empty array is a valid, meaningful call — it clears
  // any stale entries from a previous run (e.g. the one mdoc the wallet held
  // was deleted). Skipping the call here would leave Android showing an
  // offer for a credential that's already gone.
  await registerCredentials({
    matcher: 'cmwallet',
    credentials,
  } satisfies RegisterCredentialsOptions);
}

/**
 * Converts one stored mdoc into the shape registerCredentials expects.
 *
 * The namespaces field only accepts string | number | boolean | null per
 * elements — CredentialItem's own doc comment says pass null for nested or
 * binary values "as it's not possible to do matching for those claims".
 * portrait (bstr) and driving_privileges (a nested CBOR array) both hit
 * that case, so they're registered as null: present in the picker's
 * metadata (a claim key can still be listed for display), absent from the
 * matcher's queryable values. Neither is lost — the full mdoc, portrait
 * included, still goes out through the normal OID4VP response after the
 * user approves in the consent overlay; only the pre-selection matching
 * step in the OS picker can't filter on them.
 */
function toCredentialItem(record: MdocRecord): CredentialItem | null {
  const mdoc = record.firstCredential;
  const namespaces = mdoc.issuerSignedNamespaces ?? {};

  const registryNamespaces: CredentialConfigurationMdoc['namespaces'] = {};
  for (const [namespace, elements] of Object.entries(namespaces)) {
    const converted: Record<string, string | number | boolean | null> = {};
    for (const [elementIdentifier, value] of Object.entries(elements)) {
      converted[elementIdentifier] = toRegistrableValue(value);
    }
    registryNamespaces[namespace] = converted;
  }

  const tags = record.getTags() as Record<string, unknown>;
  const title = typeof tags.credentialName === 'string' ? tags.credentialName : mdoc.docType;
  const subtitle = typeof tags.issuerName === 'string' ? tags.issuerName : undefined;

  return {
    id: record.id,
    display: { title, subtitle },
    credential: {
      format: 'mso_mdoc',
      doctype: mdoc.docType,
      namespaces: registryNamespaces,
    },
  };
}

/** string | number | boolean pass through; anything else (bytes, Date, nested
 * structures like driving_privileges) becomes null per CredentialItem's
 * documented contract — see toCredentialItem's doc comment for why that's
 * safe. */
function toRegistrableValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}
