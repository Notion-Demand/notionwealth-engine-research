"""
Supabase client factory.

Two clients are exposed:
- `supabase_admin` — uses the service_role key; bypasses RLS; for server-side
  writes where user_id is already validated by JWT auth.
- `get_anon_client()` — anon key, respects RLS; use when you want Supabase to
  enforce row-level policies automatically.
"""

import os
from functools import lru_cache

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

_SUPABASE_URL = os.environ["SUPABASE_URL"]
_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


@lru_cache(maxsize=1)
def get_admin_client() -> Client:
    """Service-role client (bypasses RLS). Cache-once per process."""
    return create_client(_SUPABASE_URL, _SERVICE_KEY)


# Convenience alias used throughout api/ modules
supabase_admin: Client = get_admin_client()
