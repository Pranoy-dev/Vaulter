"""Unified Gemini document processor — extraction + classification + completeness in one call."""

from __future__ import annotations

import io
import logging
import os
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from app.config import settings
from app.db.client import get_supabase
from app.services.text_extractor import extract_text as local_extract_text

logger = logging.getLogger(__name__)

# ── Gemini client (lazy singleton) ───────────────────────────────────────────

_client: genai.Client | None = None

MAX_PDF_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_PDF_PAGES = 1000
PAGES_PER_SEGMENT = 500  # split large PDFs at this page count
GEMINI_MODEL = "gemini-2.5-flash"


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


# ── Pydantic schema for Gemini structured output ────────────────────────────


class DocumentAnalysis(BaseModel):
    """Structured output returned by Gemini for every document."""
    extracted_text: str = Field(description="Full text content extracted from the document.")
    category_key: str = Field(description="Classification category key from the provided list, or 'other'.")
    classification_confidence: float = Field(
        description="Confidence score for the classification, between 0.0 and 1.0."
    )
    classification_reasoning: str = Field(
        description="Brief explanation of why this category was chosen."
    )
    is_incomplete: bool = Field(
        description="Whether the document appears incomplete or has quality issues."
    )
    incompleteness_reasons: list[str] = Field(
        description="List of specific reasons the document is incomplete, empty if complete."
    )


class TextAnalysis(BaseModel):
    """Structured output for text-only documents (no extraction needed)."""
    category_key: str = Field(description="Classification category key from the provided list, or 'other'.")
    classification_confidence: float = Field(
        description="Confidence score for the classification, between 0.0 and 1.0."
    )
    classification_reasoning: str = Field(
        description="Brief explanation of why this category was chosen."
    )
    is_incomplete: bool = Field(
        description="Whether the document appears incomplete or has quality issues."
    )
    incompleteness_reasons: list[str] = Field(
        description="List of specific reasons the document is incomplete, empty if complete."
    )


# ── Result dataclass ────────────────────────────────────────────────────────


@dataclass
class ProcessingResult:
    extracted_text: str = ""
    category_key: str = "other"
    classification_confidence: float = 0.0
    classification_reasoning: str = ""
    is_incomplete: bool = False
    incompleteness_reasons: list[str] = field(default_factory=list)
    error: str | None = None


# ── Prompt builders ──────────────────────────────────────────────────────────


def _build_categories_block(categories: list[dict]) -> str:
    """Format company categories for the prompt."""
    if not categories:
        return 'No categories defined. Use "other" as category_key.'
    lines = []
    for cat in categories:
        desc = f' — {cat["description"]}' if cat.get("description") else ""
        lines.append(f'- key: "{cat["key"]}", label: "{cat["label"]}"{desc}')
    lines.append('- key: "other", label: "Other" — use if none of the above fit')
    return "\n".join(lines)


_SYSTEM_INSTRUCTION = (
    "You are a document analysis expert for commercial real estate data rooms. "
    "You analyze documents to extract text, classify them into categories, and check for completeness."
)


def _build_full_prompt(categories_block: str, filename: str) -> str:
    """Prompt for Path A — Gemini sees the PDF/image directly."""
    return f"""Analyze this document (filename: "{filename}").

Perform ALL of the following tasks in a single pass:

1. **Text Extraction**: Extract all readable text from the document, preserving paragraph structure.
2. **Classification**: Classify this document into one of the following categories:
{categories_block}
3. **Completeness Check**: Determine if the document is incomplete. Look for:
   - Missing signature pages
   - Missing dates or execution dates
   - Incomplete sections or cut-off text
   - Blank or mostly-blank pages
   - Poor scan quality making text unreadable
   - Missing pages (e.g. page numbering gaps)
   - Draft watermarks without final version

Return your analysis as structured JSON."""


def _build_text_only_prompt(categories_block: str, filename: str, text: str) -> str:
    """Prompt for Path B — Gemini classifies pre-extracted text."""
    # Truncate very long texts to stay within context limits
    max_chars = 500_000
    truncated = text[:max_chars] if len(text) > max_chars else text
    return f"""Analyze this document text (filename: "{filename}").

The text below was extracted from a non-PDF file. Perform the following tasks:

1. **Classification**: Classify this document into one of the following categories:
{categories_block}
2. **Completeness Check**: Determine if the document appears incomplete. Look for:
   - Missing sections or abruptly ending content
   - Placeholder text or template markers
   - References to attachments or exhibits not present

Document text:
---
{truncated}
---

Return your analysis as structured JSON."""


