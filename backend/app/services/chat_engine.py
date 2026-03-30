"""Chat engine with persistent history, query condensation, and deal-scoped RAG.

Implements the core patterns from LlamaIndex (CondenseQuestion + VectorRetrieval)
directly using the existing OpenAI SDK and pgvector setup — no extra dependencies.

Architecture:
    User message → load history → condense query with history → vector search →
    build deal overview + chunk context → return enriched context + sources →
    frontend streams GPT-4o → save exchange
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from openai import OpenAI

from app.config import settings
from app.db.client import get_supabase
from app.services.embeddings import search_chunks
from app.services.deal_insights import compute_deal_insights

logger = logging.getLogger(__name__)

# ── OpenAI client (reuse from embeddings module if available) ────────────────

_llm: OpenAI | None = None


def _get_llm() -> OpenAI:
    global _llm
    if _llm is None:
        _llm = OpenAI(api_key=settings.openai_api_key)
    return _llm


# Max history turns to load for condensation (user+assistant pairs)
MAX_HISTORY_TURNS = 10
# Vec search top_k
DEFAULT_TOP_K = 12

# ── Prompts ──────────────────────────────────────────────────────────────────

CONDENSE_SYSTEM = (
    "You are a query rewriter for a document search system. "
    "Given a conversation history and the user's new message, produce a "
    "single standalone search query that captures the full intent — including "
    "any entities, dates, or details referenced earlier in the conversation. "
    "Output ONLY the rewritten query, nothing else."
)

TITLE_PROMPT = (
    "Generate a concise, descriptive title (max 7 words) for a document analysis "
    "chat session based on the user's question(s) below.\n"
    "Rules: be specific, no quotes, no trailing punctuation, output ONLY the title.\n\n"
    "Questions:\n{questions}"
)

CONDENSE_USER = """Conversation history:
{history}

New user message: {question}

