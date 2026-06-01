"""
Supabase client helper.

get_client() is intentionally lazy: the first caller (whether the FastAPI
lifespan via init_supabase() or a standalone cron worker) initialises the
connection. Subsequent calls return the cached client.

This lets standalone cron workers (live_reminders, schedule_rollforward,
trial_reminders, merchant_recap) call get_client() directly without a
FastAPI lifespan.
"""
import os
from supabase import create_client
from dotenv import load_dotenv

_client = None


async def init_supabase() -> None:
    """Called by the FastAPI lifespan. Also safe to call from tests."""
    global _client
    load_dotenv()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    _client = create_client(url, key)
    print("✅ Supabase connected")


def get_client():
    """Return the shared Supabase client, initialising lazily on first call.

    Lazy init lets standalone cron workers (no FastAPI lifespan) use the DB
    without any extra setup — they just need SUPABASE_URL and
    SUPABASE_SERVICE_KEY in the environment.
    """
    global _client
    if _client is None:
        load_dotenv()
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_KEY"]
        _client = create_client(url, key)
    return _client
