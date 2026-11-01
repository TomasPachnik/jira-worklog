import { formatDuration } from '../lib/dateUtils';
import { escapeHtml } from '../lib/html';
import { addWorklog, fetchIssuesWithMyWorklogs, normalizeBaseUrl } from '../lib/jiraApi';
import { PENDING_IMPORT_KEY } from '../lib/settings';
import { isValidIssueKey, parseImportCsv } from '../lib/worklogImport';
import type { ImportRow, IssueWithMyWorklogs, PendingImport } from '../types';
import './import.css';

type RowStatus = 'error' | 'duplicate' | 'ready' | 'logging' | 'logged' | 'failed';
type Phase = 'checking' | 'preview' | 'logging' | 'done';

interface RowState {
  row: ImportRow;
  status: RowStatus;
  summary: string;
  message: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const title = getRequiredElement<HTMLElement>('#title');
const summary = getRequiredElement<HTMLElement>('#summary');
const banner = getRequiredElement<HTMLElement>('#banner');
const previewTable = getRequiredElement<HTMLTableElement>('#previewTable');
const previewBody = getRequiredElement<HTMLTableSectionElement>('#previewBody');
const cancelBtn = getRequiredElement<HTMLButtonElement>('#cancelBtn');
const confirmBtn = getRequiredElement<HTMLButtonElement>('#confirmBtn');

let phase: Phase = 'checking';
let baseUrl = '';
let states: RowState[] = [];

function setBanner(message: string, mode: 'loading' | 'info' | 'error' | 'success' | 'hidden'): void {
  banner.className = 'banner';
  if (mode === 'hidden') {
    banner.classList.add('hidden');
    banner.textContent = '';
    return;
  }
  banner.classList.add(mode);
  banner.textContent = message;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Turn "Jira API error 400: {"errorMessages":[...],"errors":{...}}" into readable text
  const jsonStart = message.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const body = JSON.parse(message.slice(jsonStart)) as { errorMessages?: string[]; errors?: Record<string, string> };
      const parts = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})];
      if (parts.length > 0) {
        return parts.join('; ');
      }
    } catch {
      // body was truncated or not JSON; fall back to the raw message
    }
  }
  return message;
}

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDayLabel(row: ImportRow): string {
  if (!row.started) {
    return `Invalid date "${row.date}"`;
  }
  const d = row.started;
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function formatShortDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}.${year}`;
}

function sumSeconds(items: RowState[]): number {
  return items.reduce((sum, s) => sum + s.row.timeSpentSeconds, 0);
}

function renderSummary(): void {
  const valid = states.filter((s) => s.status !== 'error');
  const ready = states.filter((s) => s.status === 'ready');
  const duplicates = states.filter((s) => s.status === 'duplicate');
  const errors = states.filter((s) => s.status === 'error');
  const logged = states.filter((s) => s.status === 'logged');
  const failed = states.filter((s) => s.status === 'failed');
  const dates = valid.map((s) => s.row.date).sort();

  const chips: string[] = [`<span class="chip">${states.length} rows</span>`];
  if (dates.length > 0) {
    chips.push(`<span class="chip">${formatShortDate(dates[0])} – ${formatShortDate(dates[dates.length - 1])}</span>`);
    chips.push(`<span class="chip">${new Set(dates).size} days</span>`);
    chips.push(`<span class="chip">${new Set(valid.map((s) => s.row.issueKey)).size} issues</span>`);
  }
  if (phase === 'preview' || phase === 'checking') {
    chips.push(`<span class="chip"><strong>To log: ${ready.length} (${formatDuration(sumSeconds(ready))})</strong></span>`);
  } else {
    chips.push(`<span class="chip"><strong>Logged: ${logged.length} (${formatDuration(sumSeconds(logged))})</strong></span>`);
    if (failed.length > 0) {
      chips.push(`<span class="chip error">Failed: ${failed.length}</span>`);
    }
  }
  if (duplicates.length > 0) {
    chips.push(`<span class="chip duplicate">Skipped: ${duplicates.length} (${formatDuration(sumSeconds(duplicates))})</span>`);
  }
  if (errors.length > 0) {
    chips.push(`<span class="chip error">Errors: ${errors.length}</span>`);
  }

  summary.innerHTML = chips.join('');
}

function renderRow(state: RowState, index: number): string {
  const { row } = state;
  const end = row.started ? new Date(row.started.getTime() + row.timeSpentSeconds * 1000) : undefined;
  const issue = row.issueKey && isValidIssueKey(row.issueKey)
    ? `<a href="${escapeHtml(`${baseUrl}/browse/${row.issueKey}`)}" target="_blank" rel="noopener">${escapeHtml(row.issueKey)}</a>`
    : escapeHtml(row.issueKey);

  return `
    <tr class="row-${state.status}" data-index="${index}">
      <td class="num">${row.rowNumber}</td>
      <td class="nowrap">${escapeHtml(row.startTime)}</td>
      <td class="nowrap">${end ? formatClock(end) : ''}</td>
      <td class="nowrap">${row.timeSpentSeconds > 0 ? formatDuration(row.timeSpentSeconds) : ''}</td>
      <td class="nowrap">${issue}</td>
      <td>${escapeHtml(state.summary)}</td>
      <td>${escapeHtml(row.comment)}</td>
      <td class="statusText">${escapeHtml(state.message)}</td>
    </tr>`;
}

function renderTable(): void {
  const groups = new Map<string, number[]>();
  states.forEach((state, index) => {
    const key = state.row.started ? state.row.date : `~invalid:${state.row.date}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  // Invalid dates first so errors are easy to spot, then chronologically
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const aInvalid = a.startsWith('~');
    const bInvalid = b.startsWith('~');
    if (aInvalid !== bInvalid) {
      return aInvalid ? -1 : 1;
    }
    return a.localeCompare(b);
  });

  previewBody.innerHTML = sortedKeys
    .map((key) => {
      const indexes = (groups.get(key) ?? []).sort(
        (a, b) => (states[a].row.started?.getTime() ?? 0) - (states[b].row.started?.getTime() ?? 0),
      );
      const dayStates = indexes.map((i) => states[i]);
      const dayTotal = sumSeconds(dayStates.filter((s) => s.status !== 'error'));
      const header = `
        <tr class="dayRow">
          <td colspan="8">${escapeHtml(formatDayLabel(dayStates[0].row))}<span class="dayTotal">${formatDuration(dayTotal)}</span></td>
        </tr>`;
      return header + indexes.map((i) => renderRow(states[i], i)).join('');
    })
    .join('');

  previewTable.classList.remove('hidden');
  renderSummary();
}

