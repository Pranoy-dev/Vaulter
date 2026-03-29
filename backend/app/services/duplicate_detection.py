"""Duplicate detection: two-phase approach.

Phase 1 (pre-AI): SHA-256 hash-based exact file matching.
Phase 2 (post-AI): TF-IDF cosine similarity for content-based matching with %.
"""

from __future__ import annotations

import os
from collections import defaultdict

from app.config import settings
from app.db.client import get_supabase
from app.services.text_extractor import extract_text


def detect_hash_duplicates(deal_id: str) -> int:
    """Phase 1: Detect exact file duplicates based on SHA-256 hash.

    Runs before AI processing — fast, no text extraction needed.
    Returns the number of duplicate groups created.
    """
    sb = get_supabase()

    # Clear only exact-match groups (preserve any existing content-match groups
    # from a previous run — they'll be cleared in phase 2)
    existing = (
        sb.table("duplicate_groups")
        .select("id")
        .eq("deal_id", deal_id)
        .eq("match_type", "exact")
        .execute()
    ).data
    for g in existing:
        sb.table("duplicate_groups").delete().eq("id", g["id"]).execute()

    docs = (
        sb.table("documents")
        .select("id, sha256_hash, filename")
        .eq("deal_id", deal_id)
        .execute()
    ).data

    hash_groups: dict[str, list[dict]] = defaultdict(list)
    for doc in docs:
        if doc.get("sha256_hash"):
            hash_groups[doc["sha256_hash"]].append(doc)

    groups_created = 0
    for sha, members in hash_groups.items():
        if len(members) < 2:
            continue
        stem = os.path.splitext(members[0]["filename"])[0]
        group = sb.table("duplicate_groups").insert({
            "deal_id": deal_id,
            "group_name": stem,
            "match_type": "exact",
        }).execute()
        group_id = group.data[0]["id"]

        for i, m in enumerate(members):
            sb.table("duplicate_group_members").insert({
                "group_id": group_id,
                "document_id": m["id"],
                "is_canonical": i == 0,
                "similarity_score": 1.0,
            }).execute()
        groups_created += 1

    return groups_created


def detect_content_duplicates(deal_id: str) -> int:
    """Phase 2: Detect near-duplicate documents using TF-IDF content similarity.

    Runs after AI processing so extracted_text is available.
    Returns the number of duplicate groups created.
    """
    sb = get_supabase()

    # Clear only near-match groups from previous runs
    existing = (
        sb.table("duplicate_groups")
        .select("id")
        .eq("deal_id", deal_id)
        .eq("match_type", "near")
        .execute()
    ).data
    for g in existing:
        sb.table("duplicate_groups").delete().eq("id", g["id"]).execute()

    # Get exact-duplicate doc IDs so we skip them
    exact_groups = (
        sb.table("duplicate_groups")
        .select("id")
        .eq("deal_id", deal_id)
        .eq("match_type", "exact")
        .execute()
    ).data
    exact_doc_ids: set[str] = set()
    for g in exact_groups:
        members = (
            sb.table("duplicate_group_members")
            .select("document_id")
            .eq("group_id", g["id"])
            .execute()
        ).data
        for m in members:
            exact_doc_ids.add(m["document_id"])

    docs = (
        sb.table("documents")
        .select("id, filename, file_extension, storage_path, extracted_text")
        .eq("deal_id", deal_id)
        .execute()
    ).data

    remaining = [d for d in docs if d["id"] not in exact_doc_ids]
    if len(remaining) < 2:
        return 0

    # Extract text for remaining documents (prefer cached extracted_text from Gemini)
    texts: list[str] = []
    valid_docs: list[dict] = []

    for doc in remaining:
        cached_text = doc.get("extracted_text")
        if cached_text and len(cached_text) > 50:
            texts.append(cached_text)
            valid_docs.append(doc)
            continue

        # Fallback: download and extract locally
        ext = (doc.get("file_extension") or "").lstrip(".")
        if not ext or not doc.get("storage_path"):
            continue
        try:
            file_bytes = sb.storage.from_("dataroom-files").download(doc["storage_path"])
            text = extract_text(file_bytes, ext)
            if text and len(text) > 50:
                texts.append(text)
                valid_docs.append(doc)
        except Exception:
            continue

    if len(texts) < 2:
        return 0

    # TF-IDF + cosine similarity
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity

    vectorizer = TfidfVectorizer(max_features=5000, stop_words="english")
    tfidf_matrix = vectorizer.fit_transform(texts)
    sim_matrix = cosine_similarity(tfidf_matrix)

    threshold = settings.fuzzy_match_threshold
    visited: set[int] = set()
    groups_created = 0

    for i in range(len(valid_docs)):
        if i in visited:
            continue
        near_group: list[tuple[int, float]] = []
        for j in range(i + 1, len(valid_docs)):
            if j in visited:
                continue
            score = float(sim_matrix[i, j])
            if score >= threshold:
                near_group.append((j, score))
                visited.add(j)
        if not near_group:
            continue
        visited.add(i)

        stem = os.path.splitext(valid_docs[near_group[0][0]]["filename"])[0]
        group = sb.table("duplicate_groups").insert({
            "deal_id": deal_id,
            "group_name": stem,
            "match_type": "near",
        }).execute()
        group_id = group.data[0]["id"]

        # Insert the canonical (reference) document
        sb.table("duplicate_group_members").insert({
            "group_id": group_id,
            "document_id": valid_docs[i]["id"],
            "is_canonical": True,
            "similarity_score": 1.0,
        }).execute()

        # Insert similar members with their scores
        for member_idx, score in near_group:
            sb.table("duplicate_group_members").insert({
                "group_id": group_id,
                "document_id": valid_docs[member_idx]["id"],
                "is_canonical": False,
                "similarity_score": round(score, 4),
            }).execute()
        groups_created += 1

    return groups_created


def detect_duplicates(deal_id: str) -> int:
    """Legacy wrapper — runs both phases. Kept for backward compat."""
    return detect_hash_duplicates(deal_id) + detect_content_duplicates(deal_id)
