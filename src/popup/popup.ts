import { buildCsv, buildSummaryCsv, downloadCsv } from '../lib/csv';
import { formatDuration, getMonthOptions, getMonthRange } from '../lib/dateUtils';
import { escapeHtml } from '../lib/html';
import { fetchMonthlyWorklogs, searchJiraUsers } from '../lib/jiraApi';
import {
  DEFAULT_ADMINISTRATION_ISSUES,
  PENDING_IMPORT_KEY,
  STORAGE_KEYS,
  getAdministrationYears,
  isAdministrationIssueKey,
  sanitizeBaseUrl,
} from '../lib/settings';
import { SAMPLE_CSV, parseImportCsv } from '../lib/worklogImport';
import type { AdministrationIssues, ImportSource, PendingImport, WorklogRow } from '../types';
import './popup.css';

const MAX_MONTH_OFFSET = 3;
const IMPORT_WINDOW_WIDTH = 1200;
const IMPORT_WINDOW_HEIGHT = 850;

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const baseUrlInput = getRequiredElement<HTMLInputElement>('#baseUrlInput');
const userInput = getRequiredElement<HTMLInputElement>('#userInput');
const userSuggestions = getRequiredElement<HTMLDataListElement>('#userSuggestions');
const useCurrentTabBtn = getRequiredElement<HTMLButtonElement>('#useCurrentTabBtn');
const refreshBtn = getRequiredElement<HTMLButtonElement>('#refreshBtn');
const monthOffsetSelect = getRequiredElement<HTMLSelectElement>('#monthOffsetSelect');
const monthLabel = getRequiredElement<HTMLElement>('#monthLabel');
const totalTime = getRequiredElement<HTMLElement>('#totalTime');
const metaInfo = getRequiredElement<HTMLElement>('#metaInfo');
const status = getRequiredElement<HTMLElement>('#status');
const worklogTable = getRequiredElement<HTMLTableElement>('#worklogTable');
const worklogTableBody = getRequiredElement<HTMLTableSectionElement>('#worklogTableBody');
const exportBtn = getRequiredElement<HTMLButtonElement>('#exportBtn');
const exportSummaryBtn = getRequiredElement<HTMLButtonElement>('#exportSummaryBtn');
const importCsvBtn = getRequiredElement<HTMLButtonElement>('#importCsvBtn');
const importKimaiBtn = getRequiredElement<HTMLButtonElement>('#importKimaiBtn');
const importTogglBtn = getRequiredElement<HTMLButtonElement>('#importTogglBtn');
const administrationIssuesContainer = getRequiredElement<HTMLElement>('#administrationIssues');
const importFileInput = getRequiredElement<HTMLInputElement>('#importFileInput');
const sampleCsvLink = getRequiredElement<HTMLAnchorElement>('#sampleCsvLink');

let currentRows: WorklogRow[] = [];
let currentTotalSeconds = 0;
let currentBaseUrl = '';
let userSearchTimer: number | undefined;
let importSource: ImportSource = 'csv';
let administrationIssues: AdministrationIssues = {};

