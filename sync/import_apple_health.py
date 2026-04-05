#!/usr/bin/env python3
"""
Import swimming + health data from Apple Health export.zip.

Usage:
    python3 sync/import_apple_health.py [path/to/export.zip]

Defaults to ~/Downloads/export.zip if no path given.
Outputs: data/swims.json, data/health.json, data/swims_data.js, data/health_data.js
Preserves existing Strava-only records in swims.json.
"""

import json
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")

YARDS_TO_METERS = 0.9144


def parse_datetime(s):
    """Parse Apple Health datetime like '2020-11-28 10:24:09 -0400'."""
    # Strip timezone offset, parse naive, then handle offset manually
    # Format: YYYY-MM-DD HH:MM:SS ±HHMM
    parts = s.rsplit(" ", 1)
    dt = datetime.strptime(parts[0], "%Y-%m-%d %H:%M:%S")
    if len(parts) == 2:
        tz = parts[1]
        sign = 1 if tz[0] == "+" else -1
        hours, mins = int(tz[1:3]), int(tz[3:5])
        # Convert to UTC-equivalent local time (keep as-is for local display)
    return dt


def detect_device(source_name):
    """Map source name to device label matching existing data."""
    if "M.T." in source_name:
        return "Apple Watch (old)"
    return "Apple Watch"


def parse_pool_length(meta):
    """Extract pool length in meters from HKLapLength metadata."""
    lap_str = meta.get("HKLapLength", "")
    if not lap_str:
        return None
    # Format: "23 m" or "25 yd"
    parts = lap_str.split()
    if len(parts) != 2:
        return None
    val = float(parts[0])
    if parts[1] == "yd":
        val = round(val * YARDS_TO_METERS, 1)
    return round(val)


def extract_swims(zf):
    """Stream-parse export.xml and extract swimming workouts."""
    swims = []
    in_swim = False
    swim_attrib = {}
    meta = {}
    stats = {}
    lap_count = 0

    with zf.open("apple_health_export/export.xml") as f:
        for event, elem in ET.iterparse(f, events=["start", "end"]):
            if event == "start" and elem.tag == "Workout":
                if elem.attrib.get("workoutActivityType") == "HKWorkoutActivityTypeSwimming":
                    in_swim = True
                    swim_attrib = dict(elem.attrib)
                    meta = {}
                    stats = {}
                    lap_count = 0
                continue

            if not in_swim:
                elem.clear()
                continue

            if event == "end":
                if elem.tag == "MetadataEntry":
                    k = elem.attrib.get("key", "")
                    v = elem.attrib.get("value", "")
                    if k:
                        meta[k] = v
                elif elem.tag == "WorkoutStatistics":
                    t = elem.attrib.get("type", "")
                    if t:
                        stats[t] = dict(elem.attrib)
                elif elem.tag == "WorkoutEvent":
                    if elem.attrib.get("type") == "HKWorkoutEventTypeLap":
                        lap_count += 1
                elif elem.tag == "Workout":
                    in_swim = False
                    swim = build_swim_record(swim_attrib, meta, stats, lap_count)
                    if swim:
                        swims.append(swim)
                    elem.clear()
                    continue

            if not in_swim:
                elem.clear()

    print(f"  Extracted {len(swims)} swimming workouts from Apple Health")
    return swims


