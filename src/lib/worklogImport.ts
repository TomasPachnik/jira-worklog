import type { AdministrationIssues, ImportRow, ImportSource } from '../types';

const ISSUE_KEY_PATTERN = /\b[A-Z][A-Z0-9_]+-\d+\b/;
const DEFAULT_START_TIME = '09:00';

export const SAMPLE_CSV = [
  'date;issueKey;start;timeSpent;comment',
  '2026-10-01;CP-4983;08:00;8h;DT2 - Care',
  '2026-10-20;CP-5061;08:00;4h;',
  '2026-10-20;CP-4983;12:00;3h 30m;Code review',
].join('\n');

interface ColumnSpec {
  date: string;
  start: string;
  duration: string;
  issueKey?: string;
  description: string;
}

const STANDARD_COLUMNS: ColumnSpec = {
  date: 'date',
  start: 'start',
  duration: 'timeSpent',
  issueKey: 'issueKey',
  description: 'comment',
};

const KIMAI_COLUMNS: ColumnSpec = {
  date: 'Date',
  start: 'From',
  duration: 'Duration',
  description: 'Description',
};

const TOGGL_COLUMNS: ColumnSpec = {
  date: 'Start date',
  start: 'Start time',
  duration: 'Duration',
  description: 'Description',
};

const COLUMNS: Record<ImportSource, ColumnSpec> = {
  csv: STANDARD_COLUMNS,
  kimai: KIMAI_COLUMNS,
  toggl: TOGGL_COLUMNS,
};

const DURATION_HINTS: Record<ImportSource, string> = {
  csv: 'e.g. 8h, 7h 30m, 45m',
  kimai: 'H:MM',
  toggl: 'H:MM:SS',
};

// Toggl description suffix after the issue key, e.g. "CP-5061 - codereview", "CP-5061 CR"
const CODE_REVIEW_PATTERN = /(?:^|[^\p{L}\p{N}])(?:cr|code[\s_-]?review)(?![\p{L}\p{N}])/iu;
// Toggl entries without an issue key that go to the yearly administration issue
const ADMINISTRATION_PATTERN = /^(stand[\s-]?up|status|produkcia)(?![\p{L}\p{N}])/iu;

interface IssueTarget {
  issueKey: string;
  comment: string;
  commentFromIssueType?: boolean;
  error?: string;
}

export function isValidIssueKey(value: string): boolean {
  return ISSUE_KEY_PATTERN.test(value);
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function detectDelimiter(headerLine: string): ',' | ';' {
  const semicolons = headerLine.split(';').length;
  const commas = headerLine.split(',').length;
  return semicolons > commas ? ';' : ',';
}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const firstLineEnd = input.indexOf('\n');
  const delimiter = detectDelimiter(firstLineEnd === -1 ? input : input.slice(0, firstLineEnd));

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim()));
}

function parseDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return `${pad2(hours)}:${pad2(minutes)}`;
}

// Worklog comment for a Toggl entry on a regular issue, by its Jira issue type
export function commentForIssueType(issueType: string | undefined): string {
  return /bug/i.test(issueType ?? '') ? 'bugfixing' : 'development';
}

function resolveTogglTarget(
  description: string,
  date: string | null,
  administrationIssues: AdministrationIssues,
): IssueTarget {
  const issueKey = ISSUE_KEY_PATTERN.exec(description)?.[0];
  if (issueKey) {
    return CODE_REVIEW_PATTERN.test(description.replace(issueKey, ''))
      ? { issueKey, comment: 'codereview' }
      : { issueKey, comment: '', commentFromIssueType: true };
  }

  const activity = ADMINISTRATION_PATTERN.exec(description.trim())?.[1];
  if (activity) {
    // "Stand-up" / "stand up" -> "standup"; "STATUS" -> "status"; "PRODUKCIA" -> "produkcia"
    const comment = activity.toLowerCase().replace(/[\s-]/g, '');
    if (!date) {
      // the invalid date is already reported
      return { issueKey: '', comment };
    }
    const year = date.slice(0, 4);
    const adminKey = administrationIssues[year];
    return adminKey
      ? { issueKey: adminKey, comment }
      : { issueKey: '', comment, error: `No administration task set for ${year} – fill in "Administration task ${year}" in the extension popup` };
  }

  return { issueKey: '', comment: '', error: 'No Jira issue key, STANDUP, STATUS or PRODUKCIA in the description' };
}