function parseUsersInput(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function getLastToken(value: string): { token: string; before: string } {
  const lastComma = value.lastIndexOf(',');
  if (lastComma === -1) {
    return { token: value.trim(), before: '' };
  }
  return {
    token: value.slice(lastComma + 1).trim(),
    before: value.slice(0, lastComma + 1) + ' ',
  };
}

function setStatus(message: string, mode: 'loading' | 'error' | 'empty' | 'hidden'): void {
  status.className = 'status';

  if (mode === 'hidden') {
    status.classList.add('hidden');
    status.textContent = '';
    return;
  }

  status.classList.remove('hidden');
  status.classList.add(mode);
  status.textContent = message;
}

function clearTable(): void {
  worklogTableBody.innerHTML = '';
  worklogTable.classList.add('hidden');
}

function renderTable(rows: WorklogRow[]): void {
  if (rows.length === 0) {
    clearTable();
    return;
  }

  worklogTableBody.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${row.date}</td>
        <td>${escapeHtml(row.authorDisplayName)}</td>
        <td>${row.issueKey}</td>
        <td>${escapeHtml(row.summary)}</td>
        <td>${row.timeSpent}</td>
        <td>${escapeHtml(row.project)}</td>
      </tr>`,
    )
    .join('');

  worklogTable.classList.remove('hidden');
}

async function getActiveTabJiraBaseUrl(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    return null;
  }

  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'https:') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.baseUrl]: sanitizeBaseUrl(baseUrlInput.value),
    [STORAGE_KEYS.users]: parseUsersInput(userInput.value),
    [STORAGE_KEYS.monthOffset]: Number(monthOffsetSelect.value),
  });
}

function renderAdministrationInputs(): void {
  const years = getAdministrationYears(administrationIssues, new Date().getFullYear());
  administrationIssuesContainer.innerHTML = years
    .map(
      (year) => `
      <label title="Toggl STANDUP / STATUS / PRODUKCIA entries from ${year} are logged to this task">
        <span>Administration task ${year}:</span>
        <input type="text" data-year="${year}" value="${escapeHtml(administrationIssues[year] ?? '')}" placeholder="e.g. CP-4405" />
      </label>`,
    )
    .join('');
}

function getAdministrationInputs(): HTMLInputElement[] {
  return Array.from(administrationIssuesContainer.querySelectorAll<HTMLInputElement>('input[data-year]'));
}

// Validates and normalizes one field; returns false when it does not hold a Jira issue key
function applyAdministrationInput(input: HTMLInputElement): boolean {
  const year = input.dataset.year ?? '';
  const value = input.value.trim().toUpperCase();
  const valid = !value || isAdministrationIssueKey(value);

  input.classList.toggle('invalid', !valid);
  input.title = valid ? '' : 'Expected a Jira issue key, e.g. CP-4405';
  if (!valid) {
    return false;
  }

  input.value = value;
  if (value) {
    administrationIssues[year] = value;
  } else {
    delete administrationIssues[year];
  }
  return true;
}

function readAdministrationIssues(): AdministrationIssues {
  const invalidYears = getAdministrationInputs()
    .filter((input) => !applyAdministrationInput(input))
    .map((input) => input.dataset.year);
  if (invalidYears.length > 0) {
    throw new Error(`Administration task ${invalidYears.join(', ')} is not a Jira issue key (expected e.g. CP-4405)`);
  }
  return { ...administrationIssues };
}

async function saveAdministrationInput(input: HTMLInputElement): Promise<void> {
  if (applyAdministrationInput(input)) {
    await chrome.storage.local.set({ [STORAGE_KEYS.administrationIssues]: administrationIssues });
  }
}

function buildExportFileName(offset: number): string {
  const range = getMonthRange(offset);
  const yyyy = range.start.getFullYear();
  const mm = String(range.start.getMonth() + 1).padStart(2, '0');
  return `jira-worklog-${yyyy}-${mm}.csv`;
}

function buildSummaryExportFileName(offset: number): string {
  const range = getMonthRange(offset);
  const yyyy = range.start.getFullYear();
  const mm = String(range.start.getMonth() + 1).padStart(2, '0');
  return `jira-worklog-summary-${yyyy}-${mm}.csv`;
}

function renderUserSuggestions(options: Array<{ value: string; label: string }>, before = ''): void {
  userSuggestions.innerHTML = options
    .map((option) => `<option value="${escapeHtml(before + option.value)}" label="${escapeHtml(option.label)}"></option>`)
    .join('');
}

async function loadUserSuggestions(): Promise<void> {
  const baseUrl = sanitizeBaseUrl(baseUrlInput.value);
  const { token, before } = getLastToken(userInput.value);

  if (!baseUrl || token.length < 2) {
    renderUserSuggestions([]);
    return;
  }

  try {
    const options = await searchJiraUsers(baseUrl, token);
    renderUserSuggestions(options, before);
  } catch {
    renderUserSuggestions([]);
  }
}

function setExportButtonsEnabled(enabled: boolean): void {
  exportBtn.disabled = !enabled;
  exportSummaryBtn.disabled = !enabled;
}

async function loadAndRender(): Promise<void> {
  const baseUrl = sanitizeBaseUrl(baseUrlInput.value);
  const authors = parseUsersInput(userInput.value);
  const offset = Number(monthOffsetSelect.value);
  const range = getMonthRange(offset);

  monthLabel.textContent = range.label;

  if (!baseUrl) {
    setStatus('Set Jira Base URL first, then click Refresh.', 'error');
    totalTime.textContent = '0h 0m';
    metaInfo.textContent = '';
    currentRows = [];
    currentTotalSeconds = 0;
    currentBaseUrl = '';
    clearTable();
    setExportButtonsEnabled(false);
    return;
  }

  await saveSettings();

  setStatus('Loading worklogs...', 'loading');
  clearTable();
  setExportButtonsEnabled(false);

  try {
    const result = await fetchMonthlyWorklogs(baseUrl, range, authors);
    currentRows = result.rows;
    currentTotalSeconds = result.totalSeconds;
    currentBaseUrl = baseUrl;

    totalTime.textContent = formatDuration(result.totalSeconds);
    metaInfo.textContent = `Users: ${result.selectedUserLabels.join(', ')} | Issues scanned: ${result.issuesScanned}`;

    if (result.rows.length === 0) {
      setStatus('No worklogs found for selected month.', 'empty');
      clearTable();
      setExportButtonsEnabled(false);
      return;
    }

    setStatus('', 'hidden');
    renderTable(result.rows);
    setExportButtonsEnabled(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load data: ${message}`, 'error');
    totalTime.textContent = '0h 0m';
    metaInfo.textContent = '';
    currentRows = [];
    currentTotalSeconds = 0;
    currentBaseUrl = '';
    clearTable();
    setExportButtonsEnabled(false);
  }
}

