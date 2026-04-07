import type { MonthRange } from '../types';

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatJqlDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatIsoLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function getMonthRange(offset: number, now: Date = new Date()): MonthRange {
  const monthStart = new Date(now.getFullYear(), now.getMonth() - offset, 1, 0, 0, 0, 0);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);

  return {
    offset,
    start: monthStart,
    end: monthEnd,
    startDateJql: formatJqlDate(monthStart),
    endDateJql: formatJqlDate(monthEnd),
    label: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(monthStart),
  };
}

export function toLocalDateString(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return formatIsoLocalDate(date);
}

export function getMonthOptions(maxOffset: number): Array<{ value: string; label: string }> {
  const now = new Date();
  const options: Array<{ value: string; label: string }> = [];

  for (let offset = 0; offset <= maxOffset; offset += 1) {
    const range = getMonthRange(offset, now);
    const prefix = offset === 0 ? 'Current month' : `${offset} month${offset > 1 ? 's' : ''} ago`;
    options.push({ value: String(offset), label: `${prefix} (${range.label})` });
  }

  return options;
}