function renderFooter(): void {
  const ready = states.filter((s) => s.status === 'ready');
  const hasErrors = states.some((s) => s.status === 'error');

  cancelBtn.textContent = phase === 'done' ? 'Close' : 'Cancel';
  cancelBtn.disabled = phase === 'logging';
  confirmBtn.classList.toggle('hidden', phase === 'done');
  confirmBtn.disabled = phase !== 'preview' || hasErrors || ready.length === 0;
  confirmBtn.textContent = `Log ${ready.length} worklog${ready.length === 1 ? '' : 's'} (${formatDuration(sumSeconds(ready))})`;
}

function classifyRows(rows: ImportRow[], issues: Map<string, IssueWithMyWorklogs | null>): RowState[] {
  const seenInFile = new Set<string>();

  return rows.map((row) => {
    const errors = [...row.errors];
    const issue = isValidIssueKey(row.issueKey) ? issues.get(row.issueKey) : undefined;
    if (issue === null) {
      errors.push('Issue not found in Jira (or you have no access to it)');
    }

    if (errors.length > 0 || !issue || !row.started) {
      return { row, status: 'error', summary: issue?.summary ?? '', message: errors.join('; ') };
    }

    const startedMs = row.started.getTime();
    const existsInJira = issue.worklogs.some(
      (w) => new Date(w.started).getTime() === startedMs && w.timeSpentSeconds === row.timeSpentSeconds,
    );
    if (existsInJira) {
      return { row, status: 'duplicate', summary: issue.summary, message: 'Already exists in Jira – will be skipped' };
    }

    const fileKey = `${row.issueKey}|${startedMs}|${row.timeSpentSeconds}`;
    if (seenInFile.has(fileKey)) {
      return { row, status: 'duplicate', summary: issue.summary, message: 'Same entry is already in this file – will be skipped' };
    }
    seenInFile.add(fileKey);

    return { row, status: 'ready', summary: issue.summary, message: 'Will be logged' };
  });
}

