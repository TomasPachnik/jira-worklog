export interface MonthRange {
  offset: number;
  start: Date;
  end: Date;
  startDateJql: string;
  endDateJql: string;
  label: string;
}

export interface JiraUser {
  accountId?: string;
  key?: string;
  name?: string;
  displayName: string;
}

export interface JiraProject {
  key: string;
  name?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    project?: JiraProject;
    resolution?: { name?: string };
    issuetype?: { name?: string };
  };
}

export interface JiraIssueSearchResponse {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

export interface JiraWorklogAuthor {
  accountId?: string;
  key?: string;
  name?: string;
  displayName?: string;
}

export interface JiraWorklog {
  id: string;
  author: JiraWorklogAuthor;
  started: string;
  timeSpent: string;
  timeSpentSeconds: number;
}

export interface JiraWorklogResponse {
  startAt: number;
  maxResults: number;
  total: number;
  worklogs: JiraWorklog[];
}

export interface WorklogRow {
  date: string;
  issueKey: string;
  summary: string;
  timeSpent: string;
  timeSpentSeconds: number;
  project: string;
  started: string;
  authorDisplayName: string;
  authorKey: string;
  resolutionName?: string;
}

export interface MonthlyWorklogResult {
  user?: JiraUser;
  selectedUserLabels: string[];
  rows: WorklogRow[];
  totalSeconds: number;
  issuesScanned: number;
}

export interface JiraUserOption {
  value: string;
  label: string;
}

export type ImportSource = 'csv' | 'kimai' | 'toggl';

// Year ("2026") -> Jira issue key that STANDUP/STATUS/PRODUKCIA entries from Toggl are logged to
export type AdministrationIssues = Record<string, string>;

export interface ImportRow {
  rowNumber: number;
  date: string;
  startTime: string;
  started?: Date;
  timeSpentSeconds: number;
  issueKey: string;
  comment: string;
  // Toggl: the comment depends on the Jira issue type, so it is filled in once the issue is loaded
  commentFromIssueType?: boolean;
  errors: string[];
}

export interface PendingImport {
  source: ImportSource;
  fileName: string;
  baseUrl: string;
  text: string;
  administrationIssues: AdministrationIssues;
}

export interface NewWorklog {
  started: Date;
  timeSpentSeconds: number;
  comment: string;
}

export interface IssueWithMyWorklogs {
  summary: string;
  issueType?: string;
  worklogs: JiraWorklog[];
}
