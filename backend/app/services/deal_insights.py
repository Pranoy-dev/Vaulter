"""Deal AI Insights — rules-based scoring engine.

Computes a Deal Risk Score (0–100) from three dimensions:
  - Completeness (30%): Document coverage, quality, amendment chain integrity
  - Lease Risk (45%): WAULT, expiry concentration, tenant concentration, break options
  - Financial Risk (25%): Rent levels, escalation provisions, financial doc quality

Also generates:
  - "What's Missing" checklist with criticality tiers
  - Key risk drivers (narrative explanations)
  - Lease expiry timeline (annual buckets)
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from datetime import date, datetime
from typing import Any

from app.db.client import get_supabase

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────

WEIGHT_COMPLETENESS = 0.30
WEIGHT_LEASE_RISK = 0.45
WEIGHT_FINANCIAL_RISK = 0.25

# Risk bands
RISK_BANDS = [
    (75, 100, "low", "Low Risk", "green"),
    (50, 74, "medium", "Medium Risk", "amber"),
    (25, 49, "high", "High Risk", "orange"),
    (0, 24, "critical", "Critical Risk", "red"),
]

# Category importance for completeness scoring
CATEGORY_WEIGHTS = {
    "leases_amendments": 0.40,
    "financial": 0.20,
    "technical_environmental": 0.15,
    "corporate_legal": 0.15,
}
# Amendment chain integrity weight (within completeness)
CHAIN_INTEGRITY_WEIGHT = 0.10

# Document criticality tiers for "What's Missing"
CRITICAL_SIGNALS = {
    "leases_amendments": {"tier": 1, "weight": 10, "label": "Leases & Amendments"},
    "corporate_legal": {"tier": 1, "weight": 10, "label": "Corporate & Legal"},
}
IMPORTANT_SIGNALS = {
    "financial": {"tier": 2, "weight": 7, "label": "Financial Documents"},
    "technical_environmental": {"tier": 2, "weight": 7, "label": "Technical / Environmental"},
}
STANDARD_SIGNALS = {
    "other": {"tier": 3, "weight": 4, "label": "Other Documents"},
}

# WAULT scoring: piecewise linear
WAULT_BREAKPOINTS = [
    (10, 100), (7, 80), (5, 60), (3, 30), (1, 10), (0, 0),
]

# Expiry concentration thresholds (% of rent in any 12-month window)
EXPIRY_CONC_THRESHOLDS = [
    (15, 100), (20, 70), (30, 40), (100, 0),
]

# Tenant concentration thresholds (top tenant % of total)
TENANT_CONC_THRESHOLDS = [
    (15, 100), (25, 70), (40, 40), (60, 15), (100, 0),
]


# ── Utility functions ────────────────────────────────────────────────────────

def _piecewise_linear(value: float, breakpoints: list[tuple[float, float]]) -> float:
    """Interpolate a score from breakpoints [(threshold, score), ...].

    Breakpoints must be sorted descending by threshold.
    """
    if not breakpoints:
        return 50.0
    if value >= breakpoints[0][0]:
        return breakpoints[0][1]
    if value <= breakpoints[-1][0]:
        return breakpoints[-1][1]
    for i in range(len(breakpoints) - 1):
        upper_thresh, upper_score = breakpoints[i]
        lower_thresh, lower_score = breakpoints[i + 1]
        if lower_thresh <= value <= upper_thresh:
            ratio = (value - lower_thresh) / (upper_thresh - lower_thresh)
            return lower_score + ratio * (upper_score - lower_score)
    return 50.0


def _parse_date(date_str: str | None) -> date | None:
    """Parse ISO 8601 date string to date object."""
    if not date_str:
        return None
    try:
        if "T" in date_str:
            return datetime.fromisoformat(date_str.replace("Z", "+00:00")).date()
        return date.fromisoformat(date_str)
    except (ValueError, TypeError):
        return None


def _years_until(target: date, from_date: date | None = None) -> float:
    """Calculate years from from_date (or today) to target date."""
    ref = from_date or date.today()
    delta = target - ref
    return delta.days / 365.25


def _get_risk_band(score: float) -> dict:
    """Get risk band info for a score."""
    score = max(0, min(100, score))
    for low, high, key, label, color in RISK_BANDS:
        if low <= score <= high:
            return {"key": key, "label": label, "color": color}
    return {"key": "critical", "label": "Critical Risk", "color": "red"}


# ── Completeness scoring ────────────────────────────────────────────────────

def _compute_completeness(
    docs: list[dict],
    chains: list[dict],
    categories: dict[str, int],
) -> tuple[float, list[dict], list[dict]]:
    """Compute completeness dimension score (0–100).

    Returns: (score, missing_items, risk_drivers)
    """
    total_docs = len(docs)
    if total_docs == 0:
        return 0.0, [{"tier": 1, "weight": 10, "message": "No documents uploaded", "category": "all"}], \
            [{"severity": "critical", "message": "No documents have been uploaded to the data room."}]

    missing_items: list[dict] = []
    risk_drivers: list[dict] = []

    # Per-category completeness
    category_scores: dict[str, float] = {}
    for cat_key, cat_weight in CATEGORY_WEIGHTS.items():
        count = categories.get(cat_key, 0)
        if count == 0:
            category_scores[cat_key] = 0.0
            tier_info = CRITICAL_SIGNALS.get(cat_key) or IMPORTANT_SIGNALS.get(cat_key) or STANDARD_SIGNALS.get(cat_key, {})
            label = tier_info.get("label", cat_key)
            tier = tier_info.get("tier", 3)
            weight = tier_info.get("weight", 4)
            missing_items.append({
                "tier": tier,
                "weight": weight,
                "message": f"No {label} documents found",
                "category": cat_key,
            })
            risk_drivers.append({
                "severity": "critical" if tier == 1 else "warning",
                "message": f"Missing {label} — no documents in this category.",
                "impact": -cat_weight * 100,
            })
        else:
            # Check quality: incomplete & empty docs penalize
            cat_docs = [d for d in docs if d.get("assigned_category") == cat_key]
            quality_sum = 0.0
            for d in cat_docs:
                if d.get("is_empty"):
                    quality_sum += 0.0
                elif d.get("is_incomplete"):
                    quality_sum += 0.60
                elif d.get("classification_confidence", 0) < 0.5:
                    quality_sum += 0.75
                else:
                    quality_sum += 1.0

            category_scores[cat_key] = (quality_sum / len(cat_docs)) * 100 if cat_docs else 0

            # Flag incomplete documents
            incomplete = [d for d in cat_docs if d.get("is_incomplete")]
            if incomplete:
                tier_info = CRITICAL_SIGNALS.get(cat_key) or IMPORTANT_SIGNALS.get(cat_key) or STANDARD_SIGNALS.get(cat_key, {})
                label = tier_info.get("label", cat_key)
                missing_items.append({
                    "tier": tier_info.get("tier", 3),
                    "weight": tier_info.get("weight", 4),
                    "message": f"{len(incomplete)} incomplete {label} document{'s' if len(incomplete) > 1 else ''}",
                    "category": cat_key,
                    "details": [
                        {"filename": d["filename"], "reasons": d.get("incompleteness_reasons", [])}
                        for d in incomplete
                    ],
                })

    # Amendment chain integrity
    chain_score = 100.0
    if chains:
        total_chains = len(chains)
        orphan_count = sum(
            1 for c in chains
            for d in (c.get("documents") or [])
            if d.get("is_orphaned")
        )
        chains_with_base = sum(
            1 for c in chains
            if any(d.get("doc_type") == "base_lease" for d in (c.get("documents") or []))
        )
        if total_chains > 0:
            chain_score = (chains_with_base / total_chains) * 100
            chain_score = max(0, chain_score - (orphan_count * 10))

        if orphan_count > 0:
            missing_items.append({
                "tier": 2,
                "weight": 7,
                "message": f"{orphan_count} orphaned amendment{'s' if orphan_count > 1 else ''} without base lease",
                "category": "leases_amendments",
            })
            risk_drivers.append({
                "severity": "warning",
                "message": f"{orphan_count} amendment{'s' if orphan_count > 1 else ''} found without a matching base lease.",
                "impact": -orphan_count * 5,
            })

    # Documents with processing failures
    failed = [d for d in docs if d.get("processing_status") == "failed"]
    if failed:
        missing_items.append({
            "tier": 2,
            "weight": 5,
            "message": f"{len(failed)} document{'s' if len(failed) > 1 else ''} failed processing",
            "category": "processing",
        })

    # Empty documents
    empty = [d for d in docs if d.get("is_empty")]
    if empty:
        missing_items.append({
            "tier": 3,
            "weight": 3,
            "message": f"{len(empty)} empty/unreadable document{'s' if len(empty) > 1 else ''}",
            "category": "quality",
        })

    # Documents without signatures (for lease docs)
    lease_docs = [d for d in docs if d.get("assigned_category") == "leases_amendments" and d.get("processing_status") == "completed"]
    unsigned_leases = [d for d in lease_docs if not d.get("has_signature")]
    if unsigned_leases and lease_docs:
        unsigned_pct = len(unsigned_leases) / len(lease_docs) * 100
        if unsigned_pct > 50:
            missing_items.append({
                "tier": 2,
                "weight": 6,
                "message": f"{len(unsigned_leases)} of {len(lease_docs)} lease documents appear unsigned",
                "category": "leases_amendments",
            })
            risk_drivers.append({
                "severity": "warning",
                "message": f"{len(unsigned_leases)} lease documents appear to lack signatures.",
                "impact": -10,
            })

    # Weighted completeness score
    weighted_sum = 0.0
    weight_sum = 0.0
    for cat_key, cat_weight in CATEGORY_WEIGHTS.items():
        weighted_sum += category_scores.get(cat_key, 50) * cat_weight
        weight_sum += cat_weight
    weighted_sum += chain_score * CHAIN_INTEGRITY_WEIGHT
    weight_sum += CHAIN_INTEGRITY_WEIGHT

    completeness_score = weighted_sum / weight_sum if weight_sum > 0 else 50.0

    # Sort missing items by tier then weight
    missing_items.sort(key=lambda x: (x["tier"], -x["weight"]))

    return completeness_score, missing_items, risk_drivers


# ── Lease risk scoring ───────────────────────────────────────────────────────

def _extract_lease_metrics(docs: list[dict]) -> dict:
    """Extract lease risk metrics from document data."""
    lease_docs = [
        d for d in docs
        if d.get("assigned_category") == "leases_amendments"
        and d.get("processing_status") == "completed"
        and not d.get("is_empty")
    ]

    metrics: dict[str, Any] = {
        "lease_count": len(lease_docs),
        "tenants": [],
        "expiry_dates": [],
        "annual_rents": [],
        "break_dates": [],
        "has_break_options": False,
        "escalation_types": [],
    }

    for doc in lease_docs:
        key_terms = doc.get("key_terms") or {}
        parties = doc.get("parties") or []

        # Tenant info
        if parties:
            for party in parties:
                if party not in metrics["tenants"]:
                    metrics["tenants"].append(party)

        # Expiry date
        expiry = _parse_date(doc.get("expiry_date"))
        if expiry:
            rent_str = key_terms.get("annual_rent") or key_terms.get("rent_amount") or key_terms.get("rent") or ""
            rent_val = _parse_rent(rent_str)
            metrics["expiry_dates"].append({
                "date": expiry,
                "filename": doc["filename"],
                "rent": rent_val,
                "parties": parties,
            })

        # Extract rent amounts
        for rent_key in ("annual_rent", "rent_amount", "rent", "base_rent", "monthly_rent"):
            if rent_key in key_terms:
                rent_val = _parse_rent(key_terms[rent_key])
                if rent_val and rent_val > 0:
                    if "month" in rent_key.lower() or "month" in key_terms[rent_key].lower():
                        rent_val *= 12
                    metrics["annual_rents"].append(rent_val)
                break

        # Break options
        for term_key in ("break_option", "break_date", "break_option_date", "break_clause"):
            if term_key in key_terms:
                metrics["has_break_options"] = True
                break_date = _parse_date(key_terms[term_key])
                if break_date:
                    metrics["break_dates"].append(break_date)

        # Escalation type
        for term_key in ("rent_escalation", "escalation", "rent_review", "index_clause", "indexation"):
            if term_key in key_terms:
                esc_type = _classify_escalation(key_terms[term_key])
                metrics["escalation_types"].append(esc_type)
                break

    return metrics


def _parse_rent(rent_str: str) -> float:
    """Parse rent value from key_terms string. Returns 0 if unparseable."""
    if not rent_str:
        return 0.0
    import re
    # Remove currency symbols and common separators
    cleaned = re.sub(r"[^\d.,]", "", str(rent_str))
    cleaned = cleaned.replace(",", "")
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return 0.0


def _classify_escalation(esc_str: str) -> str:
    """Classify rent escalation type from description."""
    lower = esc_str.lower()
    if any(k in lower for k in ("cpi", "index", "kpi", "consumer price", "inflation")):
        return "cpi"
    if any(k in lower for k in ("fixed", "percent", "%")):
        return "fixed"
    if any(k in lower for k in ("market", "open market", "erv")):
        return "market"
    return "other"


def _compute_wault(metrics: dict) -> float | None:
    """Compute weighted average unexpired lease term (years).

    If rent data is available, use rent-weighted WAULT.
    Otherwise, use simple average of remaining terms.
    """
    expiries = metrics.get("expiry_dates", [])
    if not expiries:
        return None

    today = date.today()
    terms = []
    rents = []
    for exp in expiries:
        years = _years_until(exp["date"], today)
        if years > 0:
            terms.append(years)
            rents.append(exp.get("rent") or 1.0)  # default weight of 1 if no rent data

    if not terms:
        return 0.0

    total_rent = sum(rents)
    if total_rent > 0:
        return sum(t * r for t, r in zip(terms, rents)) / total_rent
    return sum(terms) / len(terms)


def _compute_lease_risk(docs: list[dict]) -> tuple[float, list[dict]]:
    """Compute lease risk dimension score (0–100).

    Returns: (score, risk_drivers)
    """
    risk_drivers: list[dict] = []
    metrics = _extract_lease_metrics(docs)

    if metrics["lease_count"] == 0:
        return 50.0, [{"severity": "info", "message": "No lease documents found for risk analysis.", "impact": 0}]

    # Sub-component scores
    sub_scores: dict[str, tuple[float, float]] = {}  # name → (score, weight)

    # 1. WAULT (30% weight)
    wault = _compute_wault(metrics)
    if wault is not None:
        wault_score = _piecewise_linear(wault, WAULT_BREAKPOINTS)
        sub_scores["wault"] = (wault_score, 0.30)
        if wault < 3:
            risk_drivers.append({
                "severity": "critical" if wault < 1 else "warning",
                "message": f"WAULT is {wault:.1f} years — {'imminent income instability' if wault < 1 else 'significant near-term vacancy risk'}.",
                "impact": -(100 - wault_score) * 0.30,
            })
        elif wault < 5:
            risk_drivers.append({
                "severity": "info",
                "message": f"WAULT is {wault:.1f} years — below 5-year comfort threshold.",
                "impact": -(100 - wault_score) * 0.30,
            })
    else:
        sub_scores["wault"] = (50.0, 0.30)  # neutral if no data

    # 2. Expiry concentration (20% weight)
    expiry_conc = _compute_expiry_concentration(metrics)
    if expiry_conc is not None:
        # Invert: lower concentration = higher score
        conc_score = _piecewise_linear(100 - expiry_conc, [
            (100, 100), (85, 100), (80, 70), (70, 40), (0, 0),
        ])
        sub_scores["expiry_concentration"] = (conc_score, 0.20)
        if expiry_conc > 25:
            risk_drivers.append({
                "severity": "warning",
                "message": f"{expiry_conc:.0f}% of rent expires within a single 12-month window — high concentration.",
                "impact": -(100 - conc_score) * 0.20,
            })
    else:
        sub_scores["expiry_concentration"] = (50.0, 0.20)

    # 3. Tenant concentration (25% weight)
    tenant_count = len(metrics["tenants"])
    if tenant_count > 0:
        if tenant_count == 1:
            tenant_score = 15.0
            risk_drivers.append({
                "severity": "warning",
                "message": f"Single tenant property — full income concentration.",
                "impact": -(100 - tenant_score) * 0.25,
            })
        else:
            # Simple approximation: more tenants = lower concentration risk
            tenant_score = min(100, 20 + (tenant_count - 1) * 20)
        sub_scores["tenant_concentration"] = (tenant_score, 0.25)
    else:
        sub_scores["tenant_concentration"] = (50.0, 0.25)

    # 4. Break option risk (15% weight)
    if metrics["has_break_options"]:
        break_score = 60.0  # Default moderate risk when breaks exist
        if metrics["break_dates"] and wault:
            # Break gap ratio
            today = date.today()
            earliest_break = min(_years_until(bd, today) for bd in metrics["break_dates"])
            if earliest_break < 1:
                break_score = 20.0
                risk_drivers.append({
                    "severity": "warning",
                    "message": f"Break option exercisable within {earliest_break:.1f} years.",
                    "impact": -(100 - break_score) * 0.15,
                })
            elif wault and wault > 0:
                gap_ratio = (wault - earliest_break) / wault
                break_score = max(20, 100 - gap_ratio * 80)
    else:
        break_score = 90.0  # No breaks = low break risk
    sub_scores["break_options"] = (break_score, 0.15)

    # 5. Vacancy indication (10% weight) — from document count vs expected
    # Simple heuristic: if we have signed leases, occupancy is implied
    signed_leases = sum(1 for d in docs
                       if d.get("assigned_category") == "leases_amendments"
                       and d.get("has_signature"))
    vacancy_score = min(100, 60 + signed_leases * 10)
    sub_scores["vacancy"] = (vacancy_score, 0.10)

    # Weighted average
    total_weight = sum(w for _, w in sub_scores.values())
    lease_score = sum(s * w for s, w in sub_scores.values()) / total_weight if total_weight > 0 else 50.0

    return lease_score, risk_drivers


def _compute_expiry_concentration(metrics: dict) -> float | None:
    """Compute max percentage of rent expiring in any rolling 12-month window."""
    expiries = metrics.get("expiry_dates", [])
    if not expiries:
        return None

    total_rent = sum(e.get("rent") or 1.0 for e in expiries)
    if total_rent <= 0:
        return None

    today = date.today()
    # Create 12-month rolling windows for the next 5 years
    max_conc = 0.0
    for year_offset in range(6):
        window_start = date(today.year + year_offset, today.month, today.day if today.day <= 28 else 28)
        window_end = date(today.year + year_offset + 1, today.month, today.day if today.day <= 28 else 28)
        rent_in_window = sum(
            e.get("rent") or 1.0
            for e in expiries
            if e["date"] >= window_start and e["date"] < window_end
        )
        pct = (rent_in_window / total_rent) * 100
        max_conc = max(max_conc, pct)

    return max_conc


# ── Financial risk scoring ───────────────────────────────────────────────────

def _compute_financial_risk(docs: list[dict], metrics: dict) -> tuple[float, list[dict]]:
    """Compute financial risk dimension score (0–100).

    Returns: (score, risk_drivers)
    """
    risk_drivers: list[dict] = []

    # Sub-components
    sub_scores: dict[str, tuple[float, float]] = {}

    # 1. Rent escalation provisions (20% weight)
    esc_types = metrics.get("escalation_types", [])
    if esc_types:
        cpi_count = sum(1 for e in esc_types if e == "cpi")
        fixed_count = sum(1 for e in esc_types if e == "fixed")
        market_count = sum(1 for e in esc_types if e == "market")
        total = len(esc_types)

        esc_score = (cpi_count * 95 + fixed_count * 80 + market_count * 60) / total if total > 0 else 50
        sub_scores["escalation"] = (esc_score, 0.20)

        if cpi_count == total:
            risk_drivers.append({
                "severity": "positive",
                "message": f"All {total} leases have CPI-linked rent escalation — strong rental growth protection.",
                "impact": 5,
            })
    else:
        sub_scores["escalation"] = (50.0, 0.20)

    # 2. Financial document quality (20% weight)
    fin_docs = [d for d in docs if d.get("assigned_category") == "financial"]
    if fin_docs:
        quality = sum(
            1.0 if not d.get("is_incomplete") and not d.get("is_empty") else 0.5
            for d in fin_docs
        ) / len(fin_docs)
        fin_doc_score = quality * 100
    else:
        fin_doc_score = 30.0  # Penalty for missing financials
        risk_drivers.append({
            "severity": "warning",
            "message": "No financial documents found in the data room.",
            "impact": -15,
        })
    sub_scores["financial_doc_quality"] = (fin_doc_score, 0.20)

    # 3. Rent level assessment (30% weight) — simplified, based on key_terms
    # If ERV data is present, compare passing rent to ERV
    has_erv = False
    rent_gaps = []
    for doc in docs:
        kt = doc.get("key_terms") or {}
        for k, v in kt.items():
            if "erv" in k.lower() or "estimated rental value" in k.lower():
                has_erv = True
                break
    rent_score = 50.0 if not has_erv else 70.0  # Neutral if no ERV data
    sub_scores["rent_level"] = (rent_score, 0.30)

    # 4. Passing rent concentration (30% weight) — re-use tenant count as proxy
    rents = metrics.get("annual_rents", [])
    if len(rents) > 1:
        total_rent = sum(rents)
        if total_rent > 0:
            shares = [r / total_rent for r in rents]
            hhi = sum(s * s for s in shares)
            if hhi < 0.10:
                rent_conc_score = 90.0
            elif hhi < 0.20:
                rent_conc_score = 70.0
            elif hhi < 0.35:
                rent_conc_score = 45.0
            else:
                rent_conc_score = 20.0
                risk_drivers.append({
                    "severity": "warning",
                    "message": f"High rent concentration (HHI: {hhi:.2f}) — income dependence on few tenants.",
                    "impact": -15,
                })
        else:
            rent_conc_score = 50.0
    elif len(rents) == 1:
        rent_conc_score = 15.0
    else:
        rent_conc_score = 50.0
    sub_scores["rent_concentration"] = (rent_conc_score, 0.30)

    # Weighted average
    total_weight = sum(w for _, w in sub_scores.values())
    fin_score = sum(s * w for s, w in sub_scores.values()) / total_weight if total_weight > 0 else 50.0

    return fin_score, risk_drivers


# ── Circuit breakers ─────────────────────────────────────────────────────────

def _apply_circuit_breakers(
    composite: float,
    docs: list[dict],
    chains: list[dict],
    categories: dict[str, int],
    wault: float | None,
) -> tuple[float, list[dict]]:
    """Apply circuit breakers that cap the composite score.

    Returns: (capped_score, breaker_messages)
    """
    breakers: list[dict] = []
    cap = composite

    # Missing title/ownership docs → check corporate_legal
    if categories.get("corporate_legal", 0) == 0 and len(docs) > 5:
        breakers.append({
            "severity": "critical",
            "message": "No title/ownership or legal documents found — score capped at 25.",
            "cap": 25,
        })
        cap = min(cap, 25)

    # Zero leases when expected
    has_non_lease = any(d.get("assigned_category") != "leases_amendments" for d in docs)
    if categories.get("leases_amendments", 0) == 0 and has_non_lease and len(docs) > 3:
        breakers.append({
            "severity": "critical",
            "message": "No lease documents found when other documents are present — score capped at 15.",
            "cap": 15,
        })
        cap = min(cap, 15)

    # WAULT < 6 months
    if wault is not None and wault < 0.5:
        breakers.append({
            "severity": "critical",
            "message": f"WAULT below 6 months ({wault:.1f}yr) — imminent income instability. Score capped at 30.",
            "cap": 30,
        })
        cap = min(cap, 30)

    # > 50% expected documents missing
    total = len(docs)
    completed = sum(1 for d in docs if d.get("processing_status") == "completed")
    if total > 0 and completed / total < 0.5:
        breakers.append({
            "severity": "warning",
            "message": f"Over 50% of documents have not been successfully processed ({completed}/{total}).",
            "cap": 35,
        })
        cap = min(cap, 35)

    # ≥3 orphaned amendments
    orphan_count = sum(
        1 for c in chains
        for d in (c.get("documents") or [])
        if d.get("is_orphaned")
    )
    if orphan_count >= 3:
        reduction = 20
        breakers.append({
            "severity": "warning",
            "message": f"{orphan_count} orphaned amendments without base leases — score reduced by {reduction} points.",
            "cap": None,
        })
        cap = max(0, cap - reduction)

    return cap, breakers


# ── Lease expiry timeline ────────────────────────────────────────────────────

def _build_expiry_timeline(metrics: dict) -> list[dict]:
    """Build annual expiry buckets for the lease expiry chart.

    Returns: [{"label": "Year 1", "period": "2025–2026", "rent": 50000, "count": 2, "pct": 25.0}, ...]
    """
    expiries = metrics.get("expiry_dates", [])
    if not expiries:
        return []

    today = date.today()
    total_rent = sum(e.get("rent") or 1.0 for e in expiries)

    buckets = []
    for i in range(6):
        if i < 5:
            year_start = date(today.year + i, today.month, min(today.day, 28))
            year_end = date(today.year + i + 1, today.month, min(today.day, 28))
            label = f"Year {i + 1}"
            period = f"{today.year + i}–{today.year + i + 1}"
        else:
            year_start = date(today.year + 5, today.month, min(today.day, 28))
            year_end = date(today.year + 50, 1, 1)  # far future
            label = "5+ years"
            period = f"{today.year + 5}+"

        bucket_expiries = [
            e for e in expiries
            if e["date"] >= year_start and e["date"] < year_end
        ]
        bucket_rent = sum(e.get("rent") or 1.0 for e in bucket_expiries)
        bucket_pct = (bucket_rent / total_rent * 100) if total_rent > 0 else 0

        buckets.append({
            "label": label,
            "period": period,
            "rent": bucket_rent,
            "count": len(bucket_expiries),
            "pct": round(bucket_pct, 1),
            "leases": [
                {"filename": e["filename"], "date": e["date"].isoformat(), "rent": e.get("rent") or 0}
                for e in bucket_expiries
            ],
        })

    return buckets


# ── Key metrics summary ─────────────────────────────────────────────────────

def _build_key_metrics(docs: list[dict], metrics: dict, wault: float | None) -> list[dict]:
    """Build list of key deal metrics for display."""
    key_metrics: list[dict] = []
    total = len(docs)
    completed = sum(1 for d in docs if d.get("processing_status") == "completed")

    key_metrics.append({
        "label": "Total Documents",
        "value": str(total),
        "icon": "files",
    })

    key_metrics.append({
        "label": "Processed",
        "value": f"{completed}/{total}",
        "icon": "check",
        "status": "green" if completed == total else ("amber" if completed > 0 else "red"),
    })

    # Lease count
    lease_count = metrics.get("lease_count", 0)
    key_metrics.append({
        "label": "Lease Documents",
        "value": str(lease_count),
        "icon": "file-pen-line",
    })

    # Tenant count
    tenant_count = len(metrics.get("tenants", []))
    if tenant_count > 0:
        key_metrics.append({
            "label": "Tenants Identified",
            "value": str(tenant_count),
            "icon": "users",
        })

    # WAULT
    if wault is not None:
        status = "green" if wault >= 7 else ("amber" if wault >= 3 else "red")
        key_metrics.append({
            "label": "WAULT",
            "value": f"{wault:.1f} years",
            "icon": "clock",
            "status": status,
        })

    # Signatures
    signed = sum(1 for d in docs if d.get("has_signature"))
    if signed > 0:
        key_metrics.append({
            "label": "Signed Documents",
            "value": f"{signed}/{total}",
            "icon": "pen-tool",
        })

    # Expiry dates found
    expiry_count = sum(1 for d in docs if d.get("expiry_date"))
    if expiry_count > 0:
        key_metrics.append({
            "label": "With Expiry Dates",
            "value": str(expiry_count),
            "icon": "calendar",
        })

    return key_metrics


# ── Document details for insight display ─────────────────────────────────────

def _build_document_insights(docs: list[dict]) -> list[dict]:
    """Build per-document insight summaries."""
    insights = []
    for doc in docs:
        if doc.get("processing_status") != "completed":
            continue
        if doc.get("is_empty"):
            continue

        entry: dict[str, Any] = {
            "id": doc["id"],
            "filename": doc["filename"],
            "category": doc.get("assigned_category", "other"),
            "confidence": doc.get("classification_confidence", 0),
            "summary": doc.get("summary"),
        }

        if doc.get("parties"):
            entry["parties"] = doc["parties"]
        if doc.get("key_terms"):
            entry["key_terms"] = doc["key_terms"]
        if doc.get("expiry_date"):
            entry["expiry_date"] = doc["expiry_date"]
        if doc.get("has_signature"):
            entry["has_signature"] = True
        if doc.get("has_seal"):
            entry["has_seal"] = True
        if doc.get("is_incomplete"):
            entry["is_incomplete"] = True
            entry["incompleteness_reasons"] = doc.get("incompleteness_reasons", [])

        insights.append(entry)

    return insights


# ── Main entry point ─────────────────────────────────────────────────────────

def compute_deal_insights(deal_id: str) -> dict:
    """Compute comprehensive AI insights for a deal.

    Returns a dict with:
      - risk_score: 0–100 composite score
      - risk_band: {key, label, color}
      - dimensions: {completeness, lease_risk, financial_risk} each with score and weight
      - circuit_breakers: list of triggered breakers
      - risk_drivers: top risk signals sorted by impact
      - missing_items: "What's Missing" checklist
      - key_metrics: summary statistics
      - expiry_timeline: annual lease expiry buckets
      - category_breakdown: document counts by category
      - document_insights: per-doc summaries with key data
    """
    sb = get_supabase()

    # Fetch all documents
    docs = (
        sb.table("documents")
        .select("*")
        .eq("deal_id", deal_id)
        .order("assigned_category")
        .execute()
    ).data or []

    # Fetch lease chains with documents
    chains_raw = (
        sb.table("lease_chains")
        .select("*, lease_chain_documents(*)")
        .eq("deal_id", deal_id)
        .execute()
    ).data or []

    # Normalize chain structure
    chains = []
    for c in chains_raw:
        chain_docs = c.get("lease_chain_documents") or []
        chains.append({
            "id": c["id"],
            "tenant_name": c.get("tenant_name", ""),
            "tenant_identifier": c.get("tenant_identifier"),
            "documents": chain_docs,
        })

    # Category counts
    categories: dict[str, int] = {}
    for d in docs:
        cat = d.get("assigned_category") or "other"
        categories[cat] = categories.get(cat, 0) + 1

    # ── Compute each dimension ────────────────────────────────────────────────

    completeness_score, missing_items, completeness_drivers = _compute_completeness(docs, chains, categories)

    lease_metrics = _extract_lease_metrics(docs)
    wault = _compute_wault(lease_metrics)
    lease_score, lease_drivers = _compute_lease_risk(docs)
    fin_score, fin_drivers = _compute_financial_risk(docs, lease_metrics)

    # ── Composite score ────────────────────────────────────────────────────────

    composite = (
        WEIGHT_COMPLETENESS * completeness_score +
        WEIGHT_LEASE_RISK * lease_score +
        WEIGHT_FINANCIAL_RISK * fin_score
    )

    # ── Circuit breakers ─────────────────────────────────────────────────────

    final_score, breakers = _apply_circuit_breakers(composite, docs, chains, categories, wault)

    # ── Collect all risk drivers, sort by impact ──────────────────────────────

    all_drivers = completeness_drivers + lease_drivers + fin_drivers
    # Put critical breakers first
    for b in breakers:
        all_drivers.insert(0, {
            "severity": b["severity"],
            "message": b["message"],
            "impact": -(composite - (b.get("cap") or composite)),
        })

    # Sort: critical first, then by absolute impact
    severity_order = {"critical": 0, "warning": 1, "info": 2, "positive": 3}
    all_drivers.sort(key=lambda d: (severity_order.get(d["severity"], 9), d.get("impact", 0)))

    # ── Build timeline & metrics ─────────────────────────────────────────────

    expiry_timeline = _build_expiry_timeline(lease_metrics)
    key_metrics = _build_key_metrics(docs, lease_metrics, wault)
    document_insights = _build_document_insights(docs)

    # ── Category breakdown ────────────────────────────────────────────────────

    category_breakdown = [
        {"category": cat, "count": count}
        for cat, count in sorted(categories.items(), key=lambda x: -x[1])
    ]

    return {
        "risk_score": round(final_score, 1),
        "risk_band": _get_risk_band(final_score),
        "dimensions": {
            "completeness": {
                "score": round(completeness_score, 1),
                "weight": WEIGHT_COMPLETENESS,
                "label": "Completeness",
            },
            "lease_risk": {
                "score": round(lease_score, 1),
                "weight": WEIGHT_LEASE_RISK,
                "label": "Lease Risk",
            },
            "financial_risk": {
                "score": round(fin_score, 1),
                "weight": WEIGHT_FINANCIAL_RISK,
                "label": "Financial Risk",
            },
        },
        "circuit_breakers": breakers,
        "risk_drivers": all_drivers[:10],  # top 10
        "missing_items": missing_items,
        "key_metrics": key_metrics,
        "wault": round(wault, 1) if wault is not None else None,
        "expiry_timeline": expiry_timeline,
        "category_breakdown": category_breakdown,
        "document_insights": document_insights,
        "total_documents": len(docs),
        "processed_documents": sum(1 for d in docs if d.get("processing_status") == "completed"),
    }
