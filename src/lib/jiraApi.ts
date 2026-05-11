import { toLocalDateString } from './dateUtils';
import type {
  JiraIssue,
  JiraIssueSearchResponse,
  JiraUser,
  JiraUserOption,
  JiraWorklog,
  JiraWorklogAuthor,
  JiraWorklogResponse,
  MonthRange,
  MonthlyWorklogResult,
  WorklogRow,
} from '../types';

const SEARCH_PAGE_SIZE = 50;
const WORKLOG_PAGE_SIZE = 100;
const WORKLOG_CONCURRENCY = 4;
const apiVersionCache = new Map<string, 3 | 2>();
const USER_SUGGESTION_LIMIT = 20;

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function escapeJqlValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function makeJql(range: MonthRange, authors?: string[]): string {
  let authorClause: string;
  if (authors && authors.length > 0) {
    if (authors.length === 1) {
      authorClause = `worklogAuthor = "${escapeJqlValue(authors[0])}"`;
    } else {
      authorClause = `worklogAuthor in (${authors.map((a) => `"${escapeJqlValue(a)}"`).join(', ')})`;
    }
  } else {
    authorClause = 'worklogAuthor = currentUser()';
  }
  return [
    authorClause,
    `AND worklogDate >= "${range.startDateJql}"`,
    `AND worklogDate <= "${range.endDateJql}"`,
    'ORDER BY updated DESC',
  ].join(' ');
}

async function jiraFetch<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira API error ${response.status}: ${body.slice(0, 300)}`);
  }

  return (await response.json()) as T;
}

async function tryJiraFetch<T>(baseUrl: string, path: string): Promise<T | null> {
  try {
    return await jiraFetch<T>(baseUrl, path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Jira API error 404') || message.includes('Jira API error 400')) {
      return null;
    }
    throw error;
  }
}

async function detectApiVersion(baseUrl: string): Promise<3 | 2> {
  const normalized = normalizeBaseUrl(baseUrl);
  const cached = apiVersionCache.get(normalized);
  if (cached) {
    return cached;
  }

  try {
    await jiraFetch<JiraUser>(normalized, '/rest/api/3/myself');
    apiVersionCache.set(normalized, 3);
    return 3;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Jira API error 404')) {
      throw error;
    }
  }

  await jiraFetch<JiraUser>(normalized, '/rest/api/2/myself');
  apiVersionCache.set(normalized, 2);
  return 2;
}

function userMatchesAuthor(user: JiraUser, author: JiraWorklogAuthor | undefined): boolean {
  if (!author) {
    return false;
  }

  if (user.accountId && author.accountId && user.accountId === author.accountId) {
    return true;
  }

  if (user.key && author.key && user.key === author.key) {
    return true;
  }

  if (user.name && author.name && user.name === author.name) {
    return true;
  }

  return false;
}

function normalizeIdentity(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function authorMatchesIdentity(author: JiraWorklogAuthor | undefined, identity: string): boolean {
  if (!author) {
    return false;
  }

  const target = normalizeIdentity(identity);
  if (!target) {
    return false;
  }

  const candidates = [author.accountId, author.key, author.name, author.displayName]
    .map(normalizeIdentity)
    .filter(Boolean);

  return candidates.includes(target);
}

function authorMatchesAnyIdentity(author: JiraWorklogAuthor | undefined, identities: string[]): boolean {
  return identities.some((id) => authorMatchesIdentity(author, id));
}

async function getCurrentUser(baseUrl: string, apiVersion: 3 | 2): Promise<JiraUser> {
  return jiraFetch<JiraUser>(baseUrl, `/rest/api/${apiVersion}/myself`);
}

async function searchIssues(baseUrl: string, apiVersion: 3 | 2, jql: string): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  let startAt = 0;

  while (true) {
    const payload = {
      jql,
      startAt,
      maxResults: SEARCH_PAGE_SIZE,
      fields: ['summary', 'project', 'resolution'],
    };

    const page = await jiraFetch<JiraIssueSearchResponse>(baseUrl, `/rest/api/${apiVersion}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    issues.push(...page.issues);
    startAt += page.maxResults;

    if (issues.length >= page.total || page.issues.length === 0) {
      break;
    }
  }

  return issues;
}

