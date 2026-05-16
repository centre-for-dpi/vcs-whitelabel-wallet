import * as FileSystem from 'expo-file-system';

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

export async function addPresentation(entry: Omit<PresentationRecord, 'id'>): Promise<void> {
  const history = await loadHistory();
  const record: PresentationRecord = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ...entry,
  };
  history.unshift(record);
  await FileSystem.writeAsStringAsync(HISTORY_FILE, JSON.stringify(history));
}

export async function clearHistory(): Promise<void> {
  try {
    await FileSystem.deleteAsync(HISTORY_FILE, { idempotent: true });
  } catch { /* ignore */ }
}
