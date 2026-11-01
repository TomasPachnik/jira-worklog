# Jira Monthly Worklog Chrome Extension

Minimal Chrome Extension (Manifest V3 + TypeScript) that loads Jira worklogs of one or more users for a selected month, shows totals, and exports a detailed CSV and a per-issue summary CSV.

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
  - One or more users, comma-separated (username, user key, account ID or display name)
  - Optional autocomplete user search (type at least 2 chars of the user being typed)
- Output:
  - Selected month label
  - Total logged time in popup (sum over all selected users)
  - Selected users and number of scanned issues
  - Table with date, user, issue key, summary, logged time, project
- CSV export (`Export CSV`): one row per worklog
- Summary CSV export (`Export Summary CSV`): one row per issue and user
- Both CSV files:
  - `;` separator
  - UTF-8 BOM for correct diacritics in Excel
  - Hours use a decimal comma (for example `1,50`)

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
4. (Optional) Type users into `Worklog users`, separated by commas, and pick from suggestions. Leave empty for yourself.
5. Select month offset.
6. Click `Refresh`.
7. Click `Export CSV` or `Export Summary CSV`.

Base URL, users and month are remembered between popup openings.

## CSV format

### Detailed CSV

File name: `jira-worklog-YYYY-MM.csv`

Columns:

- `date`
- `issueKey`
- `summary`
- `user`
- `timeSpent`
- `timeSpentHours`
- `timeSpentSeconds`
- `project`

At the end, CSV contains a summary line:

- `TOTAL_MONTH_HOURS`
- monthly total in hours and seconds

### Summary CSV

File name: `jira-worklog-summary-YYYY-MM.csv`

Worklogs are summed per issue and user, sorted by issue key and then by user.

Columns:

- `Project`: project key
- `Task ID`: issue key
- `Task Name`: issue summary
- `Solver`: user display name
- `Resolution`: `Y` if the issue resolution is `Done`, otherwise `N`
- `Spent (Hrs)`: hours logged by the user on the issue in the selected month
- `Jira ticket URL`: `<base URL>/browse/<issue key>`

## Notes

- Extension uses browser session (`credentials: include`), so user must already be logged into Jira in the same Chrome profile.
- Base URL is normalized to origin (for example `https://jira.company.com/path` becomes `https://jira.company.com`).
- Date filtering is done in two layers:
  - broad JQL by `worklogAuthor` and `worklogDate`
  - exact in-code filtering by worklog author and timestamp
- Month boundaries and worklog dates use the browser's local time zone.
- Host permissions are set to `https://*/*` to support custom Jira domains.

## Known limitations

- Large datasets can load slower (many issues/worklogs).
- User autocomplete depends on Jira user search endpoints and permissions; if disabled by admin, suggestions can be empty.
- `Resolution` in the summary CSV is `Y` only for a resolution named `Done` (case-insensitive); other resolution names give `N`.
- No day-grouping view yet.

## Possible next improvements

- Extend month range beyond `0..3`.
- Day grouping + per-day totals.
- Local caching for repeated month queries.
- Better domain validation and clearer API error messages.
