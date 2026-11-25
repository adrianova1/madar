import hmac
import hashlib
import os
from urllib.parse import parse_qsl
from flask import Flask, jsonify, request
import requests

app = Flask(__name__)

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
APP_URL = os.environ.get("APP_URL", "https://madar.example.com").rstrip("/")


def verify_telegram_init_data(init_data: str, bot_token: str) -> bool:
    if not init_data or not bot_token:
        return False
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        return False
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    computed = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, received_hash)


def send_tg_message(chat_id: int, text: str, reply_markup: dict | None = None) -> None:
    if not BOT_TOKEN:
        return
    payload = {"chat_id": chat_id, "text": text}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    requests.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        json=payload,
        timeout=8,
    )


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "MADAR cPanel Python 3.11 Passenger Bridge"})


@app.post("/telegram/webhook")
def telegram_webhook():
    if WEBHOOK_SECRET:
        header_secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if not hmac.compare_digest(header_secret, WEBHOOK_SECRET):
            return jsonify({"error": "forbidden"}), 401

    update = request.get_json(silent=True) or {}
    msg = update.get("message") or {}
    text = (msg.get("text") or "").strip()
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")

    if chat_id and chat.get("type") == "private" and text.startswith("/start"):
        keyboard = {
            "inline_keyboard": [
                [{"text": "🚀 ورود به جهان مدار", "web_app": {"url": APP_URL}}],
                [
                    {"text": "👤 پروفایل من", "web_app": {"url": f"{APP_URL}?tab=profile"}},
                    {"text": "💫 ستاره‌های من", "web_app": {"url": f"{APP_URL}?tab=shop"}},
                ],
                [
                    {"text": "🎮 بازی‌ها", "web_app": {"url": f"{APP_URL}?tab=games"}},
                    {"text": "💌 نجوا", "web_app": {"url": f"{APP_URL}?tab=whisper"}},
                ],
            ]
        }
        send_tg_message(
            chat_id,
            "سلام! به مدار خوش آمدی.\nاینجا جهانی از آدم‌ها، بازی‌ها و ارتباطات منتظر توست.",
            keyboard,
        )

    return jsonify({"ok": True})
