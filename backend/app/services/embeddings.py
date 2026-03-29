"""OpenAI embedding generation and storage for document chunks."""

from __future__ import annotations

import logging

import psycopg2
from openai import OpenAI

from app.config import settings

logger = logging.getLogger(__name__)

EMBED_MODEL = "text-embedding-3-small"
EMBED_DIMENSIONS = 768        # matches vector(768) column in document_chunks
EMBED_BATCH_SIZE = 100        # texts per OpenAI API call

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Return one 768-dim embedding per input text (batched)."""
    client = _get_client()
    results: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = [t.replace("\x00", "") for t in texts[i : i + EMBED_BATCH_SIZE]]
        response = client.embeddings.create(
            model=EMBED_MODEL,
            input=batch,
            dimensions=EMBED_DIMENSIONS,
        )
        results.extend(item.embedding for item in response.data)
    return results


def _get_db_url() -> str:
    """Return a psycopg2-compatible connection URL (strip SQLAlchemy driver prefix)."""
    url = settings.database_url
    # SQLAlchemy may use "postgresql+psycopg2://" — strip the driver part
    if url.startswith("postgresql+"):
        url = "postgresql" + url[url.index("://"):]
    elif url.startswith("postgres://"):
        url = "postgresql" + url[len("postgres"):]
    return url


def embed_document_chunks(doc_id: str) -> int:
    """Generate and store OpenAI embeddings for all chunks of a document.

    Uses a direct psycopg2 connection to store the vector data with
    proper ``::vector`` casting — supabase PostgREST does not reliably
    cast JSON arrays to pgvector types.

    Returns the number of chunks embedded, or 0 if the doc has no chunks.
    """
    from app.db.client import get_supabase

    sb = get_supabase()
    rows = (
        sb.table("document_chunks")
        .select("id, content")
        .eq("document_id", doc_id)
        .execute()
    ).data

    if not rows:
        return 0

    texts = [r["content"] for r in rows]
    chunk_ids = [r["id"] for r in rows]

    embeddings = embed_texts(texts)

    # Bulk store via raw SQL with ::vector cast
    conn = psycopg2.connect(_get_db_url())
    try:
        with conn.cursor() as cur:
            data = [
                (f"[{','.join(str(x) for x in emb)}]", str(cid))
                for cid, emb in zip(chunk_ids, embeddings)
            ]
            cur.executemany(
                "UPDATE document_chunks SET embedding = %s::vector WHERE id = %s::uuid",
                data,
            )
        conn.commit()
    finally:
        conn.close()

    logger.info("Stored %d embeddings for document %s", len(rows), doc_id)
    return len(rows)


def search_chunks(
    query: str,
    deal_id: str,
    top_k: int = 8,
) -> list[dict]:
    """Embed *query* and return the top-k most similar chunks for a deal.

    Each result dict contains:
        - content: str          — the raw chunk text to inject into the chat prompt
        - score: float          — cosine similarity (0-1, higher = more relevant)
        - filename: str | None  — source document filename
        - category: str | None  — document category key
        - chunk_index: int      — position within the source document
        - document_id: str      — UUID of the source document
    """
    query_vec = embed_texts([query])[0]
    vec_str = f"[{','.join(str(x) for x in query_vec)}]"

    conn = psycopg2.connect(_get_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    dc.id,
                    dc.document_id,
                    dc.chunk_index,
                    dc.content,
                    dc.metadata,
                    1 - (dc.embedding <=> %s::vector) AS score
                FROM document_chunks dc
                WHERE dc.deal_id = %s::uuid
                  AND dc.embedding IS NOT NULL
                ORDER BY dc.embedding <=> %s::vector
                LIMIT %s
                """,
                (vec_str, deal_id, vec_str, top_k),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    results = []
    for row in rows:
        _id, doc_id, chunk_idx, content, metadata, score = row
        results.append({
            "content": content,
            "score": float(score),
            "filename": (metadata or {}).get("filename"),
            "category": (metadata or {}).get("category"),
            "chunk_index": chunk_idx,
            "document_id": str(doc_id),
        })
    return results
