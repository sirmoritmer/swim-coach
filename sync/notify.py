"""
notify.py — reusable Telegram notification utility

Usage from any script:
    from notify import notify
    notify("🏊 Your message here")

Setup (one-time):
    1. Message @BotFather on Telegram → /newbot → get BOT_TOKEN
    2. Message your new bot once (any text)
    3. Run: python notify.py --setup   (prints your CHAT_ID)
    4. Add to sync/.env:
           TELEGRAM_BOT_TOKEN=your_token
           TELEGRAM_CHAT_ID=your_chat_id

Can also be used standalone:
    python notify.py "Hello from swim coach"
"""

import os
import sys
import json
import urllib.request
import urllib.parse
from pathlib import Path


def _load_env():
    """Load .env from sync/ directory relative to this file."""
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    os.environ.setdefault(key.strip(), val.strip())


def notify(message: str, parse_mode: str = "HTML") -> bool:
    """
    Send a Telegram message. Returns True on success, False on failure.

    Args:
        message:    Text to send. Supports HTML tags if parse_mode="HTML"
                    e.g. "<b>bold</b>", "<i>italic</i>", "<code>mono</code>"
        parse_mode: "HTML" (default) or "Markdown"
    """
    _load_env()

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        print("❌ notify.py: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in sync/.env", file=sys.stderr)
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({
        "chat_id": chat_id,
        "text": message,
        "parse_mode": parse_mode,
    }).encode()

    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            if result.get("ok"):
                return True
            else:
                print(f"❌ Telegram error: {result}", file=sys.stderr)
                return False
    except Exception as e:
        print(f"❌ notify.py exception: {e}", file=sys.stderr)
        return False


def _setup():
    """Print CHAT_ID by reading recent updates from the bot."""
    _load_env()
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("Set TELEGRAM_BOT_TOKEN in sync/.env first.")
        return

    url = f"https://api.telegram.org/bot{token}/getUpdates"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            updates = data.get("result", [])
            if not updates:
                print("No messages found. Send any message to your bot on Telegram first, then re-run.")
                return
            for u in updates:
                msg = u.get("message", {})
                chat = msg.get("chat", {})
                print(f"CHAT_ID: {chat.get('id')}  (from: {chat.get('first_name', '')} {chat.get('username', '')})")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--setup":
        _setup()
    elif len(sys.argv) >= 2:
        msg = " ".join(sys.argv[1:])
        ok = notify(msg)
        sys.exit(0 if ok else 1)
    else:
        print(__doc__)
