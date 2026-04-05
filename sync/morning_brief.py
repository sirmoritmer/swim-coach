"""
morning_brief.py — Daily swim coach notification

Reads data/swims.json and data/health.json, generates a morning readiness
brief, and sends it via Telegram using notify.py.

Usage:
    python sync/morning_brief.py

Requires sync/.env with:
    TELEGRAM_BOT_TOKEN=...
    TELEGRAM_CHAT_ID=...

Run from the swim-coach project root or via cron/Cowork scheduler.
"""

import json
import sys
import statistics
from datetime import date, datetime, timedelta
from pathlib import Path

# Allow running from project root or from sync/
BASE = Path(__file__).parent.parent
sys.path.insert(0, str(Path(__file__).parent))

from notify import notify


# ── Data loading ─────────────────────────────────────────────────────────────

def load_json(rel_path):
    p = BASE / rel_path
    if not p.exists():
        return []
    with open(p) as f:
        return json.load(f)


# ── Helpers ───────────────────────────────────────────────────────────────────

def pace_str(pace_per_100m):
    """Convert decimal pace to mm:ss string."""
    total_sec = pace_per_100m * 60
    m, s = divmod(int(total_sec), 60)
    return f"{m}:{s:02d}"


def monday_of_week(d: date) -> date:
    return d - timedelta(days=(d.weekday()))  # weekday(): Mon=0


def swims_between(swims, start: date, end: date):
    return [s for s in swims if start.isoformat() <= s["date"] <= end.isoformat()]


def median(vals):
    if not vals:
        return None
    return statistics.median(vals)


# ── Brief sections ────────────────────────────────────────────────────────────

def readiness_block(health):
    """HRV / resting HR / sleep for today or most recent record."""
    today = date.today().isoformat()
    # Find today's or most recent record
    rec = next((h for h in reversed(health) if h["date"] <= today), None)
    if not rec:
        return None, "No health data available."

    lines = []
    hrv = rec.get("hrv_ms")
    rhr = rec.get("resting_hr")
    sleep = rec.get("sleep_hrs")

    # HRV context (avg from data: 43.8 ms)
    HRV_AVG = 43.8
    if hrv:
        delta = hrv - HRV_AVG
        if hrv >= 60:
            tag = "🟢"
            tip = f"HRV {hrv:.0f}ms — well above avg. You tend to swim ~4% faster on days like this."
        elif hrv >= HRV_AVG:
            tag = "🟡"
            tip = f"HRV {hrv:.0f}ms — slightly above avg. Good day to push."
        else:
            tag = "🔴"
            tip = f"HRV {hrv:.0f}ms — below avg. Consider an easier session."
        lines.append(f"{tag} <b>HRV:</b> {hrv:.0f} ms ({delta:+.0f} vs avg)")
        readiness_tip = tip
    else:
        readiness_tip = None

    if rhr:
        RHR_AVG = 59
        rhr_delta = rhr - RHR_AVG
        rhr_tag = "🟢" if rhr < RHR_AVG else ("🟡" if rhr <= RHR_AVG + 5 else "🔴")
        lines.append(f"{rhr_tag} <b>Resting HR:</b> {rhr:.0f} bpm ({rhr_delta:+.0f} vs avg)")

    if sleep:
        sleep_tag = "🟢" if sleep >= 7 else ("🟡" if sleep >= 6 else "🔴")
        lines.append(f"{sleep_tag} <b>Sleep:</b> {sleep:.1f}h")

    return readiness_tip, "\n".join(lines)


def this_week_block(swims):
    today = date.today()
    week_start = monday_of_week(today)
    week_swims = swims_between(swims, week_start, today)

    total_m = sum(s["distance_m"] for s in week_swims)
    total_yd = round(total_m * 1.09361)
    paces = [s["pace_per_100m"] for s in week_swims if s.get("pace_per_100m")]
    med_pace = median(paces)

    # Same week last year
    ly_start = week_start.replace(year=week_start.year - 1)
    ly_end = today.replace(year=today.year - 1)
    ly_swims = swims_between(swims, ly_start, ly_end)
    ly_yd = round(sum(s["distance_m"] for s in ly_swims) * 1.09361)

    lines = [f"<b>This week</b> (Mon–today)"]
    lines.append(f"  {len(week_swims)} swim{'s' if len(week_swims) != 1 else ''} · {total_yd:,} yd")
    if med_pace:
        lines.append(f"  Avg pace: {pace_str(med_pace)}/100yd")
    if ly_yd > 0:
        diff = total_yd - ly_yd
        arrow = "↑" if diff >= 0 else "↓"
        sign = "+" if diff >= 0 else ""
        lines.append(f"  vs same week LY: {sign}{diff:,} yd {arrow}")

    return "\n".join(lines)


def last_swim_block(swims):
    if not swims:
        return "No swims recorded yet."
    last = swims[-1]
    d = datetime.strptime(last["date"], "%Y-%m-%d")
    days_ago = (date.today() - d.date()).days
    when = "today" if days_ago == 0 else ("yesterday" if days_ago == 1 else f"{days_ago}d ago")
    dist_yd = round(last["distance_m"] * 1.09361)
    pace = pace_str(last["pace_per_100m"]) if last.get("pace_per_100m") else "—"
    dur = f"{last['duration_min']:.0f} min"
    return f"<b>Last swim:</b> {when} · {dist_yd:,} yd · {pace}/100yd · {dur}"


def weekly_streak_block(swims):
    """Count consecutive weeks (Mon–Sun) with at least one swim."""
    weeks_with_swims = set()
    for s in swims:
        d = date.fromisoformat(s["date"])
        weeks_with_swims.add(monday_of_week(d).isoformat())

    today = date.today()
    streak = 0
    current = monday_of_week(today)
    # If current week has no swims yet, start checking from last week
    if current.isoformat() not in weeks_with_swims:
        current -= timedelta(weeks=1)
    while current.isoformat() in weeks_with_swims:
        streak += 1
        current -= timedelta(weeks=1)

    if streak == 0:
        return None
    return f"🔥 <b>{streak}-week streak</b>"


# ── Main ──────────────────────────────────────────────────────────────────────

def build_brief(swims, health):
    today = date.today().strftime("%A, %b %-d")
    parts = [f"🏊 <b>Swim Coach · {today}</b>\n"]

    # Readiness
    tip, readiness = readiness_block(health)
    if readiness:
        parts.append(readiness)

    parts.append("")  # blank line

    # This week
    parts.append(this_week_block(swims))

    parts.append("")

    # Last swim
    parts.append(last_swim_block(swims))

    # Streak
    streak = weekly_streak_block(swims)
    if streak:
        parts.append(streak)

    # Coach tip
    if tip:
        parts.append(f"\n💡 {tip}")

    return "\n".join(parts)


def main():
    swims = load_json("data/swims.json")
    health = load_json("data/health.json")

    if not swims:
        notify("🏊 Swim Coach: could not load swims.json")
        return

    message = build_brief(swims, health)
    ok = notify(message)
    if ok:
        print("✅ Morning brief sent.")
    else:
        print("❌ Failed to send brief.")
        sys.exit(1)


if __name__ == "__main__":
    main()
