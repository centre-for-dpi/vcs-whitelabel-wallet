/**
 * Normalizes an OID4VP authorization request URL before passing it to Credo's resolver.
 *
 * Applies three patches:
 *  1. client_id patch  — when client_id_scheme=redirect_uri the spec requires
 *     client_id === response_uri. Walt.id sends a mismatched value; we fix it.
 *  2. PD URI fetch     — Credo's resolver doesn't support presentation_definition_uri;
 *     we fetch the document and inline it as presentation_definition.
 *  3. Format alg       — PEX v2 requires format objects to include { alg: [...] }.
 *     Walt.id sends { jwt_vc_json: {} } / { vc+sd-jwt: {} } without alg. We inject
 *     it for all known format keys so PEX validation passes. The format itself is
 *     preserved so presentCredentials.ts can read it for presentation_submission.
 */
export async function normalizeAuthorizationRequestUrl(rawUrl: string): Promise<string> {
  const qsStart = rawUrl.indexOf('?');
  if (qsStart === -1) return rawUrl;

  const params = new URLSearchParams(rawUrl.slice(qsStart + 1));

  // Patch 1: client_id must equal response_uri for redirect_uri scheme
  if (params.get('client_id_scheme') === 'redirect_uri') {
    const responseUri = params.get('response_uri');
    if (responseUri) {
      params.set('client_id', responseUri);
      console.log('[oid4vp] patched client_id → response_uri:', responseUri.slice(0, 80));
    }
  }

  // Patches 2 & 3: fetch PD URI and inject alg in format constraints
  const pdUri = params.get('presentation_definition_uri');
  if (pdUri) {
    console.log('[oid4vp] fetching presentation_definition_uri:', pdUri);
    const pdResp = await fetch(pdUri);
    if (!pdResp.ok) {
      throw new Error(`No se pudo obtener la definición de presentación (${pdResp.status})`);
    }
    const pd = await pdResp.json() as Record<string, unknown>;
    console.log('[oid4vp] fetched PD:', JSON.stringify(pd).slice(0, 1000));

    const inputDescriptors = pd.input_descriptors as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(inputDescriptors)) {
      for (const descriptor of inputDescriptors) {
        const fmt = descriptor.format as Record<string, unknown> | undefined;
        if (!fmt) continue;

        // Patch 3: inject required alg for JWT formats that are missing it.
        // SD-JWT formats (vc+sd-jwt, dc+sd-jwt) use {} — alg is NOT allowed there.
        const ALG = ['ES256', 'EdDSA'];
        for (const fmtKey of ['jwt_vc_json', 'jwt_vp_json', 'jwt_vc', 'jwt_vp', 'jwt']) {
          const fmtObj = fmt[fmtKey] as Record<string, unknown> | undefined;
          if (fmtObj !== undefined && !Array.isArray(fmtObj['alg'])) {
            fmtObj['alg'] = ALG;
            console.log(`[oid4vp] injected alg for ${fmtKey} in descriptor:`, descriptor.id);
          }
        }
      }
    }

    params.delete('presentation_definition_uri');
    params.set('presentation_definition', JSON.stringify(pd));
  }

  return `${rawUrl.slice(0, qsStart)}?${params.toString()}`;
}