Rewritten standalone query:"""


# ── Query condensation ───────────────────────────────────────────────────────


def condense_question(question: str, history: list[dict]) -> str:
    """Rewrite *question* into a standalone query using conversation history.

    Uses GPT-4o-mini for speed + cost efficiency. If there's no history,
    returns the original question unchanged.
    """
    if not history:
        return question

    # Format recent history (last N turns)
    recent = history[-(MAX_HISTORY_TURNS * 2):]
    hist_lines = []
    for msg in recent:
        role = msg["role"].capitalize()
        # Truncate long assistant messages to avoid blowing up the prompt
        content = msg["content"]
        if role == "Assistant" and len(content) > 500:
            content = content[:500] + "…"
        hist_lines.append(f"{role}: {content}")
    hist_text = "\n".join(hist_lines)

    try:
        client = _get_llm()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": CONDENSE_SYSTEM},
                {"role": "user", "content": CONDENSE_USER.format(
                    history=hist_text, question=question
                )},
            ],
            temperature=0,
            max_tokens=300,
        )
        condensed = response.choices[0].message.content.strip()
        if condensed:
            logger.debug("Condensed query: %r → %r", question, condensed)
            return condensed
    except Exception as exc:
        logger.warning("Query condensation failed, using original: %s", exc)

    return question


# ── Session management ───────────────────────────────────────────────────────


def load_history(session_id: str) -> list[dict]:
    """Load chat messages for a session, ordered chronologically."""
    sb = get_supabase()
    result = (
        sb.table("chat_messages")
        .select("role, content")
        .eq("session_id", session_id)
        .order("created_at")
        .limit(MAX_HISTORY_TURNS * 2)
        .execute()
    )
    return result.data or []


def get_or_create_session(
    deal_id: str, user_id: str, session_id: str | None = None
) -> str:
    """Return an existing session ID or create a new one.

    If *session_id* is provided and belongs to this deal+user, reuse it.
    If *session_id* is provided but doesn't exist yet, create it with that ID
    (allows the frontend to pre-generate UUIDs for session continuity).
    """
    sb = get_supabase()
    if session_id:
        # Verify session belongs to this deal + user
        existing = (
            sb.table("chat_sessions")
            .select("id")
            .eq("id", session_id)
            .eq("deal_id", deal_id)
            .eq("user_id", user_id)
            .execute()
        )
        if existing.data:
            return session_id
        # Session ID provided but doesn't exist — create with that ID
        try:
            sb.table("chat_sessions").insert({
                "id": session_id,
                "deal_id": deal_id,
                "user_id": user_id,
            }).execute()
            return session_id
        except Exception:
            # Race condition or invalid UUID — fall through to auto-generate
            pass

    row = (
        sb.table("chat_sessions")
        .insert({
            "deal_id": deal_id,
            "user_id": user_id,
        })
        .execute()
    )
    return row.data[0]["id"]


def save_message(session_id: str, role: str, content: str, sources: list | None = None) -> str:
    """Persist a single chat message and update session timestamp."""
    sb = get_supabase()
    row = (
        sb.table("chat_messages")
        .insert({
            "session_id": session_id,
            "role": role,
            "content": content,
            "sources": sources,
        })
        .execute()
    )
    # Touch session updated_at
    sb.table("chat_sessions").update({
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", session_id).execute()
    return row.data[0]["id"]


def set_session_title(session_id: str, title: str) -> None:
    """Set the session title."""
    sb = get_supabase()
    sb.table("chat_sessions").update({
        "title": title[:200],
    }).eq("id", session_id).execute()


def generate_session_title(questions: list[str]) -> str:
    """Use GPT-4o-mini to produce a short descriptive title from user questions.

    Falls back to a truncated version of the first question on any error.
    """
    fallback = questions[0][:80].strip() if questions else "Chat"
    try:
        client = _get_llm()
        numbered = "\n".join(f"{i+1}. {q}" for i, q in enumerate(questions[:10]))
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": TITLE_PROMPT.format(questions=numbered)},
            ],
            temperature=0.3,
            max_tokens=30,
        )
        title = response.choices[0].message.content.strip().strip('"').strip("'")
        if title:
            logger.debug("Generated session title: %r", title)
            return title
    except Exception as exc:
        logger.warning("Title generation failed: %s", exc)
    return fallback


def maybe_update_title(session_id: str, msg_count_before_save: int) -> None:
    """Update the session title after the 1st or 5th user exchange.

    *msg_count_before_save* is the total message count (user + assistant)
    in the session BEFORE the current pair was saved.
      - 0  → this is the 1st exchange → generate from first question
      - 8  → this is the 5th exchange → regenerate from all 5 questions
    """
    # Exchange number = msg_count_before_save // 2 + 1
    # trigger at exchange 1 (count 0) and exchange 5 (count 8)
    if msg_count_before_save not in (0, 8):
        return
    try:
        sb = get_supabase()
        rows = (
            sb.table("chat_messages")
            .select("content")
            .eq("session_id", session_id)
            .eq("role", "user")
            .order("created_at")
            .execute()
        )
        questions = [r["content"] for r in (rows.data or [])]
        if not questions:
            return
        title = generate_session_title(questions)
        set_session_title(session_id, title)
    except Exception as exc:
        logger.warning("maybe_update_title failed for session %s: %s", session_id, exc)


# ── Main RAG context function ────────────────────────────────────────────────


def _fmt_size(bytes_: int | None) -> str:
    if not bytes_:
        return "unknown size"
    for unit in ("B", "KB", "MB", "GB"):
        if bytes_ < 1024:
            return f"{bytes_:.0f} {unit}"
        bytes_ /= 1024
    return f"{bytes_:.1f} GB"


def _build_folder_tree(docs: list[dict], cat_label_fn=None) -> str:
    """Render an ASCII folder tree from original_path values.

    Example output:
        ## Folder Structure
        Contract Docs/  (8 files)
          ├── COE-Sample.pdf  [Corporate & Legal · 35 KB]
          ├── exhibit101.pdf  [Corporate & Legal · 160 KB]
          └── Davies-Table-2.jpg  [Technical / Environmental · 74 KB]
        Financials/  (2 files)
          └── ...
        (root)/  (1 file)
          └── standalone.pdf  [Other · 12 KB]
    """
    import posixpath

    # Group by folder (everything before the last "/")
    folders: dict[str, list[dict]] = {}
    for doc in docs:
        path = (doc.get("original_path") or doc.get("filename") or "").replace("\\", "/")
        parts = path.rsplit("/", 1)
        folder = parts[0] if len(parts) == 2 else "(root)"
        folders.setdefault(folder, []).append(doc)

    if not folders:
        return ""

    def _label(key: str) -> str:
        if cat_label_fn:
            return cat_label_fn(key)
        fallback: dict[str, str] = {
            "financial": "Financial",
            "technical_environmental": "Technical / Environmental",
            "leases_amendments": "Leases & Amendments",
            "corporate_legal": "Corporate & Legal",
            "other": "Other",
        }
        return fallback.get(key, key)

    lines = ["## Folder Structure"]
    for folder in sorted(folders):
        folder_docs = folders[folder]
        lines.append(f"\n{folder}/  ({len(folder_docs)} file{'s' if len(folder_docs) != 1 else ''})")
        for i, doc in enumerate(folder_docs):
            connector = "└──" if i == len(folder_docs) - 1 else "├──"
            cat = _label(doc.get("assigned_category") or "other")
            size_str = _fmt_size(doc.get("file_size"))
            status = doc.get("processing_status", "")
            status_tag = f" ⚠ {status}" if status not in ("completed", "") else ""
            incomplete_tag = " [incomplete]" if doc.get("is_incomplete") else ""
            empty_tag = " [empty]" if doc.get("is_empty") else ""
            lines.append(f"  {connector} {doc['filename']}  [{cat} · {size_str}]{status_tag}{incomplete_tag}{empty_tag}")

    return "\n".join(lines)


def _build_deal_overview(deal_id: str) -> str:
    """Build a structured document inventory from the full documents table.

    Includes:
      - Company classification categories (authoritative list)
      - Deal-level summary (totals, category breakdown, completeness)
      - Per-document metadata: file type, size, classification confidence/reasoning,
        completeness flags, parties, key terms, expiry, signatures/seals, summary.
    All documents are included so the LLM can answer questions about the full
    data room (counts, failures, pending files, etc.).
    """
    sb = get_supabase()

    # ── Resolve company classifications ──────────────────────────────────────
    deal_row = (
        sb.table("deals")
        .select("company_id")
        .eq("id", deal_id)
        .limit(1)
        .execute()
    ).data
    company_id = deal_row[0].get("company_id") if deal_row else None

    cat_label_map: dict[str, str] = {}   # key → human label
    cat_desc_map: dict[str, str] = {}    # key → description
    if company_id:
        clf_rows = (
            sb.table("company_classifications")
            .select("key, label, description")
            .eq("company_id", company_id)
            .eq("is_active", True)
            .order("display_order")
            .execute()
        ).data or []
        for c in clf_rows:
            cat_label_map[c["key"]] = c["label"]
            if c.get("description"):
                cat_desc_map[c["key"]] = c["description"]

    def _cat_label(key: str) -> str:
        return cat_label_map.get(key, key)

    docs = (
        sb.table("documents")
        .select(
            "filename, original_path, file_type, file_extension, file_size, "
            "assigned_category, classification_confidence, classification_reasoning, "
            "processing_status, is_empty, is_incomplete, incompleteness_reasons, "
            "summary, key_terms, parties, expiry_date, "
            "has_signature, has_seal, rag_indexed"
        )
        .eq("deal_id", deal_id)
        .order("assigned_category")
        .execute()
    ).data or []

    if not docs:
        return ""

    # ── Deal-level summary ────────────────────────────────────────────────────
    total = len(docs)
    completed = [d for d in docs if d.get("processing_status") == "completed"]
    pending   = [d for d in docs if d.get("processing_status") in ("pending", "processing")]
    failed    = [d for d in docs if d.get("processing_status") == "failed"]
    empty     = [d for d in docs if d.get("is_empty")]
    incomplete = [d for d in docs if d.get("is_incomplete")]
    rag_done  = [d for d in docs if d.get("rag_indexed")]

    total_bytes = sum(d.get("file_size") or 0 for d in docs)

    # Category breakdown (completed only)
    cat_counts: dict[str, int] = {}
    for d in completed:
        cat = d.get("assigned_category") or "other"
        cat_counts[cat] = cat_counts.get(cat, 0) + 1

    lines: list[str] = [
        "## Data Room Document Inventory",
    ]

    # ── Company classification categories (authoritative) ────────────────────
    if cat_label_map:
        lines.append("")
        lines.append("### Document Classification Categories")
        lines.append("These are the ONLY valid classification categories for this data room. "
                     "When discussing document types or classifications, use ONLY these names:")
        for key in cat_label_map:
            desc_part = f" — {cat_desc_map[key]}" if key in cat_desc_map else ""
            lines.append(f"  - **{cat_label_map[key]}**{desc_part}")
        lines.append("")

    lines.extend([
        f"- Total files: {total}  |  Total size: {_fmt_size(total_bytes)}",
        f"- Processed: {len(completed)}  |  RAG-indexed: {len(rag_done)}  "
        f"|  Pending/processing: {len(pending)}  |  Failed: {len(failed)}",
    ])
    if incomplete:
        lines.append(f"- Incomplete documents: {len(incomplete)}")
    if empty:
        lines.append(f"- Empty/unreadable files: {len(empty)}")
    if cat_counts:
        breakdown = ", ".join(
            f"{_cat_label(cat)}: {cnt}" for cat, cnt in sorted(cat_counts.items(), key=lambda x: -x[1])
        )
        lines.append(f"- Classification breakdown: {breakdown}")
    lines.append("")

    # ── Folder structure ──────────────────────────────────────────────────────
    folder_tree = _build_folder_tree(docs, cat_label_fn=_cat_label)
    if folder_tree:
        lines.append(folder_tree)
        lines.append("")

    # ── Per-document details ─────────────────────────────────────────────────
    # Group: completed first (by category), then pending, then failed
    def _sort_key(d: dict):
        order = {"completed": 0, "processing": 1, "pending": 2, "failed": 3}
        return (order.get(d.get("processing_status", ""), 9), d.get("assigned_category") or "")

    for doc in sorted(docs, key=_sort_key):
        status = doc.get("processing_status", "unknown")
        cat = _cat_label(doc.get("assigned_category") or "other")
        ftype = doc.get("file_type") or doc.get("file_extension") or "unknown"
        size_str = _fmt_size(doc.get("file_size"))
        conf = doc.get("classification_confidence") or 0

        header_parts = [f"**{doc['filename']}**"]
        header_parts.append(f"[{ftype} · {size_str} · {cat}]")
        if status != "completed":
            header_parts.append(f"[status: {status}]")
        lines.append(" ".join(header_parts))

        if status == "completed":
            if conf:
                lines.append(f"  Classification confidence: {conf:.0%}")
            reasoning = doc.get("classification_reasoning")
            if reasoning:
                lines.append(f"  Classification reasoning: {reasoning}")
            if doc.get("is_incomplete"):
                reasons = doc.get("incompleteness_reasons") or []
                reason_str = "; ".join(reasons) if isinstance(reasons, list) else str(reasons)
                lines.append(f"  ⚠ Incomplete: {reason_str or 'yes'}")
            if doc.get("is_empty"):
                lines.append("  ⚠ Empty/unreadable file")
            if doc.get("summary"):
                lines.append(f"  Summary: {doc['summary']}")
            if doc.get("parties"):
                lines.append(f"  Parties: {', '.join(doc['parties'])}")
            if doc.get("key_terms"):
                terms = "; ".join(f"{k}: {v}" for k, v in doc["key_terms"].items())
                lines.append(f"  Key terms: {terms}")
            if doc.get("expiry_date"):
                lines.append(f"  Expiry date: {doc['expiry_date']}")
            flags = []
            if doc.get("has_signature"):
                flags.append("signed")
            if doc.get("has_seal"):
                flags.append("sealed")
            if flags:
                lines.append(f"  Document flags: {', '.join(flags)}")
        elif status == "failed":
            lines.append("  Processing failed — content not available for search")

        lines.append("")  # blank line between docs

    return "\n".join(lines)


def _build_insights_context(deal_id: str) -> str:
    """Build a text summary of AI insights for the chat context."""
    try:
        insights = compute_deal_insights(deal_id)
    except Exception as exc:
        logger.warning("Failed to compute insights for chat context: %s", exc)
        return ""

    lines = [
        "## AI Deal Insights & Risk Scoring",
        "",
        "### Methodology",
        "The Deal Risk Score is computed using a three-dimension weighted model:",
        "  1. **Completeness Score** (30% weight) — measures % of expected deal documents present,",
        "     tiered by criticality (Tier 1 critical: legal title, leases, financials;",
        "     Tier 2 important: building survey, valuations; Tier 3 standard: planning, env reports).",
        "  2. **Lease Risk Score** (45% weight) — computed from WAULT (Weighted Average Unexpired",
        "     Lease Term) with a non-linear decay curve, adjusted for break option exposure,",
        "     void rates, tenant distress signals (CVA/administration), and near-term expiry concentration.",
        "  3. **Financial Risk Score** (25% weight) — assesses DSCR (Debt Service Cover Ratio),",
        "     NOI trajectory, valuation recency, and rent passing vs ERV gap.",
        "  Circuit breakers cap the maximum score in extreme cases: zero leases (cap 15),",
        "  WAULT < 6 months (cap 30), missing legal documents (cap 25).",
        "",
    ]

    # Risk score
    score = insights.get("risk_score", 0)
    band = insights.get("risk_band", {})
    lines.append(f"### Deal Risk Score: {score:.0f}/100 — {band.get('label', 'Unknown')}")
    lines.append(f"Band: {band.get('description', '')}")
    lines.append("")

    # Dimension breakdown
    dims = insights.get("dimensions", {})
    if dims:
        lines.append("### Dimension Breakdown")
        for key, dim in dims.items():
            lines.append(f"  - {dim['label']}: {dim['score']:.0f}/100 (weight: {dim['weight']:.0%}, weighted contribution: {dim['score'] * dim['weight']:.1f} pts)")
        lines.append("")

    # WAULT
    wault = insights.get("wault")
    if wault is not None:
        lines.append(f"### WAULT: {wault:.2f} years")
        lines.append("  (Weighted Average Unexpired Lease Term — each lease weighted by its passing rent)")
        lines.append("")

    # Circuit breakers
    breakers = insights.get("circuit_breakers", [])
    if breakers:
        lines.append("### Circuit Breakers Triggered")
        for b in breakers:
            lines.append(f"  ⚠ [{b.get('type','').upper()}] {b['message']} → score capped at {b.get('cap', '?')}")
        lines.append("")

    # Top risk drivers
    drivers = insights.get("risk_drivers", [])
    if drivers:
        lines.append("### Key Risk Signals (algorithmic detections)")
        for d in drivers[:8]:
            icon = "🔴" if d["severity"] == "critical" else "🟡" if d["severity"] == "warning" else "🟢" if d["severity"] == "positive" else "ℹ️"
            lines.append(f"  {icon} [{d['severity'].upper()}] {d['message']}")
        lines.append("")

    # What's missing
    missing = insights.get("missing_items", [])
    if missing:
        lines.append("### What's Missing (checklist of expected documents)")
        lines.append("  Tier 1 = Critical (blocks deal); Tier 2 = Important; Tier 3 = Standard")
        for m in missing:
            tier_label = {1: "CRITICAL", 2: "IMPORTANT", 3: "STANDARD"}.get(m["tier"], "")
            lines.append(f"  - [Tier {m['tier']} — {tier_label}] {m['message']}")
        lines.append("")

    # Lease chain summary
    lease_chains = insights.get("lease_chain_summary")
    if lease_chains:
        lines.append("### Lease Amendment Chain Analysis")
        lines.append("  Built using regex document classification + Levenshtein fuzzy tenant matching.")
        lines.append(f"  - Total chains: {lease_chains.get('total_chains', 0)}")
        lines.append(f"  - Chains with base lease: {lease_chains.get('with_base_lease', 0)}")
        lines.append(f"  - Orphaned amendments (no base lease): {lease_chains.get('orphaned_count', 0)}")
        lines.append("")

    # Expiry timeline
    timeline = insights.get("expiry_timeline", [])
    if timeline and any(b["count"] > 0 for b in timeline):
        lines.append("### Lease Expiry Timeline (% of passing rent)")
        for b in timeline:
            if b["count"] > 0:
                bar = "█" * max(1, int(b["pct"] / 5))
                lines.append(f"  {b['label']} ({b['period']}): {b['pct']:.0f}% of rent — {b['count']} lease(s) {bar}")
        lines.append("")

    return "\n".join(lines)


def get_chat_context(
    deal_id: str,
    user_id: str,
    query: str,
    session_id: str | None = None,
    top_k: int = DEFAULT_TOP_K,
) -> dict:
    """Full RAG pipeline with history-aware retrieval.

    1. Get or create a session
    2. Load conversation history from DB
    3. Condense the query using history (so follow-ups work)
    4. Vector search with the condensed query
    5. Return enriched context + metadata

    Returns:
        {
            "session_id": str,
            "context": str,           — formatted chunk text for system prompt
            "sources": list[dict],     — source metadata for citations
            "condensed_query": str,    — the rewritten query (for debugging)
            "has_data": bool,          — whether any chunks were found
        }
    """
    # 1. Session
    sid = get_or_create_session(deal_id, user_id, session_id)

    # 2. History
    history = load_history(sid) if session_id else []

    # 3. Condense
    condensed = condense_question(query, history)

    # 4. Retrieve
    chunks = search_chunks(query=condensed, deal_id=deal_id, top_k=top_k)

    # 5. Format
    if not chunks:
        # Even without chunk hits, the deal overview is still useful
        overview = _build_deal_overview(deal_id)
        insights_ctx = _build_insights_context(deal_id)
        context_parts = [p for p in [overview, insights_ctx] if p]
        return {
            "session_id": sid,
            "context": "\n\n---\n\n".join(context_parts) if context_parts else "",
            "sources": [],
            "condensed_query": condensed,
            "has_data": bool(context_parts),
        }

    # Deal overview (summaries + key terms for all docs)
    overview = _build_deal_overview(deal_id)
    insights_ctx = _build_insights_context(deal_id)

    lines = []
    for i, c in enumerate(chunks):
        src = f" [{c['filename']}]" if c.get("filename") else ""
        title = f" — {c['title']}" if c.get("title") else ""
        topic = f" (topic: {c['topic']})" if c.get("topic") else ""
        lines.append(
            f"### Chunk {i + 1}{src}{title}{topic} (relevance: {c['score'] * 100:.0f}%)\n{c['content']}"
        )

    context_parts = []
    if overview:
        context_parts.append(overview)
    if insights_ctx:
        context_parts.append(insights_ctx)
    context_parts.append(
        "## Retrieved Document Excerpts\n\n"
        + "\n\n".join(lines)
    )
    context = "\n\n---\n\n".join(context_parts)

    sources = [
        {
            "filename": c.get("filename"),
            "category": c.get("category"),
            "score": round(c["score"], 3),
            "document_id": c["document_id"],
        }
        for c in chunks
    ]

    return {
        "session_id": sid,
        "context": context,
        "sources": sources,
        "condensed_query": condensed,
        "has_data": True,
    }


def list_sessions(deal_id: str, user_id: str) -> list[dict]:
    """Return all chat sessions for a deal + user, newest first."""
    sb = get_supabase()
    result = (
        sb.table("chat_sessions")
        .select("id, title, created_at, updated_at")
        .eq("deal_id", deal_id)
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return result.data or []


def get_session_messages(session_id: str, deal_id: str, user_id: str) -> list[dict]:
    """Return all messages for a session (with ownership verification)."""
    sb = get_supabase()
    # Verify ownership
    session = (
        sb.table("chat_sessions")
        .select("id")
        .eq("id", session_id)
        .eq("deal_id", deal_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not session.data:
        return []

    result = (
        sb.table("chat_messages")
        .select("id, role, content, sources, created_at")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
    )
    return result.data or []
