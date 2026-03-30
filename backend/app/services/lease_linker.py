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
    re.compile(r"\b(amendment|tillägg|tillagg|addendum|deed.?of.?variation|"
               r"licence.?to|license.?to|rent.?review|memorandum|renewal|"
               r"cva.?modification|surrender|forfeiture)\b", re.IGNORECASE),
]

_SIDE_LETTER_PATTERNS = [
    re.compile(r"\b(side.?letter|bilaga|appendix|heads.?of.?terms)\b", re.IGNORECASE),
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


def _extract_tenant_identifier(
    filename: str,
    path: str,
    key_terms: dict | None = None,
) -> str:
    """Extract a normalised tenant identifier.

    Priority:
      1. Gemini-extracted ``tenant_name`` from *key_terms* (most reliable).
      2. Filename-based heuristic — strip doc-type prefix & unit/detail suffix,
         keep the tenant token.
      3. Path-based fallback (pre-existing behaviour, improved).
    """

    # ── 1. Gemini-extracted tenant name ──────────────────────────────────────
    if key_terms:
        raw = key_terms.get("tenant_name") or key_terms.get("Tenant Name") or ""
        if raw:
            # Normalise: lowercase, strip Ltd/LLP/Limited/Inc etc.
            cleaned = re.sub(
                r"\b(ltd|limited|llp|plc|inc|incorporated|gmbh|ab)\b\.?",
                "",
                raw,
                flags=re.IGNORECASE,
            )
            cleaned = re.sub(r"[^\w\s]", " ", cleaned)
            cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
            if cleaned and len(cleaned) > 2:
                return cleaned

    # ── 2. Filename-based extraction ─────────────────────────────────────────
    stem = os.path.splitext(filename)[0]

    # Remove doc-type prefixes (lease, amendment-NN, side-letter, etc.)
    cleaned = re.sub(
        r"^(lease|amendment|rent[_\-\s]?review|memorandum|side[_\-\s]?letter|"
        r"deed[_\-\s]?of[_\-\s]?variation|licence|license|heads[_\-\s]?of[_\-\s]?terms|"
        r"orphaned|cva|surrender|forfeiture|renewal)[_\-\s]*",
        "",
        stem,
        flags=re.IGNORECASE,
    )
    # Remove leading amendment numbers like "01-", "02-"
    cleaned = re.sub(r"^\d{1,3}[_\-\s]+", "", cleaned)

    # Remove unit/property suffixes ("unit-1", "unit-a", "unit1")
    cleaned = re.sub(
        r"[_\-\s]*(unit[_\-\s]*[\w]{1,3})[_\-\s]*$", "", cleaned, flags=re.IGNORECASE
    )

    # Remove trailing descriptors (parking-and-server, rent-review-2024, etc.)
    # Strategy: take only the first token group (the tenant name part)
    # Split on common delimiters and take first 1-2 meaningful segments
    parts = re.split(r"[_\-]+", cleaned)
    # Filter out noise: numbers, very short tokens, common words
    noise = {
        "and", "the", "of", "for", "with", "from", "to", "in", "on", "at",
        "rent", "review", "break", "variation", "parking", "server", "storage",
        "yard", "signage", "use", "extension", "subletting", "consent",
        "sublease", "spray", "booth", "mezzanine", "dilapidations",
        "concession", "modification", "deed", "notice", "record",
    }
    meaningful = []
    for p in parts:
        p_lower = p.strip().lower()
        if not p_lower:
            continue
        if re.match(r"^\d+$", p_lower):
            continue
        if p_lower in noise:
            break  # Stop at first noise word — everything after is description
        meaningful.append(p_lower)
    
    tenant_from_file = " ".join(meaningful).strip()
    if tenant_from_file and len(tenant_from_file) > 2:
        return tenant_from_file

    # ── 3. Path-based fallback ───────────────────────────────────────────────
    skip_folders = {
        "leases", "hyresavtal", "tenants", "documents", "dataroom",
        "legal", "contracts", "avtal", "financial", "compliance",
        "reports", "correspondence", "misc", "other",
    }
    # Also skip segments that look like deal folders
    segments = re.split(r"[/\\]", path)
    for seg in segments[:-1]:  # skip last (filename)
        seg_clean = seg.strip().lower()
        if not seg_clean or seg_clean in skip_folders:
            continue
        if re.match(r"^deal[_\-]?\d", seg_clean):
            continue
        if len(seg_clean) <= 2 or re.match(r"^\d+$", seg_clean):
            continue
        return seg_clean

    # Absolute fallback
    return stem.lower()


def _find_matching_tenant(
    identifier: str, existing: dict[str, str], threshold: int = 3
) -> str | None:
    """Find a matching tenant key using exact match, then containment, then Levenshtein.

    The threshold scales with string length: min(threshold, len/3) to avoid
    false positives on short names while allowing slack on longer ones.
    """
    if identifier in existing:
        return identifier

    # Check if one contains the other (e.g. "techcorp" vs "techcorp uk")
    for key in existing:
        if identifier in key or key in identifier:
            return key

    # Levenshtein with adaptive threshold
    for key in existing:
        max_dist = min(threshold, max(len(identifier), len(key)) // 3)
        if max_dist < 1:
            max_dist = 1
        if levenshtein_distance(identifier, key) <= max_dist:
            return key

    return None


def link_leases(deal_id: str) -> int:
    """Build lease chains for all lease-type documents in a deal.

    Returns the number of chains created.
    """
    sb = get_supabase()

    # ── Clean up existing chains for this deal (safe to re-run) ──────────────
    existing = sb.table("lease_chains").select("id").eq("deal_id", deal_id).execute().data or []
    for chain in existing:
        sb.table("lease_chain_documents").delete().eq("chain_id", chain["id"]).execute()
    if existing:
        sb.table("lease_chains").delete().eq("deal_id", deal_id).execute()

    # Get only lease-category documents (include key_terms for tenant extraction)
    docs = (
        sb.table("documents")
        .select("id, original_path, filename, assigned_category, key_terms")
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
        tenant_id = _extract_tenant_identifier(
            doc["filename"], doc["original_path"], doc.get("key_terms")
        )
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
        # Build a display name — prefer raw Gemini tenant_name from key_terms
        raw_display = None
        kt = item.get("key_terms")
        if kt:
            raw_display = kt.get("tenant_name") or kt.get("Tenant Name")

        matched = _find_matching_tenant(tid, tenant_canonical)
        if matched:
            # Upgrade display name if we now have a richer one
            if raw_display and len(raw_display) > len(tenant_canonical.get(matched, "")):
                tenant_canonical[matched] = raw_display
            tenant_groups[matched].append(item)
        else:
            display = raw_display or tid.title()
            tenant_canonical[tid] = display
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
