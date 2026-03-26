"""Lease & amendment linking — chain assembly + orphan detection (Phase 4b)."""

from __future__ import annotations

import os
import re
from collections import defaultdict

from Levenshtein import distance as levenshtein_distance

from app.db.client import get_supabase

# ── Document type patterns ───────────────────────────────────────────────────

_BASE_LEASE_PATTERNS = [
    re.compile(r"\b(lease|hyresavtal|tenancy.?agreement|rental.?agreement)\b", re.IGNORECASE),
]

_AMENDMENT_PATTERNS = [
    re.compile(r"\b(amendment|tillägg|tillagg|addendum)\b", re.IGNORECASE),
]

_SIDE_LETTER_PATTERNS = [
    re.compile(r"\b(side.?letter|bilaga|appendix)\b", re.IGNORECASE),
]

# Pattern to extract amendment number from filename
_AMENDMENT_NUMBER = re.compile(
    r"(?:amendment|tillägg|tillagg|addendum|#)\s*(\d+)", re.IGNORECASE
)

# Pattern to extract tenant name from path segments
_TENANT_FROM_PATH = re.compile(r"[/\\]([^/\\]+)[/\\]", re.IGNORECASE)


def _classify_lease_doc(filename: str, path: str) -> str:
    """Classify a document as base_lease, amendment, side_letter, or unknown."""
    combined = f"{path} {filename}"
    for p in _AMENDMENT_PATTERNS:
        if p.search(combined):
            return "amendment"
    for p in _SIDE_LETTER_PATTERNS:
        if p.search(combined):
            return "side_letter"
    for p in _BASE_LEASE_PATTERNS:
        if p.search(combined):
            return "base_lease"
    return "unknown"


def _extract_amendment_number(filename: str) -> int | None:
    """Parse amendment number from filename."""
    m = _AMENDMENT_NUMBER.search(filename)
    return int(m.group(1)) if m else None


def _extract_tenant_identifier(filename: str, path: str) -> str:
    """Extract a normalised tenant identifier from filename or path.

    Heuristic: take the first meaningful path segment after common folder names.
    """
    # Try path-based extraction: look for folder segments that aren't common names
    skip_folders = {
        "leases", "hyresavtal", "tenants", "documents", "dataroom",
        "legal", "contracts", "avtal",
    }
    segments = re.split(r"[/\\]", path)
    for seg in segments:
        seg_clean = seg.strip()
        if seg_clean and seg_clean.lower() not in skip_folders and not seg_clean.startswith("."):
            # Check it's not a file extension or common prefix
            if not re.match(r"^\d+$", seg_clean) and len(seg_clean) > 2:
                return seg_clean.lower().strip()

    # Fallback: use filename stem, removing known doc type words
    stem = os.path.splitext(filename)[0]
    cleaned = re.sub(
        r"\b(lease|amendment|tillägg|tillagg|hyresavtal|addendum|bilaga|side.?letter|#?\d+)\b",
        "",
        stem,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"[_\-\s]+", " ", cleaned).strip()
    return cleaned.lower() if cleaned else stem.lower()


def _find_matching_tenant(
    identifier: str, existing: dict[str, str], threshold: int = 2
) -> str | None:
    """Find a matching tenant key using exact match then Levenshtein distance."""
    if identifier in existing:
        return identifier
    for key in existing:
        if levenshtein_distance(identifier, key) <= threshold:
            return key
    return None


def link_leases(deal_id: str) -> int:
    """Build lease chains for all lease-type documents in a deal.

    Returns the number of chains created.
    """
    sb = get_supabase()

    # Get only lease-category documents
    docs = (
        sb.table("documents")
        .select("id, original_path, filename, assigned_category")
        .eq("deal_id", deal_id)
        .eq("assigned_category", "leases_amendments")
        .execute()
    ).data

    if not docs:
        return 0

    # Classify each doc and extract tenant
    classified: list[dict] = []
    for doc in docs:
        doc_type = _classify_lease_doc(doc["filename"], doc["original_path"])
        amendment_num = _extract_amendment_number(doc["filename"]) if doc_type == "amendment" else None
        tenant_id = _extract_tenant_identifier(doc["filename"], doc["original_path"])
        classified.append({
            **doc,
            "doc_type": doc_type,
            "amendment_number": amendment_num,
            "tenant_id": tenant_id,
        })

    # Group by tenant (with fuzzy matching)
    tenant_groups: dict[str, list[dict]] = defaultdict(list)
    tenant_canonical: dict[str, str] = {}  # normalised key → display name

    for item in classified:
        tid = item["tenant_id"]
        matched = _find_matching_tenant(tid, tenant_canonical)
        if matched:
            tenant_groups[matched].append(item)
        else:
            tenant_canonical[tid] = tid
            tenant_groups[tid].append(item)

    # Create chains
    chains_created = 0
    for tenant_key, members in tenant_groups.items():
        # Check if there's at least one base lease
        has_base = any(m["doc_type"] == "base_lease" for m in members)

        # Sort: base_lease first, then amendments by number, then others
        def sort_key(m):
            type_order = {"base_lease": 0, "amendment": 1, "side_letter": 2, "unknown": 3}
            return (type_order.get(m["doc_type"], 9), m.get("amendment_number") or 999)

        members.sort(key=sort_key)

        chain = sb.table("lease_chains").insert({
            "deal_id": deal_id,
            "tenant_name": tenant_canonical.get(tenant_key, tenant_key),
            "tenant_identifier": tenant_key,
        }).execute()
        chain_id = chain.data[0]["id"]

        for m in members:
            is_orphaned = (m["doc_type"] == "amendment" and not has_base)
            sb.table("lease_chain_documents").insert({
                "chain_id": chain_id,
                "document_id": m["id"],
                "doc_type": m["doc_type"],
                "amendment_number": m.get("amendment_number"),
                "is_orphaned": is_orphaned,
            }).execute()

        chains_created += 1

    return chains_created