// Jira format: "8h", "7h 30m", "45m"
function parseJiraDuration(value: string): number | null {
  const match = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i.exec(value.trim());
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    return null;
  }
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60;
}

// Kimai / Toggl format: "8:00", "7:30", "0:45:00"
function parseClockDuration(value: string): number | null {
  const match = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

function resolveColumns(header: string[], spec: ColumnSpec): Record<keyof ColumnSpec, number | undefined> {
  const normalized = header.map((h) => h.trim().toLowerCase());
  const indexOf = (name: string | undefined): number | undefined => {
    if (!name) {
      return undefined;
    }
    const index = normalized.indexOf(name.toLowerCase());
    return index === -1 ? undefined : index;
  };

  const columns = {
    date: indexOf(spec.date),
    start: indexOf(spec.start),
    duration: indexOf(spec.duration),
    issueKey: indexOf(spec.issueKey),
    description: indexOf(spec.description),
  };

  const required: Array<keyof ColumnSpec> = spec.issueKey ? ['date', 'duration', 'issueKey'] : ['date', 'duration', 'description'];
  const missing = required.filter((key) => columns[key] === undefined).map((key) => spec[key]);
  if (missing.length > 0) {
    throw new Error(`Missing column(s): ${missing.join(', ')}`);
  }

  return columns;
}

export function parseImportCsv(
  text: string,
  source: ImportSource,
  administrationIssues: AdministrationIssues = {},
): ImportRow[] {
  const spec = COLUMNS[source];
  const [header, ...records] = parseCsv(text);
  if (!header) {
    throw new Error('The file is empty.');
  }

  const columns = resolveColumns(header, spec);
  const cell = (record: string[], index: number | undefined): string =>
    index === undefined ? '' : (record[index] ?? '').trim();

  if (records.length === 0) {
    throw new Error('The file contains no worklog rows.');
  }

  return records.map((record, i) => {
    const errors: string[] = [];

    const rawDate = cell(record, columns.date);
    const date = parseDate(rawDate);
    if (!date) {
      errors.push(`Invalid date "${rawDate}" (expected YYYY-MM-DD)`);
    }

    const rawStart = cell(record, columns.start);
    const startTime = rawStart ? parseTime(rawStart) : DEFAULT_START_TIME;
    if (!startTime) {
      errors.push(`Invalid start time "${rawStart}" (expected HH:MM)`);
    }

    const rawDuration = cell(record, columns.duration);
    const timeSpentSeconds = (source === 'csv' ? parseJiraDuration(rawDuration) : parseClockDuration(rawDuration)) ?? 0;
    if (timeSpentSeconds < 60) {
      errors.push(`Invalid time spent "${rawDuration}" (expected ${DURATION_HINTS[source]})`);
    }

    const description = cell(record, columns.description);
    let issueKey = '';
    let comment = '';
    let commentFromIssueType: boolean | undefined;
    if (source === 'toggl') {
      const target = resolveTogglTarget(description, date, administrationIssues);
      ({ issueKey, comment, commentFromIssueType } = target);
      if (target.error) {
        errors.push(target.error);
      }
    } else if (source === 'kimai') {
      // Kimai description is just "<KEY> - <task name>"; it is not copied to the worklog comment
      issueKey = ISSUE_KEY_PATTERN.exec(description)?.[0] ?? '';
      if (!issueKey) {
        errors.push('No Jira issue key at the start of the description');
      }
    } else {
      issueKey = cell(record, columns.issueKey).toUpperCase();
      comment = description;
      if (!issueKey) {
        errors.push('Missing issue key');
      }
    }
    if (issueKey && !ISSUE_KEY_PATTERN.test(issueKey)) {
      errors.push(`Invalid issue key "${issueKey}"`);
    }

    let started: Date | undefined;
    if (date && startTime) {
      const [year, month, day] = date.split('-').map(Number);
      const [hours, minutes] = startTime.split(':').map(Number);
      started = new Date(year, month - 1, day, hours, minutes);
    }

    return {
      rowNumber: i + 2,
      date: date ?? rawDate,
      startTime: startTime ?? rawStart,
      started,
      timeSpentSeconds,
      issueKey,
      comment,
      commentFromIssueType,
      errors,
    };
  });
}
