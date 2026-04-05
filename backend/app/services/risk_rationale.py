"""Risk rationale generation service.

Calls OpenAI (gpt-4o-mini) to produce a structured rationale explaining
why a deal is risky, good, or mixed based on its computed insights payload.

The result is stored permanently in deals.ai_rationale (JSONB) the moment
it is generated, so every subsequent view is free (no extra API call).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

from openai import OpenAI

from app.config import settings
from app.db.client import get_supabase

logger = logging.getLogger(__name__)

_SYSTEM = (
    "You are a senior commercial real-estate investment analyst writing for a deal committee. "
    "You receive structured deal risk data and return a single JSON object. "
    "Your response MUST be valid JSON and nothing else — no markdown, no prose outside the JSON."
)

_USER_TEMPLATE = """\
Analyse the deal risk payload below and return strict JSON in exactly this shape:
{{
  "summary": "<3–5 complete sentences covering: overall risk picture, WAULT and expiry concentration, documentation completeness, key tenants and financial coverage, and the single most important concern or strength>",
  "verdict": "<one of: risky | good | mixed>",
  "positives": ["<≤16 word bullet>", ...],
  "concerns": ["<≤16 word bullet>", ...],
  "actions": ["<≤16 word recommended action>", ...]
}}

Rules:
- summary: exactly 3–5 sentences, plain English, no bullet points, no jargon acronyms without expansion.
- verdict: "good" if risk_score >= 70, "risky" if risk_score <= 40, otherwise "mixed".
- positives and concerns: 2–4 items each, grounded in the data provided.
- actions: 1–3 specific next steps the deal team should take.
- Use concrete numbers from the data (scores, WAULT years, document counts, expiry %).
- Output ONLY the JSON object.

DEAL DATA:
{payload}
"""


def _compact_payload(insights: dict) -> dict:
    """Build a comprehensive payload for the model, excluding per-doc free-text summaries.

    Per-document AI summaries are omitted — they are verbose and not needed here.
    Everything else (scores, metrics, drivers, missing items, expiry timeline,
    category breakdown, chain summary, and lightweight per-doc metadata) is included.
    """
    doc_insights = insights.get("document_insights") or []
    return {
        "risk_score": insights.get("risk_score"),
        "risk_band": insights.get("risk_band"),
        "dimensions": insights.get("dimensions"),
        "wault": insights.get("wault"),
        "total_documents": insights.get("total_documents"),
        "processed_documents": insights.get("processed_documents"),
        "circuit_breakers": insights.get("circuit_breakers"),
        "risk_drivers": insights.get("risk_drivers"),
        "missing_items": insights.get("missing_items"),
        "key_metrics": insights.get("key_metrics"),
        "expiry_timeline": insights.get("expiry_timeline"),
        "category_breakdown": insights.get("category_breakdown"),
        "lease_chain_summary": insights.get("lease_chain_summary"),
        # Lightweight per-doc metadata only — no free-text summaries
        "documents": [
            {
                "filename": d.get("filename"),
                "category": d.get("category"),
                "parties": d.get("parties"),
                "expiry_date": d.get("expiry_date"),
                "has_signature": d.get("has_signature"),
                "has_seal": d.get("has_seal"),
                "is_incomplete": d.get("is_incomplete"),
                "incompleteness_reasons": d.get("incompleteness_reasons"),
                "key_terms": d.get("key_terms"),
            }
            for d in doc_insights
        ],
    }


def _parse_rationale(text: str) -> dict | None:
    """Extract JSON from the model response, tolerating markdown fences."""
    # Strip optional ```json ... ``` fences
    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned.strip())
    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return None

    if not isinstance(data, dict):
        return None

    # Validate and normalise
    verdict = data.get("verdict", "mixed")
    if verdict not in ("risky", "good", "mixed"):
        verdict = "mixed"

    return {
        "summary": str(data.get("summary", "")).strip()[:1000] or "Risk explanation unavailable.",
        "verdict": verdict,
        "positives": [str(p)[:120] for p in (data.get("positives") or [])[:4]],
        "concerns": [str(c)[:120] for c in (data.get("concerns") or [])[:4]],
        "actions": [str(a)[:120] for a in (data.get("actions") or [])[:3]],
    }


def generate_and_store_rationale(deal_id: str, insights: dict) -> dict | None:
    """Generate the AI rationale from *insights* and persist it to the DB.

    Returns the rationale dict on success, None on failure (logged but not raised
    so callers can treat it as non-fatal).
    """
    if not settings.openai_api_key:
        logger.warning("OpenAI key not configured — skipping AI rationale generation.")
        return None

    try:
        client = OpenAI(api_key=settings.openai_api_key)
        payload = _compact_payload(insights)
        user_msg = _USER_TEMPLATE.format(payload=json.dumps(payload, default=str))

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.2,
            max_tokens=700,
        )

        raw = response.choices[0].message.content or ""
        rationale = _parse_rationale(raw)
        if rationale is None:
            logger.warning("AI rationale: model returned unparseable JSON — raw: %s", raw[:300])
            return None

        # Persist permanently to the deals table
        sb = get_supabase()
        sb.table("deals").update({
            "ai_rationale": rationale,
            "ai_rationale_generated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", deal_id).execute()

        logger.info("AI rationale stored for deal %s (verdict=%s)", deal_id, rationale["verdict"])
        return rationale

    except Exception as exc:
        logger.warning("AI rationale generation failed for deal %s: %s", deal_id, exc)
        return None
