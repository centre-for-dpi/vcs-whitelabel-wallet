import { ClaimFormat, SdJwtVcRecord } from '@credo-ts/core';
import type { WalletAgent } from '../setup';
import type { OpenId4VpResolvedAuthorizationRequest } from '@credo-ts/openid4vc';

type PexEntry = {
  claimFormat: ClaimFormat;
  credentialRecord: SdJwtVcRecord;
  disclosedPayload: Record<string, unknown>;
};

export type SelectedCredentials = {
  presentationExchange?: { credentials: Record<string, PexEntry[]> };
  dcql?: { credentials: unknown };
};

/**
 * Selects wallet credentials that satisfy an OID4VP authorization request.
 *
 * PEX path: Credo's selectCredentialsForPresentationExchangeRequest fails for dc+sd-jwt
 * because @animo-id/pex treats all SD-JWTs as vc+sd-jwt and doesn't inline SD-JWT
 * disclosures before evaluating JSON path constraints. We match manually:
 *   1. Check prettyClaims.vct (conformant dc+sd-jwt issuers put vct at the top level)
 *   2. Fall back to the 'credentialVct' tag stored at issuance (for W3C-wrapped issuers
 *      like walt.id bootcamp where prettyClaims.vct is always undefined)
 *
 * DCQL path: delegates to Credo's built-in selectCredentialsForDcqlRequest.
 */
export async function selectCredentialsForRequest(
  agent: WalletAgent,
  resolved: OpenId4VpResolvedAuthorizationRequest,
): Promise<SelectedCredentials> {
  const result: SelectedCredentials = {};
  const r = resolved as Record<string, unknown>;

  const pex = r.presentationExchange as Record<string, unknown> | undefined;
  const dcql = r.dcql as Record<string, unknown> | undefined;

  if (pex?.credentialsForRequest) {
    const definition = pex.definition as Record<string, unknown> | undefined;
    const descriptors = definition?.input_descriptors as Array<Record<string, unknown>> | undefined;
    const allSdJwt = await agent.sdJwtVc.getAll();

    console.log('[oid4vp] wallet sdJwt count:', allSdJwt.length);
    allSdJwt.forEach((rec, i) => {
      const pc = rec.firstCredential.prettyClaims as Record<string, unknown>;
      const tags = rec.getTags() as Record<string, unknown>;
      console.log(
        `[oid4vp] sdJwt[${i}] id:${rec.id}`,
        `vct:${pc.vct}`,
        `credentialVct:${tags.credentialVct}`,
        `keys:${Object.keys(pc).join(',')}`,
      );
    });

    const built: Record<string, PexEntry[]> = {};

    for (const descriptor of descriptors ?? []) {
      const descriptorId = descriptor.id as string;
      const vctPattern = extractVctPattern(descriptor);
      console.log('[oid4vp] matching descriptor:', descriptorId, 'vctPattern:', vctPattern);

      const matched = allSdJwt.find((rec) => matchesVct(rec, vctPattern));
      if (!matched) {
        throw new Error(
          `No se encontró una credencial para: ${descriptorId}` +
          (vctPattern ? ` (vct: ${vctPattern})` : ''),
        );
      }

      const pc = matched.firstCredential.prettyClaims as Record<string, unknown>;
      console.log('[oid4vp] matched descriptor', descriptorId, '→ record', matched.id);
      built[descriptorId] = [
        { claimFormat: ClaimFormat.SdJwtDc, credentialRecord: matched, disclosedPayload: pc },
      ];
    }

    result.presentationExchange = { credentials: built };
  }

  if (dcql?.queryResult) {
    const qr = dcql.queryResult as Record<string, unknown>;
    if (qr.can_be_satisfied === false) {
      // Extract the expected VCT values for a meaningful error message
      const credQueries = (qr.credentials as Array<Record<string, unknown>> | undefined) ?? [];
      const expectedVcts = credQueries
        .flatMap((q) => ((q.meta as Record<string, unknown> | undefined)?.vct_values as string[] | undefined) ?? [])
        .map((v) => v.split('/').pop() ?? v);

      const allSdJwt = await agent.sdJwtVc.getAll();
      const walletVcts = allSdJwt
        .map((r) => (r.firstCredential.prettyClaims as Record<string, unknown>).vct as string | undefined)
        .filter(Boolean)
        .map((v) => v!.split('/').pop() ?? v!);

      console.warn('[oid4vp/dcql] request not satisfiable — expected vct:', expectedVcts, '| wallet vct:', walletVcts);
      throw new Error(
        `No tienes una credencial que coincida con lo que solicita el verificador.\n` +
        `Credencial requerida: ${expectedVcts.join(', ') || '(desconocida)'}\n` +
        `Credenciales en tu billetera: ${walletVcts.join(', ') || '(ninguna)'}`,
      );
    }

    const dcqlCredentials = agent.modules.openid4vc.holder.selectCredentialsForDcqlRequest(
      dcql.queryResult,
    );
    console.log('[oid4vp] DCQL credentials selected');
    result.dcql = { credentials: dcqlCredentials };
  }

  return result;
}

function extractVctPattern(descriptor: Record<string, unknown>): string | undefined {
  const fields = (descriptor.constraints as Record<string, unknown> | undefined)
    ?.fields as Array<Record<string, unknown>> | undefined;
  for (const field of fields ?? []) {
    const paths = field.path as string[] | undefined;
    const pattern = (field.filter as Record<string, unknown> | undefined)?.pattern as string | undefined;
    if (pattern && paths?.some((p) => p === '$.vct' || p === '$.vc.type')) {
      return pattern;
    }
  }
  return undefined;
}

function matchesVct(record: SdJwtVcRecord, vctPattern: string | undefined): boolean {
  const testVct = (v: string): boolean => {
    if (!vctPattern) return true;
    try { return new RegExp(vctPattern).test(v); } catch { return v === vctPattern; }
  };

  const pc = record.firstCredential.prettyClaims as Record<string, unknown>;

  // Conformant dc+sd-jwt: vct at top level
  const topVct = pc.vct as string | undefined;
  if (topVct) return testVct(topVct);

  // jwt_vc_json / W3C-wrapped: check vc.type array
  const vcWrapper = pc.vc as Record<string, unknown> | undefined;
  const vcTypes = vcWrapper?.type as string[] | undefined;
  if (Array.isArray(vcTypes) && vcTypes.some((t) => testVct(t))) return true;

  // Fallback: credentialVct tag stored at issuance (avoids built-in 'vct' tag collision)
  const tags = record.getTags() as Record<string, unknown>;
  const tagVct = tags.credentialVct as string | undefined;
  if (tagVct) return testVct(tagVct);

  return !vctPattern;
}
