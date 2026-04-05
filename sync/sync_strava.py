#!/usr/bin/env python3
"""
Sync swimming activities from Strava API into swims.json.

Setup (one-time):
    1. Create app at https://www.strava.com/settings/api
       - Application Name: Swim Coach
       - Authorization Callback Domain: localhost
    2. Copy Client ID and Client Secret into sync/.env:
         STRAVA_CLIENT_ID=12345
         STRAVA_CLIENT_SECRET=abcdef...
    3. Run:  python3 sync/sync_strava.py --auth
       This opens a browser, you authorize, and it saves the refresh token.

Daily sync:
    python3 sync/sync_strava.py

Token refresh is automatic — no re-auth needed after initial setup.
"""

import json
import os
import sys
import webbrowser
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlencode, urlparse, parse_qs

try:
    import requests
except ImportError:
    print("Error: 'requests' not installed. Run: pip3 install requests")
    sys.exit(1)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
SYNC_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(SYNC_DIR, ".env")

STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize"
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_API = "https://www.strava.com/api/v3"

YARDS_TO_METERS = 0.9144


def load_env():
    """Load key=value pairs from sync/.env."""
    env = {}
    if not os.path.exists(ENV_PATH):
        return env
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def save_env(env):
    """Write env dict back to sync/.env."""
    with open(ENV_PATH, "w") as f:
        for k, v in env.items():
            f.write(f"{k}={v}\n")


def do_auth(env):
    """Interactive OAuth flow: opens browser, catches callback on localhost."""
    client_id = env.get("STRAVA_CLIENT_ID")
    client_secret = env.get("STRAVA_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("Error: STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be in sync/.env")
        print("Create an app at https://www.strava.com/settings/api")
        sys.exit(1)

    # Local server to catch the OAuth callback
    auth_code = [None]

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            qs = parse_qs(urlparse(self.path).query)
            auth_code[0] = qs.get("code", [None])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h2>Authorized! You can close this tab.</h2>")

        def log_message(self, *args):
            pass

    server = HTTPServer(("localhost", 5678), Handler)

    params = urlencode({
        "client_id": client_id,
        "redirect_uri": "http://localhost:5678",
        "response_type": "code",
        "scope": "activity:read_all",
    })
    url = f"{STRAVA_AUTH_URL}?{params}"
    print(f"Opening browser for authorization...")
    webbrowser.open(url)
    print("Waiting for callback on http://localhost:5678 ...")

    server.handle_request()

    if not auth_code[0]:
        print("Error: No authorization code received")
        sys.exit(1)

    # Exchange code for tokens
    resp = requests.post(STRAVA_TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "code": auth_code[0],
        "grant_type": "authorization_code",
    })
    resp.raise_for_status()
    tokens = resp.json()

    env["STRAVA_ACCESS_TOKEN"] = tokens["access_token"]
    env["STRAVA_REFRESH_TOKEN"] = tokens["refresh_token"]
    env["STRAVA_TOKEN_EXPIRES"] = str(tokens["expires_at"])
    save_env(env)

    print(f"Authorized as: {tokens['athlete']['firstname']} {tokens['athlete']['lastname']}")
    print("Tokens saved to sync/.env")
    return env


