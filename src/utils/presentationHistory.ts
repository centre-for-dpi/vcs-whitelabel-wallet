import * as FileSystem from 'expo-file-system/legacy';

const HISTORY_FILE = `${FileSystem.documentDirectory}presentation_history.json`;
const HISTORY_TMP  = `${FileSystem.documentDirectory}presentation_history.tmp.json`;
const MAX_RECORDS  = 200;

export type PresentationRecord = {
  id: string;
  timestamp: string;
  verifier: string;
  purpose: string;
  credentialTypes: string[];
  sharedFields: string[];
  /** Fields that were in the credential but NOT disclosed. */
  privateFields?: string[];
  /** Trust status of the verifier at presentation time. */
  trustStatus?: 'trusted' | 'unknown' | 'untrusted';
  /** OID4VP exchange protocol used. */
  protocol?: 'pex' | 'dcql' | 'http';
};

export async function loadHistory(): Promise<PresentationRecord[]> {
  for (const path of [HISTORY_FILE, HISTORY_TMP]) {
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) continue;
      const text = await FileSystem.readAsStringAsync(path);
      const parsed = JSON.parse(text) as PresentationRecord[];
      if (Array.isArray(parsed)) return parsed;
    } catch { /* try next */ }
  }
  return [];
}

// Serializes concurrent writes so the file is never partially overwritten.
let _writeLock = Promise.resolve();

export function addPresentation(entry: Omit<PresentationRecord, 'id'>): Promise<void> {
  _writeLock = _writeLock.then(() => _addPresentation(entry));
  return _writeLock;
}

async function _addPresentation(entry: Omit<PresentationRecord, 'id'>): Promise<void> {
  const history = await loadHistory();
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  history.unshift({ id, ...entry });

  // Trim to avoid unbounded growth
  const trimmed = history.slice(0, MAX_RECORDS);
  const json = JSON.stringify(trimmed);

  // Atomic write: write to tmp, then move to final path
  await FileSystem.writeAsStringAsync(HISTORY_TMP, json);
  await FileSystem.moveAsync({ from: HISTORY_TMP, to: HISTORY_FILE });
}

export async function clearHistory(): Promise<void> {
  await Promise.all([
    FileSystem.deleteAsync(HISTORY_FILE, { idempotent: true }),
    FileSystem.deleteAsync(HISTORY_TMP, { idempotent: true }),
  ]);
}
