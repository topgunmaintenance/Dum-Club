"""
Supabase client helper.
"""
import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

_client = None


async def init_supabase() -> None:
    global _client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    _client = create_client(url, key)
    print("✅ Supabase connected")


def get_client():
    if _client is None:
        raise RuntimeError("Supabase not initialised — call init_supabase() first.")
    return _client
