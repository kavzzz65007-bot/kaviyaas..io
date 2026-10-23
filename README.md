# APAAR SmartVerify - Verify Before You Upload

A pre-upload student data validation demo for educational institutions. It helps staff find and fix data-quality issues **before** records are uploaded to an authorized academic portal.

> Independent hackathon project. Not affiliated with, endorsed by, or connected to AICTE or the official APAAR portal. Reports are local data-quality outputs, **not** official APAAR certificates. All demo data is synthetic.

## Project files

```
apaar-smartverify/
  index.html     landing page (AICTE logo on first screen), login, app shell
  style.css      all styling (responsive, navy/teal theme)
  script.js      validation engine, roles, audit log, exports, all pages
  assets/
    aicte-logo.jpeg   logo shown on the first page
  README.md
```

## How to run

No build step or server is required.

1. Keep the four files and the `assets` folder together.
2. Double-click `index.html` (or serve the folder with `python -m http.server 8000` and open http://localhost:8000).
3. Internet is only needed for the optional SheetJS library (XLSX import/export). Without it everything works with CSV.

## Demo accounts (synthetic, client-side only)

| Role | Email | Password |
|---|---|---|
| Administrator | admin@demo.edu | Admin@123 |
| Data Entry Staff | staff@demo.edu | Staff@123 |
| Reviewer | reviewer@demo.edu | Review@123 |

Permissions: Administrators can do everything including Settings; Data Entry Staff can upload, edit and export; Reviewers can record review decisions, re-run validation and export.

## Acceptance walkthrough

1. Sign in as `admin@demo.edu`.
2. Open the Dashboard, click **Load synthetic demo dataset** (60 fictional students with deliberate issues).
3. Or go to **Upload Dataset**, download the sample CSV/Excel template, upload it, confirm the column mapping and import.
4. Open **Validation Results**; use the filters and click a finding to open the record.
5. Correct an invalid field (for example the date of birth `31-02-2005` for DEMO014), save, and click **Save & re-run validation**.
6. Open the possible duplicate (DEMO035 vs DEMO034) and record a decision.
7. Watch the issue counts and score update; compare runs in the results banner.
8. **Reports & Exports**: export the corrected dataset and the detailed issue report (CSV or XLSX).
9. **Audit History**: confirm logins, corrections, decisions, validations and exports are listed.

## What is validated

Mandatory fields, date format, identifier pattern (default 12 digits is a demo assumption, configurable), admission-year range, exact duplicate APAAR IDs and references, fuzzy name duplicates (Levenshtein token-sort similarity, suggestions only), academic-year vs admission-year, age at admission (min/max), document status, and pasted document-text comparison. Each finding has record, field, category, severity, explanation, suggested action, rule ID and review status.

A dataset is eligible for a clean export only when no blocking errors remain and all review decisions are made. Otherwise exporting needs an explicit confirmation and the file includes a validation-status column.

## Data-quality score

Weighted average of applicable dimensions (default weights: completeness 30, format 30, consistency 25, review 15). Dimensions that cannot be assessed are excluded rather than counted as passed; if none apply the score shows N/A. It is a data-quality indicator, not an official verification score.

## Security and privacy notes

- All dynamic text is HTML-escaped; exports prefix cells starting with `= + - @` to block spreadsheet formula injection.
- The audit log has no edit/delete controls and never stores passwords or tokens.
- Nothing is sent to any server or AI service. Data is kept in your browser's localStorage; **Settings > Delete dataset / Reset demo** clears it.

## Honest limitations of this version

- This is a browser-only demo built with HTML/CSS/JavaScript. The original specification (React/TypeScript, FastAPI, PostgreSQL, server-side hashed passwords, backend-enforced roles, OCR/PDF extraction, institution isolation) needs a real backend and is not implemented here. Login and role checks are client-side and can be bypassed by anyone with browser access, so never use real student data.
- Document comparison works on text you paste; PDF text extraction and OCR are not available in the browser.
- The free SheetJS build does not apply cell colours or frozen panes in XLSX files.
- No connection to the official APAAR portal exists, and missing APAAR IDs are never generated.
