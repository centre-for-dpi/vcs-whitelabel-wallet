// pako is a pure-JS GZIP lib — no native bindings needed in Node/Jest.
import pako from 'pako';
import { checkRevocationStatus, getBit } from '../agent/revocation';

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJwt(payload: Record<string, unknown>): string {
  const h = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=/g, '');
  const p = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${h}.${p}.`;
}

/**
 * Builds a GZIP-compressed bitstring where the given indices are set (1 = revoked).
 * Returns the base64url-encoded compressed bytes (for TokenStatusList).
 */
function makeStatusListB64Url(length: number, revokedIndices: number[]): string {
  const bytes = new Uint8Array(Math.ceil(length / 8));
  for (const idx of revokedIndices) {
    const byteIndex = Math.floor(idx / 8);
    const bitOffset = 7 - (idx % 8);
    bytes[byteIndex] |= 1 << bitOffset;
  }
  const compressed = pako.deflate(bytes);
  const b64 = btoa(String.fromCharCode(...compressed));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Same as above but returns plain base64 (for StatusList2021 encodedList).
 */
function makeStatusListB64(length: number, revokedIndices: number[]): string {
  const bytes = new Uint8Array(Math.ceil(length / 8));
  for (const idx of revokedIndices) {
    const byteIndex = Math.floor(idx / 8);
    const bitOffset = 7 - (idx % 8);
    bytes[byteIndex] |= 1 << bitOffset;
  }
  const compressed = pako.deflate(bytes);
  return btoa(String.fromCharCode(...compressed));
}

function mockFetchText(text: string) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, text: async () => text });
}

function mockFetchError(status: number) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status });
}

// ── getBit ────────────────────────────────────────────────────────────────────

describe('getBit', () => {
  test('returns true for bit 0 when MSB of byte 0 is set', () => {
    // byte 0 = 0b10000000 → bit 0 = 1
    expect(getBit(new Uint8Array([0b10000000]), 0)).toBe(true);
  });

  test('returns false for bit 0 when MSB of byte 0 is clear', () => {
    expect(getBit(new Uint8Array([0b01111111]), 0)).toBe(false);
  });

  test('returns true for bit 7 when LSB of byte 0 is set', () => {
    // byte 0 = 0b00000001 → bit 7 = 1
    expect(getBit(new Uint8Array([0b00000001]), 7)).toBe(true);
  });

  test('returns true for bit 8 when MSB of byte 1 is set', () => {
    expect(getBit(new Uint8Array([0x00, 0b10000000]), 8)).toBe(true);
  });

  test('returns false for out-of-range bit index', () => {
    expect(getBit(new Uint8Array([0xFF]), 100)).toBe(false);
  });

  test('handles a multi-byte array with specific bits set', () => {
    // Set bits at indices 0, 9, 15
    const bytes = new Uint8Array([0b10000000, 0b01000001]);
    expect(getBit(bytes, 0)).toBe(true);   // byte 0, bit offset 7
    expect(getBit(bytes, 9)).toBe(true);   // byte 1, bit offset 6
    expect(getBit(bytes, 15)).toBe(true);  // byte 1, bit offset 0
    expect(getBit(bytes, 1)).toBe(false);
    expect(getBit(bytes, 8)).toBe(false);
  });
});

// ── checkRevocationStatus — no status claim ───────────────────────────────────

describe('checkRevocationStatus — no status claim', () => {
  test('returns unknown when credential has no status field', async () => {
    const jwt = makeJwt({ vct: 'https://issuer.example.com/PID', sub: 'user-1' });
    expect(await checkRevocationStatus(jwt)).toBe('unknown');
  });

  test('returns unknown for an SD-JWT with disclosures but no status claim', async () => {
    const jwt = makeJwt({ vct: 'https://issuer.example.com/PID' });
    const compact = `${jwt}~disclosure1~disclosure2~`;
    expect(await checkRevocationStatus(compact)).toBe('unknown');
  });
});

// ── TokenStatusList ───────────────────────────────────────────────────────────

describe('checkRevocationStatus — TokenStatusList', () => {
  const STATUS_LIST_URI = 'https://issuer.example.com/statuslists/1';

  function makeCredentialJwt(idx: number) {
    return makeJwt({
      vct: 'https://issuer.example.com/PID',
      status: { status_list: { idx, uri: STATUS_LIST_URI } },
    });
  }

  function makeStatusListJwt(lst: string, bits = 1) {
    return makeJwt({ status_list: { bits, lst } });
  }

  test('returns valid when the credential bit is 0', async () => {
    const lst = makeStatusListB64Url(16, [5]); // only index 5 revoked
    mockFetchText(makeStatusListJwt(lst));
    expect(await checkRevocationStatus(makeCredentialJwt(0))).toBe('valid');
  });

  test('returns revoked when the credential bit is 1', async () => {
    const lst = makeStatusListB64Url(16, [3]); // index 3 revoked
    mockFetchText(makeStatusListJwt(lst));
    expect(await checkRevocationStatus(makeCredentialJwt(3))).toBe('revoked');
  });

  test('returns revoked for the last bit in a byte boundary', async () => {
    const lst = makeStatusListB64Url(16, [7]); // last bit of byte 0
    mockFetchText(makeStatusListJwt(lst));
    expect(await checkRevocationStatus(makeCredentialJwt(7))).toBe('revoked');
  });

  test('returns revoked for an index in the second byte', async () => {
    const lst = makeStatusListB64Url(16, [9]); // byte 1, bit 1
    mockFetchText(makeStatusListJwt(lst));
    expect(await checkRevocationStatus(makeCredentialJwt(9))).toBe('revoked');
  });

  test('returns valid when two different indices: credential idx is not revoked', async () => {
    const lst = makeStatusListB64Url(16, [2, 7]); // indices 2 and 7 revoked
    mockFetchText(makeStatusListJwt(lst));
    expect(await checkRevocationStatus(makeCredentialJwt(4))).toBe('valid');
  });

  test('returns unknown when status list fetch returns HTTP error', async () => {
    mockFetchError(404);
    expect(await checkRevocationStatus(makeCredentialJwt(0))).toBe('unknown');
  });

  test('returns unknown when status list JWT has no status_list field', async () => {
    mockFetchText(makeJwt({ iss: 'https://issuer.example.com', iat: 1000 }));
    expect(await checkRevocationStatus(makeCredentialJwt(0))).toBe('unknown');
  });
});

// ── StatusList2021 ────────────────────────────────────────────────────────────

describe('checkRevocationStatus — StatusList2021', () => {
  const LIST_URL = 'https://issuer.example.com/status/1#list';

  function makeCredentialJwt(idx: number) {
    return makeJwt({
      vct: 'https://issuer.example.com/PID',
      credentialStatus: {
        type: 'StatusList2021Entry',
        statusListCredential: LIST_URL,
        statusListIndex: String(idx),
        statusPurpose: 'revocation',
      },
    });
  }

  function makeStatusListVcJwt(encodedList: string) {
    return makeJwt({
      vc: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'StatusList2021Credential'],
        credentialSubject: {
          type: 'StatusList2021',
          statusPurpose: 'revocation',
          encodedList,
        },
      },
    });
  }

  function makeStatusListVcJson(encodedList: string) {
    return JSON.stringify({
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      credentialSubject: { type: 'StatusList2021', statusPurpose: 'revocation', encodedList },
    });
  }

  test('returns valid when the credential index bit is 0', async () => {
    const encodedList = makeStatusListB64(16, [9]); // only index 9 revoked
    mockFetchText(makeStatusListVcJwt(encodedList));
    expect(await checkRevocationStatus(makeCredentialJwt(0))).toBe('valid');
  });

  test('returns revoked when the credential index bit is 1 (JWT VC format)', async () => {
    const encodedList = makeStatusListB64(16, [5]);
    mockFetchText(makeStatusListVcJwt(encodedList));
    expect(await checkRevocationStatus(makeCredentialJwt(5))).toBe('revoked');
  });

  test('returns revoked when credential index bit is 1 (JSON-LD format)', async () => {
    const encodedList = makeStatusListB64(16, [12]);
    mockFetchText(makeStatusListVcJson(encodedList));
    expect(await checkRevocationStatus(makeCredentialJwt(12))).toBe('revoked');
  });

  test('reads credentialStatus from nested .vc field for W3C-wrapped credentials', async () => {
    const jwt = makeJwt({
      vc: {
        credentialStatus: {
          type: 'StatusList2021Entry',
          statusListCredential: LIST_URL,
          statusListIndex: '2',
          statusPurpose: 'revocation',
        },
      },
    });
    const encodedList = makeStatusListB64(16, [2]);
    mockFetchText(makeStatusListVcJwt(encodedList));
    expect(await checkRevocationStatus(jwt)).toBe('revoked');
  });

  test('returns unknown when status list fetch returns HTTP error', async () => {
    mockFetchError(503);
    expect(await checkRevocationStatus(makeCredentialJwt(0))).toBe('unknown');
  });

  test('returns unknown when encodedList is absent in the status list response', async () => {
    mockFetchText(makeJwt({ vc: { credentialSubject: {} } }));
    expect(await checkRevocationStatus(makeCredentialJwt(0))).toBe('unknown');
  });
});