def refresh_token(env):
    """Refresh access token if expired."""
    expires = int(env.get("STRAVA_TOKEN_EXPIRES", 0))
    if datetime.now().timestamp() < expires - 60:
        return env  # Still valid

    resp = requests.post(STRAVA_TOKEN_URL, data={
        "client_id": env["STRAVA_CLIENT_ID"],
        "client_secret": env["STRAVA_CLIENT_SECRET"],
        "refresh_token": env["STRAVA_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    })
    resp.raise_for_status()
    tokens = resp.json()

    env["STRAVA_ACCESS_TOKEN"] = tokens["access_token"]
    env["STRAVA_REFRESH_TOKEN"] = tokens["refresh_token"]
    env["STRAVA_TOKEN_EXPIRES"] = str(tokens["expires_at"])
    save_env(env)
    return env


def fetch_swim_activities(env, after_ts=0):
    """Fetch all swim activities from Strava after a given timestamp."""
    env = refresh_token(env)
    headers = {"Authorization": f"Bearer {env['STRAVA_ACCESS_TOKEN']}"}

    all_activities = []
    page = 1
    while True:
        resp = requests.get(f"{STRAVA_API}/athlete/activities", headers=headers, params={
            "after": int(after_ts),
            "per_page": 100,
            "page": page,
        })
        resp.raise_for_status()
        activities = resp.json()
        if not activities:
            break

        swims = [a for a in activities if a["type"] == "Swim"]
        all_activities.extend(swims)
        page += 1

    return all_activities


def activity_to_swim(activity):
    """Convert a Strava activity to our swim record format."""
    dt = datetime.strptime(activity["start_date_local"], "%Y-%m-%dT%H:%M:%SZ")
    distance_m = round(activity.get("distance", 0), 1)
    duration_min = round(activity.get("elapsed_time", 0) / 60, 2)
    pace = round(duration_min / (distance_m / 100), 3) if distance_m > 0 else None

    # Pool length: Strava stores in meters for pool swims
    pool_length = None
    is_open_water = True
    if activity.get("type") == "Swim":
        # Strava swim_type: 0 = default, 1 = open water
        # Pool length only available in detailed activity
        pass

    weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    swim = {
        "id": f"strava_{activity['id']}",
        "source": "strava",
        "device": "Strava",
        "date": dt.strftime("%Y-%m-%d"),
        "datetime": dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "year": dt.year,
        "month": dt.month,
        "week": dt.isocalendar()[1],
        "hour": dt.hour,
        "weekday": weekdays[dt.weekday()],
        "weekday_num": dt.weekday(),
        "distance_m": distance_m,
        "duration_min": duration_min,
        "pace_per_100m": pace,
        "laps": None,
        "pool_length_m": pool_length,
        "is_open_water": is_open_water,
        "calories": round(activity.get("calories", 0)),
        "strava_id": str(activity["id"]),
    }

    if activity.get("average_heartrate"):
        swim["avg_hr"] = round(activity["average_heartrate"], 1)
    if activity.get("max_heartrate"):
        swim["max_hr"] = round(activity["max_heartrate"], 1)

    return swim


def enrich_ah_records(swims, strava_swims):
    """Match Strava swims to Apple Health records by date+distance and add HR data."""
    strava_by_date = {}
    for s in strava_swims:
        strava_by_date.setdefault(s["date"], []).append(s)

    enriched = 0
    for swim in swims:
        if swim["source"] != "apple_health" or "strava_id" in swim:
            continue
        candidates = strava_by_date.get(swim["date"], [])
        for c in candidates:
            # Match if distance within 5% or 50m
            if swim["distance_m"] > 0 and c["distance_m"] > 0:
                diff = abs(swim["distance_m"] - c["distance_m"])
                if diff < 50 or diff / swim["distance_m"] < 0.05:
                    swim["strava_id"] = c["strava_id"]
                    if "avg_hr" in c:
                        swim["avg_hr"] = c["avg_hr"]
                    if "max_hr" in c:
                        swim["max_hr"] = c["max_hr"]
                    enriched += 1
                    break
    return enriched


def main():
    env = load_env()

    if "--auth" in sys.argv:
        env = do_auth(env)
        print()

    # Verify we have tokens
    if not env.get("STRAVA_REFRESH_TOKEN"):
        print("Not authenticated. Run: python3 sync/sync_strava.py --auth")
        sys.exit(1)

    # Load existing swims
    swims_path = os.path.join(DATA_DIR, "swims.json")
    if os.path.exists(swims_path):
        with open(swims_path) as f:
            swims = json.load(f)
    else:
        swims = []

    # Find most recent Strava activity to sync after
    existing_strava_ids = {s.get("strava_id") for s in swims if s.get("strava_id")}
    dates = sorted(s["date"] for s in swims) if swims else []
    if dates:
        # Sync from 7 days before last known date (overlap for safety)
        last = datetime.strptime(dates[-1], "%Y-%m-%d")
        after_ts = (last.timestamp()) - (7 * 86400)
    else:
        after_ts = 0

    print(f"Fetching swim activities from Strava (after {datetime.fromtimestamp(after_ts).strftime('%Y-%m-%d')})...")
    activities = fetch_swim_activities(env, after_ts)
    print(f"  Found {len(activities)} swim activities")

    # Convert to swim records
    new_strava = [activity_to_swim(a) for a in activities]

    # Enrich Apple Health records with Strava HR data
    enriched = enrich_ah_records(swims, new_strava)
    print(f"  Enriched {enriched} Apple Health records with Strava HR data")

    # Add truly new Strava-only records (not already in dataset)
    added = 0
    for s in new_strava:
        if s["strava_id"] not in existing_strava_ids:
            # Check it wasn't matched to an AH record
            matched = any(
                swim.get("strava_id") == s["strava_id"]
                for swim in swims
            )
            if not matched:
                swims.append(s)
                added += 1

    swims.sort(key=lambda s: s["datetime"])

    print(f"  Added {added} new Strava-only records")

    # Write
    with open(swims_path, "w") as f:
        json.dump(swims, f, indent=2)
    print(f"\nWrote {len(swims)} swims → {swims_path}")

    # Regenerate JS bundle
    js_path = os.path.join(DATA_DIR, "swims_data.js")
    with open(swims_path) as f:
        data = f.read()
    with open(js_path, "w") as f:
        f.write(f"window.__SWIMS = {data};\n")
    print(f"Wrote {js_path}")

    print("Done.")


if __name__ == "__main__":
    main()
