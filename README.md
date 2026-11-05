# Jira Monthly Worklog Chrome Extension

Minimal Chrome Extension (Manifest V3 + TypeScript) that loads Jira worklogs of one or more users for a selected month, shows totals, and exports a detailed CSV and a per-issue summary CSV. It can also bulk-log worklogs to Jira from a CSV file, a Kimai export or a Toggl Track export.

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
- Bulk worklog import (`Import from CSV`, `Import from Kimai`, `Import from Toggl`) with a preview window before anything is logged
- Both CSV export files:
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
- `import.html`
- `src/import/import.ts`
- `src/import/import.css`
- `src/lib/jiraApi.ts`
- `src/lib/dateUtils.ts`
- `src/lib/csv.ts`
- `src/lib/worklogImport.ts`
- `src/lib/settings.ts`
- `src/lib/html.ts`
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

## Worklog import

Logs your own worklogs to Jira in bulk, for example once a month.

1. Set the Jira Base URL in the popup.
2. Click `Import from CSV`, `Import from Kimai` or `Import from Toggl` and pick a `.csv` file.
3. A separate window opens, checks every row against Jira and shows a preview grouped by day with daily totals:
   - red row: error (invalid date/time/duration, missing issue key, issue not found in Jira). Logging is blocked; fix the CSV and import it again.
   - blue row: the same worklog (issue, start and duration) already exists in Jira, or appears earlier in the file. It will be skipped.
   - other rows will be logged.
4. Click `Log N worklogs` to log them one by one, or `Cancel`. Each row then shows `✓ Logged` or the error returned by Jira.

Imported worklogs cannot be undone from the extension.

### Standard import CSV

Download a sample via `Download sample CSV` in the popup.

```csv
date;issueKey;start;timeSpent;comment
2026-10-01;CP-4983;08:00;8h;DT2 - Care
2026-10-20;CP-5061;08:00;4h;
2026-10-20;CP-4983;12:00;3h 30m;Code review
```

- Header row is required; column order does not matter, names are case-insensitive.
- `;` separator (`,` is also detected), UTF-8 with or without BOM.
- `date` (required): `YYYY-MM-DD`
- `issueKey` (required): for example `CP-4983`
- `start` (optional): `HH:MM`, defaults to `09:00`
- `timeSpent` (required): Jira format, for example `8h`, `7h 30m`, `45m`. Days and weeks (`d`, `w`) are not supported.
- `comment` (optional): worklog comment

### Kimai import

Use the CSV export from Kimai as is. Used columns:

- `Date` (`YYYY-MM-DD`), `From` (`HH:MM`), `Duration` (`H:MM`)
- `Description`: must contain the Jira issue key, for example `CP-5098 - Notifikácia s aktualizáciami OpenAPI modelu`. Only the key is used; worklogs are logged without a comment.

### Toggl import

Use the Toggl Track detailed report CSV export as is. Used columns:

- `Start date` (`YYYY-MM-DD`), `Start time` (`HH:MM:SS`), `Duration` (`H:MM:SS`)
- `Description` decides the issue and the worklog comment:

| Description | Logged to | Comment |
| --- | --- | --- |
| `CP-5061 - codereview`, `CP-5061 CR`, `CP-5061 code-review` | `CP-5061` | `codereview` |
| `CP-5100` (issue type Bug) | `CP-5100` | `bugfixing` |
| `CP-5100` (any other issue type: Task, Feature, Story, …) | `CP-5100` | `development` |
| `STANDUP` | administration issue of the worklog's year | `standup` |
| `STATUS` | administration issue of the worklog's year | `status` |
| `PRODUKCIA` | administration issue of the worklog's year | `produkcia` |

Any other description without an issue key is an error.

The administration task changes every year. Set it in the popup footer in `Administration task <year>:` (default `Administration task 2026: CP-4405`). The popup shows a field for the current year, plus the previous year while it is filled in, so in January 2027 you see both `Administration task 2026:` and an empty `Administration task 2027:` to fill in. The year is taken from the worklog date, so December entries imported in January still go to the previous year's task.

## Notes

- Extension uses browser session (`credentials: include`), so user must already be logged into Jira in the same Chrome profile.
- Base URL is normalized to origin (for example `https://jira.company.com/path` becomes `https://jira.company.com`).
- Date filtering is done in two layers:
  - broad JQL by `worklogAuthor` and `worklogDate`
  - exact in-code filtering by worklog author and timestamp
- Month boundaries, worklog dates and imported start times use the browser's local time zone.
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
