export const STORAGE_KEYS = {
  baseUrl: 'jiraBaseUrl',
  users: 'jiraWorklogUsers',
  monthOffset: 'monthOffset',
} as const;

// chrome.storage.session key used to hand a parsed file from the popup to the import window
export const PENDING_IMPORT_KEY = 'pendingImport';

export function sanitizeBaseUrl(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return '';
  }

  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}
