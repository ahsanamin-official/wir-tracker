# WIR — Weekly Inspection Report Management System

A complete Project Progress / Weekly Inspection Report application for the
**Resident Supervision of Construction of Gates & Boundary Wall of Punjab
Government Servants Housing Scheme at Jhang** project, built to reproduce
the exact structure of the sample **WIR-09-JH** and **WIR-10-JH** reports.

The generated Word/PDF report always contains exactly these 9 sections —
nothing more:

1. Client Details
2. Introduction (2.1 Project Background, 2.2 Objective and Scope)
3. Material Quality Assurance & Field Verification (3.1–3.3)
4. Pre-Consultancy Mobilization Baseline Record
5. Weekly Progress Work
6. Weekly Progress Work Highlights
7. Cumulative Project History Work Flow (1 Panel = 36'-0")
8. Weekly Progress Breakdown by Structural Levels
9. Executive Summary & Engineering Conclusion

No dashboards, manpower sections, issue registers, S-curves, or other
sections are ever added to the exported document, even though the app's
own UI has extra pages for convenient data entry.

---

## 1. Files created

```
wir-app/
├── frontend/
│   ├── index.html
│   ├── css/style.css              # light glassmorphism theme
│   └── js/
│       ├── storage.js             # IndexedDB (localStorage fallback) + master/baseline defaults
│       ├── api.js                 # local API client, offline-aware
│       ├── calculations.js        # CFT / SFT / panel-length auto quantity math
│       ├── validation.js          # form validation rules
│       ├── ui.js                  # toasts, modals, DOM helpers
│       ├── reports.js             # compiles the 9 report sections from stored data
│       └── app.js                 # router + all page renderers
├── backend/
│   ├── app.py                     # Flask API (JSON-file storage + report generation)
│   ├── requirements.txt
│   ├── models/ routes/ services/  # reserved extension points (see .gitkeep notes)
│   ├── data/                      # created at runtime — JSON "database" files
│   ├── output/                    # created at runtime — generated .docx/.pdf files
│   └── report_generator/
│       ├── docx_generator.py      # python-docx builder for the 9-section report
│       └── pdf_generator.py       # converts the generated docx to PDF via LibreOffice
└── README.md
```

## 2. Running the frontend

The frontend is a static site — no build step required.

```bash
cd frontend
python3 -m http.server 8080
# open http://localhost:8080 in your browser
```

It works fully **offline**: all master data, baseline figures, weekly
reports, daily progress, materials, and photos are stored locally in
**IndexedDB** (falls back to `localStorage` automatically if IndexedDB is
unavailable). The sidebar shows **"API Connected"** or **"Offline / Local
Demo Mode"** depending on whether the backend below is running. You never
lose data because the local API is offline — only Word/PDF *generation*
requires the backend.

## 3. Running the local API (required for Word/PDF export)

```bash
cd backend
python3 -m venv venv && source venv/bin/activate      # optional but recommended
pip install -r requirements.txt
python app.py
# API listens on http://localhost:5000
```

The frontend's `API_BASE_URL` (in `frontend/js/api.js`) already points to
`http://localhost:5000/api` — no configuration needed if you run both on
the same machine.

**LibreOffice is required for PDF export** (the backend shells out to
`soffice --headless --convert-to pdf`). Install it with:

- Ubuntu/Debian: `sudo apt install libreoffice`
- macOS: `brew install --cask libreoffice`
- Windows: install LibreOffice and ensure `soffice.exe` is on PATH

DOCX export does **not** require LibreOffice — only PDF export does.

## 4. Generating Word / PDF reports

1. Go to **New Weekly Report**, fill in the reporting week fields (project
   fields auto-populate from **Project Setup**).
2. Go to **Daily Progress Entry** and add one record per site day, with its
   structural activities (dimensions auto-calculate CFT/SFT/panel length).
3. Go to **Materials & QA/QC** to log the weekly material inspection.
4. Go to **Site Photos** to attach and caption site images.
5. Go to **Report Preview** to see the exact 9-section layout before export.
6. Click **Export Word** or **Export PDF** — the frontend sends the fully
   compiled payload (built by `reports.js`) to the backend, which lays it
   directly into the Word document using `python-docx`. The backend never
   invents content; it only formats what was entered.

## 5. Where data is stored

- **Frontend (source of truth for the UI):** browser IndexedDB, database
  `WIR_DB`, object stores `masterData`, `reports`, `dailyProgress`,
  `materials`, `photos`. Falls back to `localStorage` under `WIR_*` keys if
  IndexedDB is not available (e.g. private browsing in some browsers).
- **Backend (used for report generation / optional shared store):** flat
  JSON files under `backend/data/` (`project.json`, `reports.json`,
  `daily_progress.json`, `materials.json`, `photos.json`). Generated
  Word/PDF files are written to `backend/output/`.

## 6. Offline mode

If the backend is not running or unreachable, the app automatically
switches to **Offline / Local Demo Mode**:

- All data entry, calculations, cumulative tracking, and the live Report
  Preview continue to work fully from IndexedDB.
- Only **Export Word** / **Export PDF** require the backend to be running,
  since document generation happens server-side with `python-docx`. If you
  try to export while offline, the app tells you to start the backend
  rather than failing silently.

## 7. Backup / restore

**Settings → Backup / Restore** exports every stored record (master data,
baseline, reports, daily progress, materials, photo metadata + image data)
to a single JSON file, and can re-import it. Import is additive/merge by
default so historical reports are never lost.

## 8. Duplicating a weekly report

**Report History → Duplicate** copies a prior report's project context
into a new report with an incremented report number, preserving baseline
and historical cumulative records intact while letting you set new dates
and daily entries for the current week.

## 9. No-fabrication guarantee

Every figure in the generated report originates from one of:
master project data, baseline data, user-entered weekly/daily records,
user-entered material inspection notes, or uploaded photographs. If a
value was never entered, the corresponding cell/line is left blank or
shown as "—" — nothing is invented, including quantities, lab test
results, approvals, or weather.

## 10. Known limitations

- The backend's JSON-file storage is intended for single-user local use,
  not concurrent multi-user editing; there is no locking.
- PDF export depends on a local LibreOffice install; if unavailable, use
  Word export and print/save as PDF from Word instead.
- Photo files are stored as base64 data URLs (both in IndexedDB and in the
  backend JSON files); very large photo libraries will grow the browser
  storage and JSON file sizes accordingly.
- The "Weekly Progress Breakdown by Structural Levels" cumulative column
  aggregates all activities entered to date by structural element and
  category; it does not attempt unit-conversion between different unit
  types (e.g. mixing CFT and SFT for the same row will sum face values
  as entered — keep units consistent per activity category as in the
  sample reports).
- Report generation is synchronous; PDF conversion can take a few seconds
  per report depending on LibreOffice startup time.
