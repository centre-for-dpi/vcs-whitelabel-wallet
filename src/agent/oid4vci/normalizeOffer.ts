import type { OpenId4VciResolvedCredentialOffer } from '@credo-ts/openid4vc';

/**
 * Normalizes a resolved OID4VCI credential offer to handle non-conformant issuers.
 *
 * Applies three patches in order:
 *  1. Config injection  — rebuilds offeredCredentialConfigurations when Credo's Zod schema
 *     rejects the raw configs (e.g. dc+sd-jwt entries missing the required `vct` field).
 *  2. proof_types_supported — injects the field for any config that omits it; Credo
 *     requires it to know which proof algorithm to use for key binding.
 *  3. Draft version downgrade — some issuers (e.g. walt.id /draft13) serve Draft 15-shaped
 *     metadata (credential_configurations_supported) but their credential endpoint only
 *     accepts Draft 13/14-style requests that include `format`. Downgrade so Credo's
 *     requestCredentials sends `format` instead of `credential_configuration_id`.
 */
export function normalizeOffer(
  rawOffer: OpenId4VciResolvedCredentialOffer,
): Record<string, unknown> {
  let offer = rawOffer as unknown as Record<string, unknown>;

  // ── Patch 1: inject missing offeredCredentialConfigurations ──────────────────────
  if (Object.keys(rawOffer.offeredCredentialConfigurations ?? {}).length === 0) {
    const rawMeta = rawOffer.metadata as unknown as Record<string, unknown>;
    const credIssuerMeta = rawMeta?.credentialIssuer as Record<string, unknown> | undefined;
    const credIssuerUrl = credIssuerMeta?.credential_issuer as string | undefined;
    const rawAll = (credIssuerMeta?.credential_configurations_supported ?? {}) as Record<string, unknown>;
    const offeredIds: string[] =
      (rawOffer.credentialOfferPayload?.credential_configuration_ids as string[] | undefined) ?? [];

    const isAbsoluteUrl = (s: string) => /^https?:\/\//.test(s);
    const injected: Record<string, unknown> = {};

    for (const cfgId of offeredIds) {
      const raw = rawAll[cfgId] as Record<string, unknown> | undefined;
      if (!raw) continue;

      const credDef = raw.credential_definition as Record<string, unknown> | undefined;
      const types = (credDef?.type as string[] | undefined) ?? [];
      const specificType = types.filter((t) => t !== 'VerifiableCredential').pop() ?? cfgId;

      // Derive vct from raw.vct → absolute specificType → credIssuerUrl+specificType → specificType
      const derivedVct =
        raw.vct ??
        (isAbsoluteUrl(specificType)
          ? specificType
          : credIssuerUrl
          ? `${credIssuerUrl.replace(/\/$/, '')}/${specificType}`
          : specificType);

      injected[cfgId] = {
        ...raw,
        vct: derivedVct,
        proof_types_supported: raw.proof_types_supported ?? {
          jwt: {
            proof_signing_alg_values_supported:
              (raw.credential_signing_alg_values_supported as string[] | undefined) ??
              ['EdDSA', 'ES256', 'ES256K'],
          },
        },
      };
      console.log('[oid4vci] injected missing config:', cfgId, 'vct:', derivedVct);
    }

    if (Object.keys(injected).length > 0) {
      offer = {
        ...offer,
        metadata: {
          ...rawMeta,
          originalDraftVersion: 'Draft15',
          knownCredentialConfigurations: {
            ...(rawMeta.knownCredentialConfigurations as object ?? {}),
            ...injected,
          },
        },
        offeredCredentialConfigurations: injected,
      };
    }
  }

  // ── Patch 2: inject proof_types_supported where missing ──────────────────────────
  const offeredConfigs = offer.offeredCredentialConfigurations as Record<string, unknown> | undefined;
  if (offeredConfigs) {
    for (const cfgId of Object.keys(offeredConfigs)) {
      const c = offeredConfigs[cfgId] as Record<string, unknown>;
      if (!c.proof_types_supported) {
        const algs =
          (c.credential_signing_alg_values_supported as string[] | undefined) ?? ['EdDSA', 'ES256'];
        c.proof_types_supported = { jwt: { proof_signing_alg_values_supported: algs } };
        console.log('[oid4vci] injected proof_types_supported for:', cfgId);
      }
    }
  }

  // ── Patch 3: downgrade Draft15 → Draft14 for legacy-style endpoints ──────────────
  const meta = offer.metadata as Record<string, unknown>;
  const credIssuer = meta.credentialIssuer as Record<string, unknown> | undefined;
  const credentialEndpoint = credIssuer?.credential_endpoint as string | undefined;
  const issuerBaseUrl = credIssuer?.credential_issuer as string | undefined;
  const isLegacyEndpoint = [credentialEndpoint, issuerBaseUrl].some(
    (u) => u?.includes('/draft13') || u?.includes('/draft14'),
  );
  if (isLegacyEndpoint && meta.originalDraftVersion === 'Draft15') {
    meta.originalDraftVersion = 'Draft14';
    console.log('[oid4vci] downgraded originalDraftVersion Draft15→Draft14 for legacy endpoint');
  }

  console.log('[oid4vci] normalizeOffer done — version:', meta.originalDraftVersion,
    '| configs:', Object.keys(offeredConfigs ?? {}).join(', '));
  return offer;
}
