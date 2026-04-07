import { buildCsv, downloadCsv } from '../lib/csv';
import { getMonthOptions, getMonthRange } from '../lib/dateUtils';
import { fetchMonthlyWorklogs, searchJiraUsers } from '../lib/jiraApi';
import type { WorklogRow } from '../types';
import './popup.css';

const STORAGE_KEYS = {
  baseUrl: 'jiraBaseUrl',
  user: 'jiraWorklogUser',
  monthOffset: 'monthOffset',
} as const;

const MAX_MONTH_OFFSET = 3;

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

let currentRows: WorklogRow[] = [];
let currentTotalSeconds = 0;
let userSearchTimer: number | undefined;

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function sanitizeBaseUrl(value: string): string {
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
        <td>${row.issueKey}</td>
        <td>${escapeHtml(row.summary)}</td>
        <td>${row.timeSpent}</td>
        <td>${escapeHtml(row.project)}</td>
      </tr>`,
    )
    .join('');

  worklogTable.classList.remove('hidden');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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
    [STORAGE_KEYS.user]: userInput.value.trim(),
    [STORAGE_KEYS.monthOffset]: Number(monthOffsetSelect.value),
  });
}

function buildExportFileName(offset: number): string {
  const range = getMonthRange(offset);
  const yyyy = range.start.getFullYear();
  const mm = String(range.start.getMonth() + 1).padStart(2, '0');
  return `jira-worklog-${yyyy}-${mm}.csv`;
}

function renderUserSuggestions(options: Array<{ value: string; label: string }>): void {
  userSuggestions.innerHTML = options
    .map((option) => `<option value="${escapeHtml(option.value)}" label="${escapeHtml(option.label)}"></option>`)
    .join('');
}

async function loadUserSuggestions(): Promise<void> {
  const baseUrl = sanitizeBaseUrl(baseUrlInput.value);
  const query = userInput.value.trim();

  if (!baseUrl || query.length < 2) {
    renderUserSuggestions([]);
    return;
  }

  try {
    const options = await searchJiraUsers(baseUrl, query);
    renderUserSuggestions(options);
  } catch {
    renderUserSuggestions([]);
  }
}

async function loadAndRender(): Promise<void> {
  const baseUrl = sanitizeBaseUrl(baseUrlInput.value);
  const selectedUser = userInput.value.trim();
  const offset = Number(monthOffsetSelect.value);
  const range = getMonthRange(offset);

  monthLabel.textContent = range.label;

  if (!baseUrl) {
    setStatus('Set Jira Base URL first, then click Refresh.', 'error');
    totalTime.textContent = '0h 0m';
    metaInfo.textContent = '';
    currentRows = [];
    currentTotalSeconds = 0;
    clearTable();
    exportBtn.disabled = true;
    return;
  }

  await saveSettings();

  setStatus('Loading worklogs...', 'loading');
  clearTable();
  exportBtn.disabled = true;

  try {
    const result = await fetchMonthlyWorklogs(baseUrl, range, selectedUser || undefined);
    currentRows = result.rows;
    currentTotalSeconds = result.totalSeconds;

    totalTime.textContent = formatDuration(result.totalSeconds);
    metaInfo.textContent = `User: ${result.selectedUserLabel} | Issues scanned: ${result.issuesScanned}`;

    if (result.rows.length === 0) {
      setStatus('No worklogs found for selected month.', 'empty');
      clearTable();
      exportBtn.disabled = true;
      return;
    }

    setStatus('', 'hidden');
    renderTable(result.rows);
    exportBtn.disabled = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed to load data: ${message}`, 'error');
    totalTime.textContent = '0h 0m';
    metaInfo.textContent = '';
    currentRows = [];
    currentTotalSeconds = 0;
    clearTable();
    exportBtn.disabled = true;
  }
}

function initMonthSelect(): void {
  monthOffsetSelect.innerHTML = getMonthOptions(MAX_MONTH_OFFSET)
    .map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
    .join('');
}

async function init(): Promise<void> {
  initMonthSelect();

  const stored = await chrome.storage.local.get([STORAGE_KEYS.baseUrl, STORAGE_KEYS.user, STORAGE_KEYS.monthOffset]);
  const tabBaseUrl = await getActiveTabJiraBaseUrl();

  baseUrlInput.value = sanitizeBaseUrl(stored[STORAGE_KEYS.baseUrl] ?? tabBaseUrl ?? '');
  userInput.value = String(stored[STORAGE_KEYS.user] ?? '');

  const offset = Number(stored[STORAGE_KEYS.monthOffset]);
  monthOffsetSelect.value = Number.isFinite(offset) && offset >= 0 && offset <= MAX_MONTH_OFFSET ? String(offset) : '0';

  refreshBtn.addEventListener('click', () => {
    void loadAndRender();
  });

  userInput.addEventListener('input', () => {
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

  await loadAndRender();
}

void init();