def _build_segment_extraction_prompt() -> str:
    """Prompt for Path C segment — extract text only."""
    return (
        "Extract all readable text from this document segment, preserving paragraph structure. "
        "Return only the extracted text, nothing else."
    )


# ── Core processing function ────────────────────────────────────────────────


def process_document(document: dict, company_categories: list[dict]) -> ProcessingResult:
    """Process a single document through Gemini.

    Routes to the appropriate path based on file type and size:
    - Path A: PDF/images → Gemini sees the file directly (extraction + classification + completeness)
    - Path B: DOCX/XLSX/etc → local extraction, then Gemini for classification + completeness
    - Path C: Large PDFs → split into segments, extract per segment, then classify merged text

    Args:
        document: Dict with keys: id, filename, file_extension, file_size, storage_path
        company_categories: List of dicts with keys: key, label, description
    """
    ext = (document.get("file_extension") or "").lower().lstrip(".")
    file_size = document.get("file_size", 0)
    filename = document.get("filename", "unknown")

    try:
        if ext in ("pdf",):
            if file_size <= MAX_PDF_SIZE:
                return _process_pdf_direct(document, company_categories)
            else:
                return _process_pdf_large(document, company_categories)
        elif ext in ("png", "jpg", "jpeg", "gif", "tiff", "bmp", "webp"):
            return _process_image_direct(document, company_categories)
        elif ext in ("docx", "xlsx", "pptx", "txt", "csv", "eml"):
            return _process_text_file(document, company_categories)
        else:
            return ProcessingResult(
                category_key="other",
                classification_confidence=0.0,
                classification_reasoning=f"Unsupported file type: .{ext}",
            )
    except Exception as exc:
        logger.exception("Gemini processing failed for document %s", document.get("id"))
        return ProcessingResult(error=str(exc))


# ── Path A: PDF direct (≤50MB) ──────────────────────────────────────────────


def _process_pdf_direct(document: dict, categories: list[dict]) -> ProcessingResult:
    """Upload PDF to Gemini and get extraction + classification + completeness in one call."""
    sb = get_supabase()
    file_bytes = sb.storage.from_("dataroom-files").download(document["storage_path"])

    client = _get_client()
    categories_block = _build_categories_block(categories)
    prompt = _build_full_prompt(categories_block, document["filename"])

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[
            types.Part.from_bytes(data=file_bytes, mime_type="application/pdf"),
            prompt,
        ],
        config={
            "system_instruction": _SYSTEM_INSTRUCTION,
            "response_mime_type": "application/json",
            "response_json_schema": DocumentAnalysis.model_json_schema(),
        },
    )

    analysis = DocumentAnalysis.model_validate_json(response.text)
    return ProcessingResult(
        extracted_text=analysis.extracted_text,
        category_key=analysis.category_key,
        classification_confidence=analysis.classification_confidence,
        classification_reasoning=analysis.classification_reasoning,
        is_incomplete=analysis.is_incomplete,
        incompleteness_reasons=analysis.incompleteness_reasons,
    )


# ── Path A variant: Image direct ────────────────────────────────────────────


def _process_image_direct(document: dict, categories: list[dict]) -> ProcessingResult:
    """Upload image to Gemini for OCR + classification + completeness."""
    sb = get_supabase()
    file_bytes = sb.storage.from_("dataroom-files").download(document["storage_path"])

    ext = (document.get("file_extension") or "").lower().lstrip(".")
    mime_map = {
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "gif": "image/gif", "tiff": "image/tiff", "bmp": "image/bmp",
        "webp": "image/webp",
    }
    mime_type = mime_map.get(ext, "application/octet-stream")

    client = _get_client()
    categories_block = _build_categories_block(categories)
    prompt = _build_full_prompt(categories_block, document["filename"])

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            prompt,
        ],
        config={
            "system_instruction": _SYSTEM_INSTRUCTION,
            "response_mime_type": "application/json",
            "response_json_schema": DocumentAnalysis.model_json_schema(),
        },
    )

    analysis = DocumentAnalysis.model_validate_json(response.text)
    return ProcessingResult(
        extracted_text=analysis.extracted_text,
        category_key=analysis.category_key,
        classification_confidence=analysis.classification_confidence,
        classification_reasoning=analysis.classification_reasoning,
        is_incomplete=analysis.is_incomplete,
        incompleteness_reasons=analysis.incompleteness_reasons,
    )


