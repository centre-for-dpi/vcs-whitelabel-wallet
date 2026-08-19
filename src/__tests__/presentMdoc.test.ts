import { DeviceRequest } from '@animo-id/mdoc';
import { parseRequestedElements, filterByRequest } from '../agent/mdl/presentMdoc';

/** Builds a real, spec-shaped DeviceRequest CBOR asking for the given elements. */
function buildDeviceRequestBytes(docType: string, elements: string[]): Uint8Array {
  const nameSpaces = new Map([
    ['org.iso.18013.5.1', new Map(elements.map((e) => [e, false]))],
  ]);
  const deviceRequest = DeviceRequest.from('1.0', [{ itemsRequestData: { docType, nameSpaces } }]);
  return deviceRequest.encode();
}

describe('parseRequestedElements', () => {
  test('extracts docType and the flat list of requested element identifiers', () => {
    const bytes = buildDeviceRequestBytes('org.iso.18013.5.1.mDL', ['family_name', 'given_name']);
    const { docType, requestedElements } = parseRequestedElements(bytes);
    expect(docType).toBe('org.iso.18013.5.1.mDL');
    expect(requestedElements.sort()).toEqual(['family_name', 'given_name']);
  });

  test('throws a readable error when the DeviceRequest has no docRequests', () => {
    // A DeviceRequest CBOR with zero docRequests is a valid encoding but a
    // meaningless request — parseRequestedElements should fail loudly rather
    // than silently proceed with an empty requestedElements list.
    const empty = DeviceRequest.from('1.0', []).encode();
    expect(() => parseRequestedElements(empty)).toThrow();
  });
});

describe('filterByRequest', () => {
  test('returns only the requested elements, dropping the rest', () => {
    const stored = { family_name: 'Pérez', given_name: 'Ana', document_number: '123' };
    const requested = ['family_name', 'given_name'];
    const filtered = filterByRequest(stored, requested);
    expect(Object.keys(filtered).sort()).toEqual(['family_name', 'given_name']);
    expect(filtered).not.toHaveProperty('document_number');
  });

  test('age_over_NN: matches only the exact attestation name requested', () => {
    // filterByRequest does ONLY exact-name matching. Spec §C.7.2 describes a
    // richer semantics ("closest attestation present that is >= NN") that
    // this function does NOT implement — that requires knowing the ordering
    // between age_over_NN names, which is dataset-specific logic, not
    // generic filtering. Declared out of scope for this task (see the note
    // above the Files list). This test documents the actual behavior:
    // requesting age_over_18 when only age_over_21 is stored returns nothing,
    // even though age_over_21 implies age_over_18.
    const stored = { age_over_21: true };
    const filtered = filterByRequest(stored, ['age_over_18']);
    expect(filtered).toEqual({});
  });

  test('never returns an element that was not requested, even if present', () => {
    const stored = { family_name: 'Pérez', birth_date: '1990-03-15' };
    const filtered = filterByRequest(stored, ['family_name']);
    expect(filtered).not.toHaveProperty('birth_date');
  });
});
