import httpx
from supabase import create_client, Client, ClientOptions

from app.config import settings

_client: Client | None = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        # Force HTTP/1.1 to avoid WinError 10035 non-blocking socket issues on Windows
        # that occur when httpx/httpcore uses HTTP/2 with the PostgREST sync client.
        _client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
            options=ClientOptions(
                postgrest_client_timeout=30,
                httpx_client=httpx.Client(http2=False),
            ),
        )
    return _client
