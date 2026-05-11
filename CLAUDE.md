# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension (Manifest V3) that fetches and displays Jira worklogs for a selected month, with CSV export. Supports both Jira Cloud (REST API v3) and Jira Server/Data Center (REST API v2).

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

**`src/lib/jiraApi.ts`** — Core API client. Detects Jira API version (v3 vs v2) via `/rest/api/*/myself`, caches the result per base URL. Fetches issues via JQL, then fetches worklogs per issue with pagination (100 items/page), up to 4 concurrent requests. Filters by user and date range.

**`src/popup/popup.ts`** — UI controller. Persists base URL, selected user, and month offset to `chrome.storage.local`. Renders worklog table and totals.

**`src/lib/dateUtils.ts`** — Calculates month date ranges; formats dates for JQL and display.

**`src/lib/csv.ts`** — Builds CSV with `;` delimiter, UTF-8 BOM (for Excel), columns: `date`, `issueKey`, `summary`, `timeSpent`, `timeSpentHours`, `timeSpentSeconds`, `project`. Last row is monthly total.

**`src/types.ts`** — TypeScript interfaces for Jira API responses and internal types.

### Authentication

Uses `credentials: 'include'` — relies entirely on the user's existing browser session in Chrome. No API tokens.

### API version detection

Tries v3 first; falls back to v2 on 404. Cached per base URL in memory during the popup session.
