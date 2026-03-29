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
    """Set the session title (typically from the first user message)."""
    sb = get_supabase()
    sb.table("chat_sessions").update({
        "title": title[:200],
    }).eq("id", session_id).execute()


# ── Main RAG context function ────────────────────────────────────────────────


def _build_deal_overview(deal_id: str) -> str:
    """Build a concise deal overview from document summaries, key terms, and parties.

    This gives the LLM a high-level understanding of the deal before it sees
    the specific retrieved chunks — dramatically improving its ability to
    answer aggregate questions like "list all parties" or "what are the key dates".
    """
    sb = get_supabase()
    docs = (
        sb.table("documents")
        .select("filename, assigned_category, summary, key_terms, parties, expiry_date, has_signature, is_empty")
        .eq("deal_id", deal_id)
        .eq("processing_status", "completed")
        .eq("is_empty", False)
        .order("assigned_category")
        .execute()
    ).data or []

    if not docs:
        return ""

    sections = []
    sections.append(f"## Deal Overview ({len(docs)} processed documents)\n")

    for doc in docs:
        parts = [f"**{doc['filename']}** ({doc.get('assigned_category', 'other')})"]
        if doc.get("summary"):
            parts.append(f"  Summary: {doc['summary']}")
        if doc.get("parties"):
            parts.append(f"  Parties: {', '.join(doc['parties'])}")
        if doc.get("key_terms"):
            terms = "; ".join(f"{k}: {v}" for k, v in doc["key_terms"].items())
            parts.append(f"  Key terms: {terms}")
        if doc.get("expiry_date"):
            parts.append(f"  Expiry: {doc['expiry_date']}")
        if doc.get("has_signature"):
            parts.append("  Contains signatures: Yes")
        sections.append("\n".join(parts))

    return "\n\n".join(sections)


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
        return {
            "session_id": sid,
            "context": overview,
            "sources": [],
            "condensed_query": condensed,
            "has_data": bool(overview),
        }

    # Deal overview (summaries + key terms for all docs)
    overview = _build_deal_overview(deal_id)

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