async function getIssueWorklogs(baseUrl: string, apiVersion: 3 | 2, issueKey: string): Promise<JiraWorklog[]> {
  const worklogs: JiraWorklog[] = [];
  let startAt = 0;

  while (true) {
    const page = await jiraFetch<JiraWorklogResponse>(
      baseUrl,
      `/rest/api/${apiVersion}/issue/${encodeURIComponent(issueKey)}/worklog?startAt=${startAt}&maxResults=${WORKLOG_PAGE_SIZE}`,
    );

    worklogs.push(...page.worklogs);
    startAt += page.maxResults;

    if (worklogs.length >= page.total || page.worklogs.length === 0) {
      break;
    }
  }

  return worklogs;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function toRow(issue: JiraIssue, worklog: JiraWorklog): WorklogRow {
  const authorDisplayName =
    worklog.author.displayName ?? worklog.author.name ?? worklog.author.accountId ?? worklog.author.key ?? '';
  const authorKey =
    worklog.author.accountId ?? worklog.author.key ?? worklog.author.name ?? worklog.author.displayName ?? '';
  return {
    date: toLocalDateString(worklog.started),
    issueKey: issue.key,
    summary: issue.fields.summary,
    timeSpent: worklog.timeSpent,
    timeSpentSeconds: worklog.timeSpentSeconds,
    project: issue.fields.project?.key ?? issue.fields.project?.name ?? '',
    started: worklog.started,
    authorDisplayName,
    authorKey,
    resolutionName: issue.fields.resolution?.name,
  };
}

function normalizeOptionValue(user: Partial<JiraUser>): string {
  return user.accountId ?? user.name ?? user.key ?? '';
}

function normalizeOptionLabel(user: Partial<JiraUser>): string {
  const display = user.displayName ?? user.name ?? user.key ?? user.accountId ?? '';
  const id = normalizeOptionValue(user);
  if (!display) {
    return '';
  }
  if (!id || display === id) {
    return display;
  }
  return `${display} (${id})`;
}

function dedupeUserOptions(options: JiraUserOption[]): JiraUserOption[] {
  const seen = new Set<string>();
  const unique: JiraUserOption[] = [];

  for (const option of options) {
    const key = option.value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(option);
  }

  return unique.slice(0, USER_SUGGESTION_LIMIT);
}

interface JiraUserPickerResponse {
  users?: {
    users?: Array<{
      accountId?: string;
      name?: string;
      key?: string;
      displayName?: string;
    }>;
  };
}

export async function searchJiraUsers(baseUrl: string, query: string): Promise<JiraUserOption[]> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) {
    return [];
  }

  const apiVersion = await detectApiVersion(baseUrl);
  const encodedQuery = encodeURIComponent(normalizedQuery);
  const options: JiraUserOption[] = [];

  const picker = await tryJiraFetch<JiraUserPickerResponse>(
    baseUrl,
    `/rest/api/${apiVersion}/user/picker?query=${encodedQuery}`,
  );

  for (const user of picker?.users?.users ?? []) {
    const value = normalizeOptionValue(user);
    const label = normalizeOptionLabel(user);
    if (value && label) {
      options.push({ value, label });
    }
  }

  const searchByQuery = await tryJiraFetch<JiraUser[]>(baseUrl, `/rest/api/${apiVersion}/user/search?query=${encodedQuery}`);
  for (const user of searchByQuery ?? []) {
    const value = normalizeOptionValue(user);
    const label = normalizeOptionLabel(user);
    if (value && label) {
      options.push({ value, label });
    }
  }

  const searchByUsername = await tryJiraFetch<JiraUser[]>(
    baseUrl,
    `/rest/api/${apiVersion}/user/search?username=${encodedQuery}`,
  );
  for (const user of searchByUsername ?? []) {
    const value = normalizeOptionValue(user);
    const label = normalizeOptionLabel(user);
    if (value && label) {
      options.push({ value, label });
    }
  }

  return dedupeUserOptions(options);
}

export async function fetchMonthlyWorklogs(
  baseUrl: string,
  range: MonthRange,
  authors?: string[],
): Promise<MonthlyWorklogResult> {
  const apiVersion = await detectApiVersion(baseUrl);
  const selectedAuthors = (authors ?? []).map((a) => a.trim()).filter(Boolean);

  // Deduplicate case-insensitively
  const seen = new Set<string>();
  const uniqueAuthors: string[] = [];
  for (const a of selectedAuthors) {
    const key = normalizeIdentity(a);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueAuthors.push(a);
    }
  }

  const hasAuthors = uniqueAuthors.length > 0;

  const [user, issues] = hasAuthors
    ? await Promise.all([Promise.resolve(undefined), searchIssues(baseUrl, apiVersion, makeJql(range, uniqueAuthors))])
    : await Promise.all([
        getCurrentUser(baseUrl, apiVersion),
        searchIssues(baseUrl, apiVersion, makeJql(range)),
      ]);

  const monthStartMs = range.start.getTime();
  const monthEndMs = range.end.getTime();

  const rowGroups = await mapWithConcurrency(issues, WORKLOG_CONCURRENCY, async (issue) => {
    const issueWorklogs = await getIssueWorklogs(baseUrl, apiVersion, issue.key);

    return issueWorklogs
      .filter((worklog) => {
        if (hasAuthors) {
          if (!authorMatchesAnyIdentity(worklog.author, uniqueAuthors)) {
            return false;
          }
        } else if (!user || !userMatchesAuthor(user, worklog.author)) {
          return false;
        }

        const startedMs = new Date(worklog.started).getTime();
        return startedMs >= monthStartMs && startedMs <= monthEndMs;
      })
      .map((worklog) => toRow(issue, worklog));
  });

  const rows = rowGroups.flat().sort((a, b) => new Date(a.started).getTime() - new Date(b.started).getTime());
  const totalSeconds = rows.reduce((sum, row) => sum + row.timeSpentSeconds, 0);

  let selectedUserLabels: string[];
  if (hasAuthors) {
    // Resolve display names from fetched worklog data; fall back to the raw identifier
    const identityToDisplay = new Map<string, string>();
    for (const row of rows) {
      const rowKey = normalizeIdentity(row.authorKey);
      if (!identityToDisplay.has(rowKey) && row.authorDisplayName) {
        identityToDisplay.set(rowKey, row.authorDisplayName);
      }
    }
    selectedUserLabels = uniqueAuthors.map((a) => identityToDisplay.get(normalizeIdentity(a)) ?? a);
  } else {
    selectedUserLabels = [user?.displayName ?? 'Current user'];
  }

  return {
    user,
    selectedUserLabels,
    rows,
    totalSeconds,
    issuesScanned: issues.length,
  };
}
