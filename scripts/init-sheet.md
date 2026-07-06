# Sheet setup

One Google Sheet, one tab.

## 1. Create the Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → create a new blank spreadsheet.
2. Rename it something like `personal-secretary-log`.
3. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit` → this goes in `.env` as `SHEET_ID`.

## 2. Create the `log` tab

Rename the default first tab to exactly `log`, then set row 1 headers:

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| timestamp_iso | chat_id | chat_name | sender | text | raw_date_unix |

## 3. Share with the service account

1. Create the service account first (see main README).
2. Click **Share** on the Sheet → paste the service account's email
   (looks like `something@your-project.iam.gserviceaccount.com`) → give it **Editor** access.

Without this share, every Sheets API call from the webhook will fail with a 403.
