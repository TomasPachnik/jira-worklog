import type { WorklogRow } from '../types';

function escapeCsvCell(value: string | number): string {
  const stringValue = String(value);
  if (/[;"\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function secondsToHours(seconds: number): string {
  const hours = seconds / 3600;
  return hours.toFixed(2).replace('.', ',');
}

export function buildCsv(rows: WorklogRow[], totalSeconds?: number): string {
  const header = ['date', 'issueKey', 'summary', 'timeSpent', 'timeSpentHours', 'timeSpentSeconds', 'project'];
  const lines = [header.join(';')];

  for (const row of rows) {
    lines.push(
      [row.date, row.issueKey, row.summary, row.timeSpent, secondsToHours(row.timeSpentSeconds), row.timeSpentSeconds, row.project]
        .map(escapeCsvCell)
        .join(';'),
    );
  }

  if (typeof totalSeconds === 'number') {
    lines.push('');
    lines.push(
      ['', '', 'TOTAL_MONTH_HOURS', '', secondsToHours(totalSeconds), totalSeconds, '']
        .map(escapeCsvCell)
        .join(';'),
    );
  }

  return `\uFEFF${lines.join('\n')}`;
}

export function downloadCsv(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}