def build_swim_record(attrib, meta, stats, lap_count):
    """Build a swim record dict from parsed XML data."""
    dt = parse_datetime(attrib["startDate"])
    duration = float(attrib.get("duration", 0))

    # Distance: from WorkoutStatistics, in yards → convert to meters
    dist_stat = stats.get("HKQuantityTypeIdentifierDistanceSwimming", {})
    distance_raw = float(dist_stat.get("sum", 0))
    dist_unit = dist_stat.get("unit", "yd")
    if dist_unit == "yd":
        distance_m = round(distance_raw * YARDS_TO_METERS, 1)
    else:
        distance_m = round(distance_raw, 1)

    # Pool length
    pool_length_m = parse_pool_length(meta)

    # Open water detection
    swim_location = meta.get("HKSwimmingLocationType", "")
    is_open_water = swim_location == "2"
    if not swim_location and not pool_length_m:
        is_open_water = True

    # Laps: from lap events, or calculate from distance/pool_length
    laps = lap_count
    if laps == 0 and pool_length_m and distance_m > 0:
        laps = round(distance_m / pool_length_m)

    # Pace
    pace = round(duration / (distance_m / 100), 3) if distance_m > 0 else None

    # Calories: active energy burned
    cal_stat = stats.get("HKQuantityTypeIdentifierActiveEnergyBurned", {})
    calories = round(float(cal_stat.get("sum", 0)))

    # ID from unix timestamp of start
    ts = int(dt.timestamp())

    # Weekday
    weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    return {
        "id": f"ah_{ts}",
        "source": "apple_health",
        "device": detect_device(attrib.get("sourceName", "")),
        "date": dt.strftime("%Y-%m-%d"),
        "datetime": dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "year": dt.year,
        "month": dt.month,
        "week": dt.isocalendar()[1],
        "hour": dt.hour,
        "weekday": weekdays[dt.weekday()],
        "weekday_num": dt.weekday(),
        "distance_m": distance_m,
        "duration_min": round(duration, 2),
        "pace_per_100m": pace,
        "laps": laps,
        "pool_length_m": pool_length_m,
        "is_open_water": is_open_water,
        "calories": calories,
    }


def extract_health(zf):
    """Extract HRV, resting HR, and sleep data, aggregated by day."""
    hrv_by_day = defaultdict(list)
    rhr_by_day = defaultdict(list)
    sleep_segments = []  # (date, hours)

    with zf.open("apple_health_export/export.xml") as f:
        for event, elem in ET.iterparse(f, events=["end"]):
            if elem.tag != "Record":
                elem.clear()
                continue

            rtype = elem.attrib.get("type", "")

            if rtype == "HKQuantityTypeIdentifierHeartRateVariabilitySDNN":
                dt = parse_datetime(elem.attrib["startDate"])
                val = float(elem.attrib.get("value", 0))
                hrv_by_day[dt.strftime("%Y-%m-%d")].append(val)

            elif rtype == "HKQuantityTypeIdentifierRestingHeartRate":
                dt = parse_datetime(elem.attrib["startDate"])
                val = float(elem.attrib.get("value", 0))
                rhr_by_day[dt.strftime("%Y-%m-%d")].append(val)

            elif rtype == "HKCategoryTypeIdentifierSleepAnalysis":
                val = elem.attrib.get("value", "")
                source = elem.attrib.get("sourceName", "")
                # Only count actual sleep (not InBed or Awake)
                # Prefer Apple Watch data over AutoSleep when both exist
                asleep_types = {
                    "HKCategoryValueSleepAnalysisAsleepCore",
                    "HKCategoryValueSleepAnalysisAsleepDeep",
                    "HKCategoryValueSleepAnalysisAsleepREM",
                    "HKCategoryValueSleepAnalysisAsleepUnspecified",
                }
                if val in asleep_types and "Apple" in source:
                    start = parse_datetime(elem.attrib["startDate"])
                    end = parse_datetime(elem.attrib["endDate"])
                    hours = (end - start).total_seconds() / 3600
                    # Assign to the date you woke up on
                    sleep_date = end.strftime("%Y-%m-%d")
                    sleep_segments.append((sleep_date, hours))

            elem.clear()

    # Aggregate sleep by day
    sleep_by_day = defaultdict(float)
    for date, hours in sleep_segments:
        sleep_by_day[date] += hours

    # Build daily records
    all_dates = sorted(set(hrv_by_day.keys()) | set(rhr_by_day.keys()))
    health = []
    for date in all_dates:
        hrv_vals = hrv_by_day.get(date, [])
        rhr_vals = rhr_by_day.get(date, [])
        sleep = sleep_by_day.get(date)

        record = {
            "date": date,
            "hrv_ms": round(sum(hrv_vals) / len(hrv_vals), 1) if hrv_vals else None,
            "resting_hr": round(sum(rhr_vals) / len(rhr_vals), 1) if rhr_vals else None,
            "sleep_hrs": round(sleep, 2) if sleep else None,
        }
        health.append(record)

    print(f"  Extracted {len(health)} daily health records")
    print(f"    HRV days: {len(hrv_by_day)}, RHR days: {len(rhr_by_day)}, Sleep days: {len(sleep_by_day)}")
    return health