async function logWorklogs(): Promise<void> {
  const toLog = states.filter((s) => s.status === 'ready');
  phase = 'logging';
  renderFooter();

  for (const [i, state] of toLog.entries()) {
    setBanner(`Logging ${i + 1} of ${toLog.length}…`, 'loading');
    state.status = 'logging';
    state.message = 'Logging…';
    renderTable();
    previewBody.querySelector(`tr[data-index="${states.indexOf(state)}"]`)?.scrollIntoView({ block: 'nearest' });

    try {
      await addWorklog(baseUrl, state.row.issueKey, {
        started: state.row.started as Date,
        timeSpentSeconds: state.row.timeSpentSeconds,
        comment: state.row.comment,
      });
      state.status = 'logged';
      state.message = '✓ Logged';
    } catch (error) {
      state.status = 'failed';
      state.message = `Failed: ${errorMessage(error)}`;
    }
  }

  phase = 'done';
  renderTable();
  renderFooter();

  const failed = toLog.filter((s) => s.status === 'failed').length;
  if (failed > 0) {
    setBanner(`Logged ${toLog.length - failed} of ${toLog.length} worklogs. ${failed} failed – see the red rows.`, 'error');
  } else {
    setBanner(`All ${toLog.length} worklogs were logged to Jira.`, 'success');
  }
}

async function init(): Promise<void> {
  cancelBtn.addEventListener('click', () => window.close());
  confirmBtn.addEventListener('click', () => {
    void logWorklogs();
  });
  window.addEventListener('beforeunload', (event) => {
    if (phase === 'logging') {
      event.preventDefault();
    }
  });
  renderFooter();

  const stored = await chrome.storage.session.get(PENDING_IMPORT_KEY);
  const pending = stored[PENDING_IMPORT_KEY] as PendingImport | undefined;
  if (!pending) {
    phase = 'done';
    renderFooter();
    setBanner('No file to import. Close this window and start the import again from the extension.', 'error');
    return;
  }
  await chrome.storage.session.remove(PENDING_IMPORT_KEY);

  baseUrl = normalizeBaseUrl(pending.baseUrl);
  const sourceLabel = pending.source === 'kimai' ? 'Kimai' : 'CSV';
  title.textContent = `Import from ${sourceLabel}: ${pending.fileName}`;
  document.title = `Import from ${sourceLabel}`;
  setBanner(`Checking issues and existing worklogs in ${baseUrl}…`, 'loading');

  try {
    const rows = parseImportCsv(pending.text, pending.source);
    const issueKeys = [...new Set(rows.map((r) => r.issueKey).filter(isValidIssueKey))];
    const issues = await fetchIssuesWithMyWorklogs(baseUrl, issueKeys);
    states = classifyRows(rows, issues);
  } catch (error) {
    phase = 'done';
    renderFooter();
    setBanner(`Failed to check the import: ${errorMessage(error)}`, 'error');
    return;
  }

  phase = 'preview';
  renderTable();
  renderFooter();

  const errors = states.filter((s) => s.status === 'error').length;
  const ready = states.filter((s) => s.status === 'ready').length;
  if (errors > 0) {
    setBanner(`${errors} row${errors === 1 ? ' contains' : 's contain'} errors. Fix the CSV file and import it again.`, 'error');
  } else if (ready === 0) {
    setBanner('Nothing to log – all entries already exist in Jira.', 'info');
  } else {
    setBanner('Check the worklogs below, then confirm.', 'info');
  }
}

void init();
