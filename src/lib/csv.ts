import { normalizeBaseUrl } from './jiraApi';
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
  const header = ['date', 'issueKey', 'summary', 'user', 'timeSpent', 'timeSpentHours', 'timeSpentSeconds', 'project'];
  const lines = [header.join(';')];

  for (const row of rows) {
    lines.push(
      [row.date, row.issueKey, row.summary, row.authorDisplayName, row.timeSpent, secondsToHours(row.timeSpentSeconds), row.timeSpentSeconds, row.project]
        .map(escapeCsvCell)
        .join(';'),
    );
  }

  if (typeof totalSeconds === 'number') {
    lines.push('');
    lines.push(
      ['', '', 'TOTAL_MONTH_HOURS', '', '', secondsToHours(totalSeconds), totalSeconds, '']
        .map(escapeCsvCell)
        .join(';'),
    );
  }

  return `﻿${lines.join('\n')}`;
}

interface SummaryAggregate {
  project: string;
  issueKey: string;
  summary: string;
  solver: string;
  authorKey: string;
  resolutionName: string | undefined;
  totalSeconds: number;
}

export function buildSummaryCsv(rows: WorklogRow[], baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const aggregates = new Map<string, SummaryAggregate>();

  for (const row of rows) {
    const key = `${row.issueKey}||${row.authorKey}`;
    const existing = aggregates.get(key);
    if (existing) {
      existing.totalSeconds += row.timeSpentSeconds;
    } else {
      aggregates.set(key, {
        project: row.project,
        issueKey: row.issueKey,
        summary: row.summary,
        solver: row.authorDisplayName,
        authorKey: row.authorKey,
        resolutionName: row.resolutionName,
        totalSeconds: row.timeSpentSeconds,
      });
    }
  }

  const sorted = [...aggregates.values()].sort((a, b) => {
    const byIssue = a.issueKey.localeCompare(b.issueKey);
    if (byIssue !== 0) return byIssue;
    return a.solver.localeCompare(b.solver);
  });

  const header = ['Project', 'Task ID', 'Task Name', 'Solver', 'Resolution', 'Spent (Hrs)', 'Jira ticket URL'];
  const lines = [header.join(';')];

  for (const agg of sorted) {
    const resolution = (agg.resolutionName ?? '').toLowerCase() === 'done' ? 'Y' : 'N';
    const url = `${base}/browse/${agg.issueKey}`;
    lines.push(
      [agg.project, agg.issueKey, agg.summary, agg.solver, resolution, secondsToHours(agg.totalSeconds), url]
        .map(escapeCsvCell)
        .join(';'),
    );
  }

  return `﻿${lines.join('\n')}`;
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