def merge_with_strava(new_swims, existing_path):
    """Preserve Strava-only records and merge enrichment from Strava onto AH records."""
    if not os.path.exists(existing_path):
        return new_swims

    with open(existing_path) as f:
        existing = json.load(f)

    # Index existing records by id for Strava enrichment
    existing_by_id = {s["id"]: s for s in existing}

    # Collect Strava-only records (not in Apple Health)
    strava_only = [s for s in existing if s["source"] == "strava"]
    strava_ids = {s["id"] for s in strava_only}

    # Enrich new AH records with Strava data (heart rate, strava_id, etc.)
    ah_by_id = {s["id"]: s for s in existing if s["source"] == "apple_health"}
    for swim in new_swims:
        old = ah_by_id.get(swim["id"])
        if old:
            # Copy Strava enrichment fields
            for key in ("strava_id", "strava_file", "avg_hr", "max_hr"):
                if key in old:
                    swim[key] = old[key]

    # Combine: new AH records + Strava-only records
    combined = new_swims + strava_only

    # Sort by datetime
    combined.sort(key=lambda s: s["datetime"])

    print(f"  Preserved {len(strava_only)} Strava-only records")
    return combined


def write_js_bundle(json_path, js_path, var_name):
    """Wrap JSON data in a JS global variable for file:// compatibility."""
    with open(json_path) as f:
        data = f.read()
    with open(js_path, "w") as f:
        f.write(f"window.{var_name} = {data};\n")
    print(f"  Wrote {js_path}")


def main():
    export_path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads/export.zip")

    if not os.path.exists(export_path):
        print(f"Error: {export_path} not found")
        print("Export from iPhone: Health → Profile → Export All Health Data")
        sys.exit(1)

    mod_time = datetime.fromtimestamp(os.path.getmtime(export_path))
    print(f"Importing from: {export_path}")
    print(f"Export date: {mod_time.strftime('%Y-%m-%d %H:%M')}")
    print()

    os.makedirs(DATA_DIR, exist_ok=True)

    with zipfile.ZipFile(export_path) as zf:
        print("Extracting swimming workouts...")
        swims = extract_swims(zf)

        print("Extracting health data (HRV, resting HR, sleep)...")
        health = extract_health(zf)

    # Merge with existing Strava data
    existing_path = os.path.join(DATA_DIR, "swims.json")
    print("Merging with existing Strava data...")
    swims = merge_with_strava(swims, existing_path)

    # Write outputs
    swims_path = os.path.join(DATA_DIR, "swims.json")
    health_path = os.path.join(DATA_DIR, "health.json")

    with open(swims_path, "w") as f:
        json.dump(swims, f, indent=2)
    print(f"\nWrote {len(swims)} swims → {swims_path}")

    with open(health_path, "w") as f:
        json.dump(health, f, indent=2)
    print(f"Wrote {len(health)} health records → {health_path}")

    # Generate JS bundles for file:// compatibility
    write_js_bundle(swims_path, os.path.join(DATA_DIR, "swims_data.js"), "__SWIMS")
    write_js_bundle(health_path, os.path.join(DATA_DIR, "health_data.js"), "__HEALTH")

    # Summary
    dates = sorted(s["date"] for s in swims)
    print(f"\nDate range: {dates[0]} → {dates[-1]}")
    print(f"Sources: {', '.join(sorted(set(s['source'] for s in swims)))}")
    print("Done.")


if __name__ == "__main__":
    main()
