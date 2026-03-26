"""Duplicate detection: SHA-256 exact match + TF-IDF fuzzy matching (Phase 4a)."""

from __future__ import annotations

import os
from collections import defaultdict

from app.config import settings
from app.db.client import get_supabase
from app.services.text_extractor import extract_text


def detect_duplicates(deal_id: str) -> int:
    """Run duplicate detection on all documents in a deal.

    Returns the number of duplicate groups created.
    """
    sb = get_supabase()
    docs = (
        sb.table("documents")
        .select("id, sha256_hash, filename, file_extension, storage_path")
        .eq("deal_id", deal_id)
        .execute()
    ).data

    groups_created = 0

    # ── Step 1: Exact duplicates (SHA-256) ───────────────────────────────
    hash_groups: dict[str, list[dict]] = defaultdict(list)
    for doc in docs:
        if doc.get("sha256_hash"):
            hash_groups[doc["sha256_hash"]].append(doc)

    exact_dup_doc_ids: set[str] = set()
    for sha, members in hash_groups.items():
        if len(members) < 2:
            continue
        # Create duplicate group
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
            }).execute()
            exact_dup_doc_ids.add(m["id"])
        groups_created += 1

    # ── Step 2: Fuzzy matching (TF-IDF cosine similarity) ────────────────
    # Only process docs not already in exact-duplicate groups
    remaining = [d for d in docs if d["id"] not in exact_dup_doc_ids]
    if len(remaining) < 2:
        return groups_created

    # Extract text for remaining documents
    texts: list[str] = []
    valid_docs: list[dict] = []

    for doc in remaining:
        ext = (doc.get("file_extension") or "").lstrip(".")
        if not ext or not doc.get("storage_path"):
            continue
        try:
            file_bytes = sb.storage.from_("dataroom-files").download(doc["storage_path"])
            text = extract_text(file_bytes, ext)
            if text and len(text) > 50:  # Skip near-empty files
                texts.append(text)
                valid_docs.append(doc)
        except Exception:
            continue

    if len(texts) < 2:
        return groups_created

    # TF-IDF + cosine similarity
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity

    vectorizer = TfidfVectorizer(max_features=5000, stop_words="english")
    tfidf_matrix = vectorizer.fit_transform(texts)
    sim_matrix = cosine_similarity(tfidf_matrix)

    threshold = settings.fuzzy_match_threshold
    visited: set[int] = set()

    for i in range(len(valid_docs)):
        if i in visited:
            continue
        near_group = [i]
        for j in range(i + 1, len(valid_docs)):
            if j in visited:
                continue
            if sim_matrix[i, j] >= threshold:
                near_group.append(j)
                visited.add(j)
        if len(near_group) < 2:
            continue
        visited.add(i)

        stem = os.path.splitext(valid_docs[near_group[0]]["filename"])[0]
        group = sb.table("duplicate_groups").insert({
            "deal_id": deal_id,
            "group_name": stem,
            "match_type": "near",
        }).execute()
        group_id = group.data[0]["id"]

        for idx, member_idx in enumerate(near_group):
            sb.table("duplicate_group_members").insert({
                "group_id": group_id,
                "document_id": valid_docs[member_idx]["id"],
                "is_canonical": idx == 0,
            }).execute()
        groups_created += 1

    return groups_created
