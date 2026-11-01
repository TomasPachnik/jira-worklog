# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension (Manifest V3) that fetches and displays Jira worklogs of one or more users for a selected month, with a detailed CSV export and a per-issue summary CSV export. Also bulk-logs worklogs from a standard CSV or a Kimai CSV export. Supports both Jira Cloud (REST API v3) and Jira Server/Data Center (REST API v2).

## Commands

```bash
npm run build       # Build extension to dist/
npm run dev         # Watch mode, rebuild on changes
npm run typecheck   # Type check without emitting
```

There are no tests. To load the extension: enable Developer mode in `chrome://extensions`, click "Load unpacked", select `dist/`.

## Architecture

Three entry points bundled by Vite:
- `popup.html` + `src/popup/popup.ts` — the extension popup UI
- `import.html` + `src/import/import.ts` — import preview/confirmation window
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

**`src/lib/worklogImport.ts`** — CSV parser (quoted fields, `;`/`,` auto-detect, BOM) and `parseImportCsv(text, source)` for the two import formats: standard (`date;issueKey;start;timeSpent;comment`, Jira-style durations like `7h 30m`) and Kimai (`Date`, `From`, `Duration` as `H:MM`, issue key extracted from `Description`). Throws on missing columns; row-level problems go to `ImportRow.errors`. Also holds `SAMPLE_CSV`.

**`src/lib/settings.ts`** / **`src/lib/html.ts`** — shared storage keys, `sanitizeBaseUrl`, `escapeHtml`.

### Import flow

```
popup.ts: Import button → hidden file input → parseImportCsv (fail fast on wrong file)
  → chrome.storage.session[pendingImport] = { source, fileName, baseUrl, text }
  → chrome.windows.create(import.html, type 'popup', centered over the current window)
import.ts: reads + removes pendingImport → parseImportCsv again
  → fetchIssuesWithMyWorklogs (issue exists? my existing worklogs)
  → classify rows: error (red, blocks logging) | duplicate (blue, skipped) | ready
  → on confirm: addWorklog sequentially, per-row result
```

Import runs in a separate window because the extension popup closes on blur; the popup only picks and parses the file. Duplicate = same issue, same `started` instant and same `timeSpentSeconds` (also within the file). No delete/undo: users may lack permission to delete worklogs.

### Authentication

Uses `credentials: 'include'` — relies entirely on the user's existing browser session in Chrome. No API tokens.

### API version detection

Tries v3 first; falls back to v2 on 404. Cached per base URL in memory during the popup session.