# ── Path B: Text-based files (DOCX/XLSX/PPTX/TXT/CSV/EML) ──────────────────


def _process_text_file(document: dict, categories: list[dict]) -> ProcessingResult:
    """Extract text locally, then send to Gemini for classification + completeness."""
    sb = get_supabase()
    file_bytes = sb.storage.from_("dataroom-files").download(document["storage_path"])
    ext = (document.get("file_extension") or "").lower().lstrip(".")

    # Local text extraction
    extracted_text = local_extract_text(file_bytes, ext)
    if not extracted_text.strip():
        return ProcessingResult(
            extracted_text="",
            category_key="other",
            classification_confidence=0.0,
            classification_reasoning="No text could be extracted from this file.",
            is_incomplete=True,
            incompleteness_reasons=["File appears empty or unreadable"],
        )

    client = _get_client()
    categories_block = _build_categories_block(categories)
    prompt = _build_text_only_prompt(categories_block, document["filename"], extracted_text)

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[prompt],
        config={
            "system_instruction": _SYSTEM_INSTRUCTION,
            "response_mime_type": "application/json",
            "response_json_schema": TextAnalysis.model_json_schema(),
        },
    )

    analysis = TextAnalysis.model_validate_json(response.text)
    return ProcessingResult(
        extracted_text=extracted_text,
        category_key=analysis.category_key,
        classification_confidence=analysis.classification_confidence,
        classification_reasoning=analysis.classification_reasoning,
        is_incomplete=analysis.is_incomplete,
        incompleteness_reasons=analysis.incompleteness_reasons,
    )


# ── Path C: Large PDF (>50MB) — segment splitting ───────────────────────────


def _split_pdf(content: bytes, pages_per_segment: int = PAGES_PER_SEGMENT) -> list[bytes]:
    """Split a PDF into segments of at most `pages_per_segment` pages."""
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(content))
    total_pages = len(reader.pages)
    segments: list[bytes] = []

    for start in range(0, total_pages, pages_per_segment):
        end = min(start + pages_per_segment, total_pages)
        writer = PdfWriter()
        for page_idx in range(start, end):
            writer.add_page(reader.pages[page_idx])
        buf = io.BytesIO()
        writer.write(buf)
        segments.append(buf.getvalue())

    return segments


