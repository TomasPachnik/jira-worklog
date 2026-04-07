# Jira Monthly Worklog Chrome Extension

Minimal Chrome Extension (Manifest V3 + TypeScript) that loads Jira worklogs for a selected month, shows totals, and exports CSV.

## Features

- Popup-based UI (`action` popup).
- Jira REST API-first approach (no HTML scraping).
- Works with Jira Cloud and Jira Server/Data Center:
  - Tries `/rest/api/3` first
  - Falls back to `/rest/api/2` on 404
- Month selector by offset:
  - Current month
  - 1 month ago
  - 2 months ago
  - 3 months ago
- User selection:
  - Empty value = current logged-in user
  - Optional autocomplete user search (type at least 2 chars)
- Output:
  - Selected month label
  - Total logged time in popup
  - Table with date, issue key, summary, logged time, project
- CSV export:
  - `;` separator
  - UTF-8 BOM for correct diacritics in Excel
  - Includes `timeSpentHours` column next to `timeSpent`
  - Adds final summary row with monthly total hours

## Tech stack

- Manifest V3
- TypeScript
- Vite (simple build)
- Vanilla HTML/CSS/TS

## Project structure

- `public/manifest.json`
- `popup.html`
- `src/background.ts`
- `src/popup/popup.ts`
- `src/popup/popup.css`
- `src/lib/jiraApi.ts`
- `src/lib/dateUtils.ts`
- `src/lib/csv.ts`
- `src/types.ts`

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

Build output is generated in `dist/`.

## Load into Chrome (local / unpacked)

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `dist/` folder

## Usage

1. Open your Jira page.
2. Click the extension icon.
3. (Optional) Click `Use current tab` to auto-fill Jira base URL.
4. (Optional) Start typing user name in `Worklog user` and pick from suggestions.
5. Select month offset.
6. Click `Refresh`.
7. Click `Export CSV`.

## CSV format

Columns:

- `date`
- `issueKey`
- `summary`
- `timeSpent`
- `timeSpentHours`
- `timeSpentSeconds`
- `project`

At the end, CSV contains a summary line:

- `TOTAL_MONTH_HOURS`
- monthly total in hours and seconds

## Notes

- Extension uses browser session (`credentials: include`), so user must already be logged into Jira in the same Chrome profile.
- Base URL is normalized to origin (for example `https://jira.company.com/path` becomes `https://jira.company.com`).
- Date filtering is done in two layers:
  - broad JQL by `worklogDate`
  - exact in-code filtering by worklog timestamp
- Host permissions are set to `https://*/*` to support custom Jira domains.

## Known limitations

- Large datasets can load slower (many issues/worklogs).
- User autocomplete depends on Jira user search endpoints and permissions; if disabled by admin, suggestions can be empty.
- No day-grouping view yet.

## Possible next improvements

- Extend month range beyond `0..3`.
- Day grouping + per-day totals.
- Local caching for repeated month queries.
- Better domain validation and clearer API error messages.