function startImport(source: ImportSource): void {
  if (!sanitizeBaseUrl(baseUrlInput.value)) {
    setStatus('Set Jira Base URL first, then import.', 'error');
    return;
  }

  importSource = source;
  importFileInput.value = '';
  importFileInput.click();
}

async function openImportWindow(): Promise<void> {
  const current = await chrome.windows.getCurrent();
  const width = Math.min(IMPORT_WINDOW_WIDTH, current.width ?? IMPORT_WINDOW_WIDTH);
  const height = Math.min(IMPORT_WINDOW_HEIGHT, current.height ?? IMPORT_WINDOW_HEIGHT);
  const left = Math.round((current.left ?? 0) + ((current.width ?? width) - width) / 2);
  const top = Math.round((current.top ?? 0) + ((current.height ?? height) - height) / 2);

  await chrome.windows.create({
    url: chrome.runtime.getURL('import.html'),
    type: 'popup',
    width,
    height,
    left,
    top,
  });
}

async function handleImportFile(): Promise<void> {
  const file = importFileInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const administrationIssues = importSource === 'toggl' ? readAdministrationIssues() : {};
    // Fail fast on a wrong file (missing columns, empty); row-level errors are shown in the import window
    parseImportCsv(text, importSource, administrationIssues);

    await saveSettings();
    const pending: PendingImport = {
      source: importSource,
      fileName: file.name,
      baseUrl: sanitizeBaseUrl(baseUrlInput.value),
      text,
      administrationIssues,
    };
    await chrome.storage.session.set({ [PENDING_IMPORT_KEY]: pending });
    await openImportWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Cannot import ${file.name}: ${message}`, 'error');
  }
}

function initMonthSelect(): void {
  monthOffsetSelect.innerHTML = getMonthOptions(MAX_MONTH_OFFSET)
    .map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
    .join('');
}

async function init(): Promise<void> {
  initMonthSelect();

  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.baseUrl,
    STORAGE_KEYS.users,
    'jiraWorklogUser', // legacy single-user key
    STORAGE_KEYS.monthOffset,
    STORAGE_KEYS.administrationIssues,
  ]);
  const tabBaseUrl = await getActiveTabJiraBaseUrl();

  baseUrlInput.value = sanitizeBaseUrl(stored[STORAGE_KEYS.baseUrl] ?? tabBaseUrl ?? '');

  // Migrate from old single-user storage to array
  const storedUsers: string[] = Array.isArray(stored[STORAGE_KEYS.users])
    ? (stored[STORAGE_KEYS.users] as string[])
    : stored['jiraWorklogUser']
      ? [String(stored['jiraWorklogUser'])]
      : [];
  userInput.value = storedUsers.join(', ');

  const offset = Number(stored[STORAGE_KEYS.monthOffset]);
  monthOffsetSelect.value = Number.isFinite(offset) && offset >= 0 && offset <= MAX_MONTH_OFFSET ? String(offset) : '0';

  const storedAdministrationIssues = stored[STORAGE_KEYS.administrationIssues] as AdministrationIssues | undefined;
  administrationIssues = { ...(storedAdministrationIssues ?? DEFAULT_ADMINISTRATION_ISSUES) };
  renderAdministrationInputs();

  refreshBtn.addEventListener('click', () => {
    void loadAndRender();
  });

  userInput.addEventListener('input', (event) => {
    // When datalist replaces a token, append comma-space to separate from next token
    const inputEvent = event as InputEvent;
    if (inputEvent.inputType === 'insertReplacementText') {
      const { before } = getLastToken(userInput.value);
      // If before is not empty, this was mid-list selection; user already has the value
      // Just append ', ' so the next user can be typed
      if (!userInput.value.endsWith(', ')) {
        userInput.value = userInput.value + ', ';
      }
    }

    if (userSearchTimer) {
      window.clearTimeout(userSearchTimer);
    }
    userSearchTimer = window.setTimeout(() => {
      void loadUserSuggestions();
    }, 250);
  });

  userInput.addEventListener('focus', () => {
    void loadUserSuggestions();
  });

  monthOffsetSelect.addEventListener('change', () => {
    void loadAndRender();
  });

  useCurrentTabBtn.addEventListener('click', async () => {
    const activeBaseUrl = await getActiveTabJiraBaseUrl();
    if (!activeBaseUrl) {
      setStatus('Active tab is not a valid HTTPS URL.', 'error');
      return;
    }

    baseUrlInput.value = activeBaseUrl;
    await saveSettings();
    await loadAndRender();
  });

  exportBtn.addEventListener('click', () => {
    const offsetValue = Number(monthOffsetSelect.value);
    const csv = buildCsv(currentRows, currentTotalSeconds);
    downloadCsv(buildExportFileName(offsetValue), csv);
  });

  exportSummaryBtn.addEventListener('click', () => {
    const offsetValue = Number(monthOffsetSelect.value);
    const csv = buildSummaryCsv(currentRows, currentBaseUrl);
    downloadCsv(buildSummaryExportFileName(offsetValue), csv);
  });

  importCsvBtn.addEventListener('click', () => startImport('csv'));
  importKimaiBtn.addEventListener('click', () => startImport('kimai'));
  importTogglBtn.addEventListener('click', () => startImport('toggl'));
  administrationIssuesContainer.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement) {
      void saveAdministrationInput(event.target);
    }
  });
  importFileInput.addEventListener('change', () => {
    void handleImportFile();
  });

  sampleCsvLink.addEventListener('click', (event) => {
    event.preventDefault();
    downloadCsv('jira-worklog-import-sample.csv', `﻿${SAMPLE_CSV}`);
  });

  await loadAndRender();
}

void init();
