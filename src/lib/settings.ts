import type { AdministrationIssues } from '../types';

export const STORAGE_KEYS = {
  baseUrl: 'jiraBaseUrl',
  users: 'jiraWorklogUsers',
  monthOffset: 'monthOffset',
  administrationIssues: 'administrationIssues',
} as const;

// chrome.storage.session key used to hand a parsed file from the popup to the import window
export const PENDING_IMPORT_KEY = 'pendingImport';

// The administration task changes every year; the popup shows an "Administration task <year>" field for each year
export const DEFAULT_ADMINISTRATION_ISSUES: AdministrationIssues = { '2026': 'CP-4405' };

const ADMINISTRATION_ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;

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

export function isAdministrationIssueKey(value: string): boolean {
  return ADMINISTRATION_ISSUE_KEY_PATTERN.test(value);
}

// Years with an "Administration task" field: the current year, plus the configured previous year
// (e.g. in January 2027 the December 2026 worklogs still go to the 2026 task)
export function getAdministrationYears(issues: AdministrationIssues, currentYear: number): string[] {
  const years = new Set([String(currentYear)]);
  for (const year of Object.keys(issues)) {
    if (Number(year) >= currentYear - 1) {
      years.add(year);
    }
  }
  return [...years].sort();
}
