# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension (Manifest V3) that fetches and displays Jira worklogs of one or more users for a selected month, with a detailed CSV export and a per-issue summary CSV export. Supports both Jira Cloud (REST API v3) and Jira Server/Data Center (REST API v2).

## Commands

```bash
npm run build       # Build extension to dist/
npm run dev         # Watch mode, rebuild on changes
npm run typecheck   # Type check without emitting
```

There are no tests. To load the extension: enable Developer mode in `chrome://extensions`, click "Load unpacked", select `dist/`.

## Architecture

Two entry points bundled by Vite:
- `popup.html` + `src/popup/popup.ts` — the extension popup UI
- `src/background.ts` — service worker (minimal)

### Data flow

```
popup.ts (UI + state)
  → jiraApi.ts (Jira REST API calls)
  → csv.ts (CSV generation + download)
```

**`src/lib/jiraApi.ts`** — Core API client. Detects Jira API version (v3 vs v2) via `/rest/api/*/myself`, caches the result per base URL. `fetchMonthlyWorklogs` takes an optional list of author identities (deduplicated case-insensitively); with none it uses the current user. Searches issues via JQL (`worklogAuthor = currentUser()` or `worklogAuthor in (...)` plus `worklogDate` range, 50 issues/page), then fetches worklogs per issue with pagination (100 items/page), up to 4 concurrent requests. Filters worklogs by author (matching `accountId`/`key`/`name`/`displayName` for selected users) and exact timestamp range. `searchJiraUsers` powers autocomplete by combining `/user/picker` and `/user/search` results.

**`src/popup/popup.ts`** — UI controller. Users are entered comma-separated; autocomplete applies to the last token. Persists base URL, selected users (array, migrated from the legacy single-user `jiraWorklogUser` key), and month offset to `chrome.storage.local`. Renders worklog table (with user column), totals, and selected users.

**`src/lib/dateUtils.ts`** — Calculates month date ranges; formats dates for JQL and display.

**`src/lib/csv.ts`** — Both exports use `;` delimiter, UTF-8 BOM (for Excel), and decimal comma for hours.
- `buildCsv`: one row per worklog, columns `date`, `issueKey`, `summary`, `user`, `timeSpent`, `timeSpentHours`, `timeSpentSeconds`, `project`. Last row is monthly total (`TOTAL_MONTH_HOURS`).
- `buildSummaryCsv`: aggregated per issue + author, sorted by issue key then solver, columns `Project`, `Task ID`, `Task Name`, `Solver`, `Resolution` (`Y` only if resolution name is `Done`), `Spent (Hrs)`, `Jira ticket URL`.

**`src/types.ts`** — TypeScript interfaces for Jira API responses and internal types.

### Authentication

Uses `credentials: 'include'` — relies entirely on the user's existing browser session in Chrome. No API tokens.

### API version detection

Tries v3 first; falls back to v2 on 404. Cached per base URL in memory during the popup session.
