/**
 * Extracts a flat, human-readable list of requested field names from the
 * OpenID4VP request the OS hands the app after the user picks this wallet
 * from the system credential picker (Digital Credentials API, C.7.3b).
 *
 * This is the SAME two request shapes normalizeRequest.ts already parses for
 * the HTTP-initiated OID4VP flow (presentation_definition / dcql_query) — but
 * deliberately re-implemented minimally here rather than imported, because
 * this call site only needs field NAMES for the consent screen, not a fully
 * resolved Credo request object. Pulling in normalizeRequest's machinery
 * would drag in its HTTP-bypass/JWT-decoding path, which doesn't apply here:
 * the OS has already decoded and handed over plain JSON.
 */
export function parseRequestedFieldNames(openId4VpRequestJson: string): string[] {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(openId4VpRequestJson) as Record<string, unknown>;
  } catch {
    return [];
  }

  const fromDcql = extractFromDcqlQuery(payload.dcql_query);
  if (fromDcql.length > 0) return fromDcql;

  return extractFromPresentationDefinition(payload.presentation_definition);
}

function extractFromDcqlQuery(dcqlQuery: unknown): string[] {
  if (!dcqlQuery || typeof dcqlQuery !== 'object') return [];
  const credentials = (dcqlQuery as Record<string, unknown>).credentials;
  if (!Array.isArray(credentials)) return [];

  const names: string[] = [];
  for (const cred of credentials as Array<Record<string, unknown>>) {
    const claims = cred.claims;
    if (!Array.isArray(claims)) continue;
    for (const claim of claims as Array<Record<string, unknown>>) {
      const path = claim.path;
      if (Array.isArray(path) && path.length > 0) {
        // mdoc DCQL claim paths are [namespace, elementIdentifier] — the
        // element identifier is what's meaningful to show the holder.
        names.push(String(path[path.length - 1]));
      }
    }
  }
  return names;
}

function extractFromPresentationDefinition(presentationDefinition: unknown): string[] {
  if (!presentationDefinition || typeof presentationDefinition !== 'object') return [];
  const inputDescriptors = (presentationDefinition as Record<string, unknown>).input_descriptors;
  if (!Array.isArray(inputDescriptors)) return [];

  const names: string[] = [];
  for (const descriptor of inputDescriptors as Array<Record<string, unknown>>) {
    const constraints = descriptor.constraints as Record<string, unknown> | undefined;
    const fields = constraints?.fields;
    if (!Array.isArray(fields)) continue;
    for (const field of fields as Array<Record<string, unknown>>) {
      const paths = field.path;
      if (!Array.isArray(paths) || paths.length === 0) continue;
      // JSONPath like "$['org.iso.18013.5.1']['family_name']" — take the
      // last bracketed segment as the display name.
      const match = String(paths[0]).match(/\[['"]([^'"]+)['"]\]\s*$/);
      names.push(match ? match[1] : String(paths[0]));
    }
  }
  return names;
}
