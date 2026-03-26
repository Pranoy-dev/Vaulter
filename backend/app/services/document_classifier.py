"""Rule-based document classifier — 5-category taxonomy (Phase 4c)."""

from __future__ import annotations

import os
import re

from app.config import settings
from app.db.client import get_supabase

# ── Taxonomy rules ───────────────────────────────────────────────────────────
# Each rule: (compiled regex pattern applied to LOWERCASE filename+path, category, base confidence)

_RULES: list[tuple[re.Pattern, str, float]] = [
    # Leases & Amendments (EN + SV)
    (re.compile(r"(lease|hyresavtal|tenancy|rental.?agreement)"), "leases_amendments", 0.90),
    (re.compile(r"(amendment|tillägg|addendum|tillagg)"), "leases_amendments", 0.88),
    (re.compile(r"(side.?letter|bilaga|appendix|annex)"), "leases_amendments", 0.80),
    (re.compile(r"(tenant|hyresgäst|hyresgast)"), "leases_amendments", 0.75),

    # Financial
    (re.compile(r"(rent.?roll|hyresförteckning|hyresforteckning)"), "financial", 0.90),
    (re.compile(r"(budget|forecast|prognos)"), "financial", 0.85),
    (re.compile(r"(cash.?flow|kassaflöde|kassaflode)"), "financial", 0.85),
    (re.compile(r"(financial|ekonomi|income|revenue|p&l|profit|loss)"), "financial", 0.80),
    (re.compile(r"(balance.?sheet|balansräkning)"), "financial", 0.80),
    (re.compile(r"(invoice|faktura|cost|kostnad)"), "financial", 0.75),

    # Technical & Environmental
    (re.compile(r"(inspection|besiktning|condition|survey)"), "technical_environmental", 0.85),
    (re.compile(r"(environment|miljö|miljo|contamination)"), "technical_environmental", 0.85),
    (re.compile(r"(technical|teknisk|maintenance|underhåll|underhall)"), "technical_environmental", 0.80),
    (re.compile(r"(energy|energi|epc|certificate)"), "technical_environmental", 0.75),
    (re.compile(r"(floor.?plan|plan.?ritning|blueprint|drawing)"), "technical_environmental", 0.80),
    (re.compile(r"(asbestos|radon|fire.?safety|brandskydd)"), "technical_environmental", 0.85),

    # Corporate & Legal
    (re.compile(r"(spa|share.?purchase|aktieöverlåtelse)"), "corporate_legal", 0.90),
    (re.compile(r"(shareholder|aktieägar|board|styrelse)"), "corporate_legal", 0.85),
    (re.compile(r"(certificate|intyg|permit|tillstånd|tillstand)"), "corporate_legal", 0.80),
    (re.compile(r"(register|registrer|corporate|bolag)"), "corporate_legal", 0.80),
    (re.compile(r"(legal|juridisk|contract|avtal)"), "corporate_legal", 0.70),
    (re.compile(r"(insurance|försäkring|forsakring)"), "corporate_legal", 0.75),
    (re.compile(r"(tax|skatt|vat|moms)"), "corporate_legal", 0.75),
]

# Folder-path heuristics (boost confidence if file is in a matching folder)
_FOLDER_HINTS: list[tuple[re.Pattern, str, float]] = [
    (re.compile(r"(lease|hyresavtal|tenants)"), "leases_amendments", 0.10),
    (re.compile(r"(financial|ekonomi|finance)"), "financial", 0.10),
    (re.compile(r"(technical|teknik|environment|miljö)"), "technical_environmental", 0.10),
    (re.compile(r"(legal|corporate|juridisk|bolag)"), "corporate_legal", 0.10),
]

# Extension hints
_EXT_HINTS: dict[str, str] = {
    ".xlsx": "financial",
    ".xls": "financial",
}


def classify_documents(deal_id: str) -> int:
    """Classify all documents in a deal into the 5-category taxonomy.

    Returns the number of documents classified (excluding 'other').
    """
    sb = get_supabase()
    docs = (
        sb.table("documents")
        .select("id, original_path, filename, file_extension")
        .eq("deal_id", deal_id)
        .execute()
    ).data

    threshold = settings.classification_confidence_threshold
    classified_count = 0

    for doc in docs:
        filename_lower = (doc.get("filename") or "").lower()
        path_lower = (doc.get("original_path") or "").lower()
        ext = (doc.get("file_extension") or "").lower()
        combined = f"{path_lower}/{filename_lower}"

        best_category = "other"
        best_confidence = 0.0

        # Apply filename/path rules
        for pattern, category, base_conf in _RULES:
            if pattern.search(combined):
                conf = base_conf
                # Boost from folder hints
                folder_part = os.path.dirname(path_lower)
                for fp, fc, boost in _FOLDER_HINTS:
                    if fp.search(folder_part) and fc == category:
                        conf = min(1.0, conf + boost)
                        break
                if conf > best_confidence:
                    best_confidence = conf
                    best_category = category

        # Extension hint as tiebreaker
        if best_confidence < threshold and ext in _EXT_HINTS:
            best_category = _EXT_HINTS[ext]
            best_confidence = max(best_confidence, 0.60)

        # Below threshold → other
        if best_confidence < threshold:
            best_category = "other"

        if best_category != "other":
            classified_count += 1

        sb.table("documents").update({
            "assigned_category": best_category,
            "classification_confidence": round(best_confidence, 3),
        }).eq("id", doc["id"]).execute()

    return classified_count
