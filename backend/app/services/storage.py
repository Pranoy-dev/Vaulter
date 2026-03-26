"""Supabase Storage operations + chunked-upload temp-file management."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone

from app.config import settings
from app.db.client import get_supabase

BUCKET = "dataroom-files"


# ── Temp directory helper ────────────────────────────────────────────────────

def _temp_root() -> str:
    root = settings.upload_temp_dir or os.path.join(tempfile.gettempdir(), "vaulter_uploads")
    os.makedirs(root, exist_ok=True)
    return root


# ── Date-prefixed storage path ───────────────────────────────────────────────

def get_storage_prefix(deal_id: str) -> str:
    """Return ``YYYY/MM/deal_id`` based on current UTC date."""
    now = datetime.now(timezone.utc)
    return f"{now.year}/{now.month:02d}/{deal_id}"


# ── Supabase Storage operations ──────────────────────────────────────────────

def upload_file(deal_id: str, relative_path: str, content: bytes, content_type: str) -> str:
    """Upload a file to Supabase Storage and return the storage path."""
    prefix = get_storage_prefix(deal_id)
    storage_path = f"{prefix}/{relative_path}"
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


# ── Chunk helpers ────────────────────────────────────────────────────────────

def _chunk_dir(deal_id: str, session_id: str, relative_path: str) -> str:
    """Directory that holds the individual chunks for one file."""
    path_hash = hashlib.sha256(relative_path.encode()).hexdigest()[:16]
    return os.path.join(_temp_root(), deal_id, session_id, path_hash)


def save_chunk(
    deal_id: str,
    session_id: str,
    relative_path: str,
    chunk_index: int,
    data: bytes,
    total_chunks: int,
    file_size: int,
) -> int:
    """Persist one chunk to disk.  Returns the count of chunks received so far."""
    cdir = _chunk_dir(deal_id, session_id, relative_path)
    os.makedirs(cdir, exist_ok=True)

    # Write chunk data
    with open(os.path.join(cdir, f"chunk_{chunk_index:06d}"), "wb") as fh:
        fh.write(data)

    # Write / overwrite lightweight metadata
    meta = {"relative_path": relative_path, "total_chunks": total_chunks, "file_size": file_size}
    with open(os.path.join(cdir, "meta.json"), "w") as fh:
        json.dump(meta, fh)

    return sum(1 for f in os.listdir(cdir) if f.startswith("chunk_"))


def get_uploaded_chunks(deal_id: str, session_id: str, relative_path: str) -> list[int]:
    """Return sorted list of chunk indices already saved for a file."""
    cdir = _chunk_dir(deal_id, session_id, relative_path)
    if not os.path.isdir(cdir):
        return []
    return sorted(
        int(f.split("_")[1])
        for f in os.listdir(cdir)
        if f.startswith("chunk_")
    )


def assemble_file(deal_id: str, session_id: str, relative_path: str) -> tuple[bytes, int]:
    """Concatenate all chunks into a single byte string. Returns (content, size)."""
    cdir = _chunk_dir(deal_id, session_id, relative_path)
    with open(os.path.join(cdir, "meta.json")) as fh:
        total_chunks: int = json.load(fh)["total_chunks"]

    parts: list[bytes] = []
    for i in range(total_chunks):
        with open(os.path.join(cdir, f"chunk_{i:06d}"), "rb") as fh:
            parts.append(fh.read())

    content = b"".join(parts)
    return content, len(content)


def get_session_files(deal_id: str, session_id: str) -> list[dict]:
    """List all files tracked for a given upload session with their chunk status."""
    session_dir = os.path.join(_temp_root(), deal_id, session_id)
    if not os.path.isdir(session_dir):
        return []
    files: list[dict] = []
    for entry in os.listdir(session_dir):
        meta_path = os.path.join(session_dir, entry, "meta.json")
        if not os.path.isfile(meta_path):
            continue
        with open(meta_path) as fh:
            meta = json.load(fh)
        chunks = get_uploaded_chunks(deal_id, session_id, meta["relative_path"])
        files.append({**meta, "uploaded_chunks": chunks})
    return files


def cleanup_session(deal_id: str, session_id: str) -> None:
    """Delete all temp data for a completed session."""
    session_dir = os.path.join(_temp_root(), deal_id, session_id)
    if os.path.isdir(session_dir):
        shutil.rmtree(session_dir, ignore_errors=True)
