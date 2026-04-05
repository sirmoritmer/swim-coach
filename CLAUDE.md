# Swim Coach

Personal swim intelligence dashboard for Marcin Durlak.
Static HTML/JS app. Data is pre-generated JSON — no backend, no build tools.

## Current Status

**Data is ready. Start building index.html.**

Data files live at `data/` (relative to project root). All pre-generated from Apple Health export on 2026-03-28.

## Data Files

```
data/
├── swims.json          ← 1,850 swims, Dec 14 2017 – Mar 27 2026
├── health.json         ← 2,744 daily records: HRV, resting HR, sleep (May 2018 – Mar 2026)
└── swimcom_yearly.json ← swim.com yearly totals: 2016=21.83km, 2017=158.74km (pending individual import)
```

### swims.json schema
Each record:
```json
{
  "id": "ah_1513305610",
  "source": "apple_health",
  "device": "Apple Watch",
  "date": "2017-12-14",
  "datetime": "2017-12-14T21:40:10",
  "year": 2017, "month": 12, "week": 50,
  "hour": 21, "weekday": "Thursday", "weekday_num": 3,
  "distance_m": 914.4,
  "duration_min": 20.62,
  "pace_per_100m": 2.256,
  "laps": 40,
  "pool_length_m": 23,
  "is_open_water": false,
  "calories": 0
}
```

### health.json schema
Each record:
```json
{
  "date": "2026-03-28",
  "hrv_ms": 63.4,
  "resting_hr": 62.0,
  "sleep_hrs": 6.29
}
```
Note: `hrv_ms` and `resting_hr` available since May 2018. `sleep_hrs` only since Oct 2024.

## Data Sources & Coverage

| Source | Period | Records | Distance |
|--------|--------|---------|----------|
| Apple Watch (old, "M.T.") | Dec 2017 – Mar 2020 | ~720 swims | ~520 km |
| Apple Watch (Marcin's) | Jun 2020 – Mar 2026 | ~1,130 swims | ~1,670 km |
| swim.com (aggregate only) | 2016–2017 | yearly totals | 180 km |
| Strava live sync | pending setup | — | — |

Gap: Nov 2016 – Dec 13 2017 — individual swims not yet imported.
Strava archive: requested 2026-03-28, email to sirmortimer@gmail.com (will contain Jul 2020–present with GPS + heart rate).

## Athlete Profile

- **Strava ID**: 53367053 | **swim.com**: sirmortimer (ID: 265562)
- **Primary pool**: 25-yard (23m) — LA Fitness Yonkers
- **Avg pace**: 2.14 min/100m overall | **2026 YTD**: 2.08 min/100m (best year)
- **Peak time**: 9–11am | **Peak day**: Friday
- **Open water**: 124 swims (6.7% of total)
- **Longest swim**: 5,258m @ 1.92 min/100m (Jan 7, 2026)
- **HRV avg**: 43.8ms | **Resting HR avg**: 59 bpm | **Sleep avg**: 6.1h

## Pace by Year

| Year | Pace (min/100m) | Avg session | Total km |
|------|-----------------|-------------|----------|
| 2017 | 1.99 | 914m | 11 km |
| 2018 | 1.97 | 918m | 190 km |
| 2019 | 2.11 | 938m | 226 km |
| 2020 | 2.10 | 1,319m | 162 km |
| 2021 | 2.11 | 1,482m | 295 km |
| 2022 | 2.18 | 1,731m | 299 km |
| 2023 | 2.19 | 1,923m | 317 km |
| 2024 | 2.14 | 2,519m | 232 km |
| 2025 | 2.15 | 2,589m | 321 km |
| 2026 | **2.08** | **2,687m** | 97 km |

Sessions are getting longer AND faster — important nuance for the app.

## Recovery Correlations (surface in dashboard)

| Metric | Signal | r | n |
|--------|--------|---|---|
| HRV ≥60ms vs <30ms | 0.085 min/100m faster when recovered | -0.09 | 1,247 |
| Resting HR low (43-52) vs high (63+) | 0.062 min/100m faster | +0.11 | 1,247 |
| Sleep >7h vs <6h | 0.068 min/100m faster | -0.11 | 156 |
| Morning (6-11am) vs Evening (3-8pm) | 0.036 min/100m faster | — | — |

Coach card language: "HRV is 63ms — above your average. You tend to swim 4% faster on days like this."

## Architecture

Static-first. No npm, no build tools, no webpack. Must open as `index.html` with no server.

```
swim-coach/
├── CLAUDE.md
├── index.html          ← dashboard
├── trends.html         ← pace + volume trends
├── map.html            ← swim location map
├── pools.html          ← pool finder
├── css/style.css
├── js/
│   ├── app.js          ← shared: data loading, utils, date helpers
│   ├── dashboard.js
│   ├── trends.js
│   ├── map.js
│   └── pools.js
├── data/               ← pre-generated JSON (gitignored — personal health data)
│   ├── swims.json
│   ├── health.json
│   └── swimcom_yearly.json
├── sync/               ← Python scripts to regenerate data/
│   ├── import_apple_health.py
│   ├── sync_strava.py
│   └── .env            ← STRAVA_CLIENT_ID, SECRET, TOKEN (never commit)
└── pwa/
    ├── manifest.json
    └── sw.js
```

## Tech Stack

- HTML + vanilla JS
- Chart.js (CDN) — charts
- Leaflet.js (CDN) — maps
- Python 3 + requests — sync scripts only
- Hosting: Netlify / GitHub Pages / cPanel — zero config

## Build Order

1. ✅ ~~`data/swims.json` + `data/health.json`~~ — done
2. **`index.html`** — dashboard: this week stats, readiness card, last 5 swims
3. **`trends.html`** — weekly volume chart, pace trend, time-of-day heatmap
4. **`sync/sync_strava.py`** — Strava OAuth + incremental sync into swims.json
5. **`map.html`** — swim location pins (Leaflet)
6. **`pools.html`** — nearby pool finder (Overpass API + geolocation)
7. **PWA** — manifest.json + sw.js for iPhone home screen

## Sync Scripts (to write)

### sync/import_apple_health.py
- Input: path to Apple Health `export.xml`
- Output: `data/swims.json` + `data/health.json`
- Already run once — re-run when new Apple Health export available

### sync/sync_strava.py
- Reads `sync/.env` for token
- Calls Strava API `/athlete/activities?after=TIMESTAMP&per_page=100`
- Filters `type == "Swim"`
- Merges into `data/swims.json` (dedup by date+distance ±5m)
- OAuth callback needs Flask + ngrok for initial auth only

## Constraints

- No npm, no webpack, no build step
- All libraries via CDN
- `data/` is gitignored (personal health data)
- `sync/.env` is gitignored (credentials)
- `index.html` must work when opened directly from Finder (file://)