def _process_pdf_large(document: dict, categories: list[dict]) -> ProcessingResult:
    """Split large PDF into segments, extract text per segment, then classify merged text."""
    sb = get_supabase()
    doc_id = document["id"]
    file_bytes = sb.storage.from_("dataroom-files").download(document["storage_path"])

    # Check for existing segments (resumability)
    existing = (
        sb.table("extraction_segments")
        .select("*")
        .eq("document_id", doc_id)
        .order("segment_index")
        .execute()
    ).data

    if existing:
        segments_data = existing
    else:
        # Split the PDF
        pdf_segments = _split_pdf(file_bytes)
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(file_bytes))
        total_pages = len(reader.pages)

        segments_data = []
        for idx, seg_bytes in enumerate(pdf_segments):
            page_start = idx * PAGES_PER_SEGMENT
            page_end = min(page_start + PAGES_PER_SEGMENT, total_pages) - 1
            row = sb.table("extraction_segments").insert({
                "document_id": doc_id,
                "segment_index": idx,
                "page_start": page_start,
                "page_end": page_end,
                "status": "pending",
            }).execute()
            segments_data.append(row.data[0])

    # Extract text for each pending segment
    client = _get_client()
    all_texts: list[str] = [""] * len(segments_data)

    for seg in segments_data:
        seg_idx = seg["segment_index"]
        if seg["status"] == "extracted" and seg.get("extracted_text"):
            all_texts[seg_idx] = seg["extracted_text"]
            continue
        if seg["status"] == "failed":
            # Retry failed segments
            pass

        # Re-split to get this segment's bytes
        pdf_segments = _split_pdf(file_bytes)
        if seg_idx >= len(pdf_segments):
            sb.table("extraction_segments").update({
                "status": "failed",
                "error_message": "Segment index out of range",
            }).eq("id", seg["id"]).execute()
            continue

        seg_bytes = pdf_segments[seg_idx]
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    types.Part.from_bytes(data=seg_bytes, mime_type="application/pdf"),
                    _build_segment_extraction_prompt(),
                ],
                config={"system_instruction": _SYSTEM_INSTRUCTION},
            )
            text = response.text or ""
            all_texts[seg_idx] = text
            sb.table("extraction_segments").update({
                "status": "extracted",
                "extracted_text": text,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", seg["id"]).execute()
        except Exception as exc:
            logger.warning("Segment %d extraction failed for doc %s: %s", seg_idx, doc_id, exc)
            sb.table("extraction_segments").update({
                "status": "failed",
                "error_message": str(exc)[:500],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", seg["id"]).execute()

    # Merge all segment texts
    merged_text = "\n\n".join(t for t in all_texts if t)
    if not merged_text.strip():
        return ProcessingResult(
            extracted_text="",
            category_key="other",
            classification_confidence=0.0,
            classification_reasoning="No text could be extracted from any segment.",
            is_incomplete=True,
            incompleteness_reasons=["All segments failed to extract"],
            error="All segments failed",
        )

    # Final classification call with merged text
    categories_block = _build_categories_block(categories)
    prompt = _build_text_only_prompt(categories_block, document["filename"], merged_text)

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[prompt],
        config={
            "system_instruction": _SYSTEM_INSTRUCTION,
            "response_mime_type": "application/json",
            "response_json_schema": TextAnalysis.model_json_schema(),
        },
    )

    analysis = TextAnalysis.model_validate_json(response.text)
    return ProcessingResult(
        extracted_text=merged_text,
        category_key=analysis.category_key,
        classification_confidence=analysis.classification_confidence,
        classification_reasoning=analysis.classification_reasoning,
        is_incomplete=analysis.is_incomplete,
        incompleteness_reasons=analysis.incompleteness_reasons,
    )


# ── Batch processing for a deal ─────────────────────────────────────────────


def process_deal_documents(deal_id: str) -> int:
    """Process all documents in a deal through Gemini.

    Returns the number of documents successfully processed.
    """
    sb = get_supabase()

    # Fetch documents
    docs = (
        sb.table("documents")
        .select("id, filename, file_extension, file_size, storage_path, extracted_text")
        .eq("deal_id", deal_id)
        .execute()
    ).data

    # Fetch company categories via deal → company
    deal = sb.table("deals").select("company_id").eq("id", deal_id).execute()
    company_id = deal.data[0].get("company_id") if deal.data else None

    categories: list[dict] = []
    if company_id:
        cats = (
            sb.table("company_classifications")
            .select("key, label, description")
            .eq("company_id", company_id)
            .eq("is_active", True)
            .order("display_order")
            .execute()
        )
        categories = cats.data or []

    processed = 0
    for doc in docs:
        # Skip if already processed (has extracted_text and classification)
        if doc.get("extracted_text"):
            # Mark as completed if not already
            if doc.get("processing_status") != "completed":
                sb.table("documents").update({"processing_status": "completed"}).eq("id", doc["id"]).execute()
            processed += 1
            continue

        # Mark as processing before starting Gemini call
        sb.table("documents").update({"processing_status": "processing"}).eq("id", doc["id"]).execute()

        result = process_document(doc, categories)

        if result.error:
            logger.error("Failed to process document %s: %s", doc["id"], result.error)
            sb.table("documents").update({
                "processing_status": "failed",
                "processing_error": str(result.error),
            }).eq("id", doc["id"]).execute()
            continue

        # Update the document row
        update_data: dict = {
            "extracted_text": result.extracted_text or None,
            "assigned_category": result.category_key,
            "classification_confidence": round(result.classification_confidence, 3),
            "classification_reasoning": result.classification_reasoning or None,
            "is_incomplete": result.is_incomplete,
            "incompleteness_reasons": result.incompleteness_reasons or None,
            "processing_status": "completed",
            "classified_at": datetime.now(timezone.utc).isoformat(),
        }
        sb.table("documents").update(update_data).eq("id", doc["id"]).execute()
        processed += 1

    return processed
