"""Clerk JWT verification dependency for FastAPI."""

from __future__ import annotations

import contextvars
import json
import os

import httpx
from fastapi import Depends, HTTPException, Request
from jose import JWTError, jwt

from app.config import settings
from app.db.client import get_supabase

# Set to True during the request when _ensure_user_exists creates a new row.
user_just_created: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "user_just_created", default=False,
)

_jwks_cache: dict | None = None

# Load default classifications once at module level
_DEFAULT_CLASSIFICATIONS_PATH = os.path.join(
    os.path.dirname(__file__), "default_classifications.json"
)
with open(_DEFAULT_CLASSIFICATIONS_PATH, "r", encoding="utf-8") as _f:
    DEFAULT_CLASSIFICATIONS: list[dict] = json.load(_f)


async def _get_jwks() -> dict:
    """Fetch Clerk JWKS (cached after first call)."""
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache

    # Derive the Clerk frontend API URL from the publishable key
    # pk_test_<base64 of domain> or pk_live_<base64 of domain>
    import base64

    pk = settings.clerk_publishable_key
    encoded = pk.split("_", 2)[-1]
    # Add padding
    encoded += "=" * (-len(encoded) % 4)
    domain = base64.b64decode(encoded).decode().rstrip("$")

    jwks_url = f"https://{domain}/.well-known/jwks.json"
    async with httpx.AsyncClient() as client:
        resp = await client.get(jwks_url)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        return _jwks_cache


async def get_current_user_id(request: Request) -> str:
    """Extract and verify Clerk user ID from the Authorization header."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")

    token = auth_header.split(" ", 1)[1]
    try:
        jwks = await _get_jwks()
        # Get the signing key from JWKS
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        rsa_key = {}
        for key in jwks.get("keys", []):
            if key["kid"] == kid:
                rsa_key = key
                break

        if not rsa_key:
            raise HTTPException(status_code=401, detail="Invalid token signing key")

        payload = jwt.decode(
            token,
            rsa_key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token missing subject")

        await _ensure_user_exists(user_id)
        return user_id

    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc


async def _ensure_user_exists(clerk_user_id: str) -> bool:
    """Upsert user into DB on first login using Clerk's backend API.

    On first login, also creates a company (named after the user) and seeds
    it with the default classification categories.

    Returns True if a new user row was created, False if it already existed.
    """
    sb = get_supabase()

    # Check if user already exists — skip API call if so
    existing = sb.table("users").select("id, company_id").eq("clerk_user_id", clerk_user_id).execute()
    if existing.data:
        user_just_created.set(False)
        # Backfill company for users created before the company feature was added
        if not existing.data[0].get("company_id"):
            await _backfill_company(clerk_user_id, existing.data[0]["id"])
        return False

    # Fetch full user info from Clerk API
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://api.clerk.com/v1/users/{clerk_user_id}",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            timeout=10,
        )

    if resp.status_code != 200:
        # Don't block auth if Clerk API is unreachable — store minimal record
        company = sb.table("companies").insert({"name": clerk_user_id}).execute()
        company_id = company.data[0]["id"]

        sb.table("users").upsert(
            {"clerk_user_id": clerk_user_id, "email": "", "company_id": company_id},
            on_conflict="clerk_user_id",
        ).execute()

        _seed_default_classifications(sb, company_id)
        user_just_created.set(True)
        return True

    data = resp.json()
    email_addresses = data.get("email_addresses", [])
    email = email_addresses[0].get("email_address", "") if email_addresses else ""
    name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip()

    # Create company named after the user
    company_name = name or email.split("@")[0] if email else clerk_user_id
    company = sb.table("companies").insert({"name": company_name}).execute()
    company_id = company.data[0]["id"]

    sb.table("users").upsert(
        {
            "clerk_user_id": clerk_user_id,
            "email": email,
            "name": name or None,
            "company_id": company_id,
        },
        on_conflict="clerk_user_id",
    ).execute()

    _seed_default_classifications(sb, company_id)
    user_just_created.set(True)
    return True


def _seed_default_classifications(sb, company_id: str) -> None:
    """Insert the default classification rows for a new company."""
    rows = [
        {
            "company_id": company_id,
            "key": c["key"],
            "label": c["label"],
            "description": c["description"],
            "display_order": c["display_order"],
        }
        for c in DEFAULT_CLASSIFICATIONS
    ]
    if rows:
        sb.table("company_classifications").insert(rows).execute()


async def _backfill_company(clerk_user_id: str, user_id: str) -> None:
    """Create a company + seed classifications for a pre-existing user with no company."""
    sb = get_supabase()

    # Try to fetch name/email from Clerk to use as company name
    company_name = clerk_user_id
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.clerk.com/v1/users/{clerk_user_id}",
                headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
                timeout=10,
            )
        if resp.status_code == 200:
            data = resp.json()
            name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip()
            email_addresses = data.get("email_addresses", [])
            email = email_addresses[0].get("email_address", "") if email_addresses else ""
            company_name = name or (email.split("@")[0] if email else clerk_user_id)
    except Exception:
        pass

    company = sb.table("companies").insert({"name": company_name}).execute()
    company_id = company.data[0]["id"]

    sb.table("users").update({"company_id": company_id}).eq("id", user_id).execute()
    _seed_default_classifications(sb, company_id)


CurrentUserId = Depends(get_current_user_id)
