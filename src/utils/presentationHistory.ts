import * as FileSystem from 'expo-file-system/legacy';

const HISTORY_FILE = `${FileSystem.documentDirectory}presentation_history.json`;

export type PresentationRecord = {
  id: string;
  timestamp: string;
  verifier: string;
  purpose: string;
  credentialTypes: string[];
  sharedFields: string[];
};

export async function loadHistory(): Promise<PresentationRecord[]> {
  try {
    const info = await FileSystem.getInfoAsync(HISTORY_FILE);
    if (!info.exists) return [];
    const text = await FileSystem.readAsStringAsync(HISTORY_FILE);
    return JSON.parse(text) as PresentationRecord[];
  } catch {
    return [];
  }
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
  await FileSystem.writeAsStringAsync(HISTORY_FILE, JSON.stringify(history));
}

export async function clearHistory(): Promise<void> {
  try {
    await FileSystem.deleteAsync(HISTORY_FILE, { idempotent: true });
  } catch { /* ignore */ }
}
