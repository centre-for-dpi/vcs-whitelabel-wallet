import { DeviceRequest } from '@animo-id/mdoc';

/**
 * Parses the raw DeviceRequest CBOR the reader sent, returning the flat list
 * of (namespace, elementIdentifier) pairs it asked for — the shape the
 * consent screen (present-mdl.tsx) renders and that filterByRequest below
 * consumes to decide what to disclose.
 *
 * Only the first docRequest/itemsRequest is read: a DeviceRequest can in
 * principle ask for multiple documents in one session, but this wallet only
 * ever holds a single mDL, so there is at most one relevant itemsRequest.
 *
 * Deliberately has no dependency on @credo-ts/core (unlike signDeviceResponse.ts,
 * which does the actual signing) — @credo-ts/core's ESM build isn't set up to be
 * imported unmocked under Jest (see selectCredentials.test.ts's jest.mock), so
 * keeping this file Credo-free lets its tests exercise the real CBOR parsing
 * instead of a mock of it.
 */
export function parseRequestedElements(deviceRequestBytes: Uint8Array): {
  deviceRequest: DeviceRequest;
  docType: string;
  requestedElements: string[];
} {
  const deviceRequest = DeviceRequest.parse(deviceRequestBytes);
  const docRequest = deviceRequest.docRequests[0];
  if (!docRequest) throw new Error('El lector no solicitó ningún documento.');
  const { docType, nameSpaces } = docRequest.itemsRequest.data;
  const requestedElements: string[] = [];
  for (const elements of nameSpaces.values()) {
    for (const elementIdentifier of elements.keys()) requestedElements.push(elementIdentifier);
  }
  return { deviceRequest, docType, requestedElements };
}

/**
 * Filters stored mdoc elements down to exactly what a DeviceRequest asked
 * for — the wallet must never disclose more than requested (spec §S-3).
 * This is a pre-consent-screen convenience only; the actual disclosure sent
 * to the reader is still driven by DeviceResponse.usingDeviceRequest
 * (signDeviceResponse.ts), which independently enforces the same rule
 * against the parsed DeviceRequest — this function existing separately is
 * defense in depth, not the sole enforcement point.
 */
export function filterByRequest(
  stored: Record<string, unknown>,
  requestedElements: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of requestedElements) {
    if (key in stored) out[key] = stored[key];
  }
  return out;
}
