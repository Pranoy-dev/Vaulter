"""Supabase Storage operations."""

from __future__ import annotations

from app.db.client import get_supabase

BUCKET = "dataroom-files"


def upload_file(deal_id: str, relative_path: str, content: bytes, content_type: str) -> str:
    """Upload a file to Supabase Storage and return the storage path."""
    storage_path = f"{deal_id}/{relative_path}"
    sb = get_supabase()
    sb.storage.from_(BUCKET).upload(
        path=storage_path,
        file=content,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return storage_path


def get_signed_url(storage_path: str, expires_in: int = 3600) -> str:
    """Get a signed download URL for a stored file."""
    sb = get_supabase()
    result = sb.storage.from_(BUCKET).create_signed_url(storage_path, expires_in)
    return result.get("signedURL") or result.get("signedUrl", "")
