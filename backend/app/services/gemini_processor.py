"""Unified Gemini document processor — extraction + classification + completeness in one call."""

from __future__ import annotations

import io
import logging
import os
import subprocess
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
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

# Number of documents to process concurrently.
# Free tier (10 RPM): keep at 2-3. Tier 1+ (2000 RPM): 5-10 is fine.
PROCESSING_CONCURRENCY = 5

# RAG embedding workers (OpenAI text-embedding-3-small).
# 5 is safe for both free tier and Tier 1 rate limits.
RAG_CONCURRENCY = 5


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


# Thread-local Supabase clients — each worker thread gets its own connection.
_thread_local = threading.local()


def _get_thread_supabase():
    """Return a per-thread Supabase client (avoids shared httpx connection issues)."""
    if not hasattr(_thread_local, "sb"):
        import httpx
        from supabase import create_client, ClientOptions
        _thread_local.sb = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
            options=ClientOptions(
                postgrest_client_timeout=30,
                httpx_client=httpx.Client(http2=False),
            ),
        )
    return _thread_local.sb


# ── Pydantic schema for Gemini structured output ────────────────────────────


class SemanticChunk(BaseModel):
    """A semantically coherent chunk of document text for embedding."""
    title: str = Field(
        description="Short descriptive title for this chunk (e.g. 'Rent Escalation Clause', 'Parties and Recitals', 'Signature Block')."
    )
    content: str = Field(
        description="The full text of this chunk. Should be self-contained and meaningful on its own."
    )
    topic: str = Field(
        description="The primary topic or section type (e.g. 'definitions', 'financial_terms', 'obligations', 'termination', 'signatures', 'recitals')."
    )


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
    summary: str = Field(
        description="A concise 2-4 sentence summary of the document's content and purpose."
    )
    expiry_date: str | None = Field(
        description=(
            "The LEASE EXPIRY DATE — the contractual end date of the lease term itself "
            "(ISO 8601, e.g. 2032-03-31). "
            "CRITICAL: Do NOT use a break option date, rent review date, notice deadline, "
            "or amendment date here. Break options allow early termination but the lease "
            "formally expires on the lease expiry/end date. "
            "If the document is an amendment, use the base lease's expiry date (unchanged). "
            "Return null only if no lease expiry date is present at all."
        )
    )
    has_signature: bool = Field(
        description="Whether the document contains handwritten or digital signatures."
    )
    has_seal: bool = Field(
        description="Whether the document contains official seals, stamps, or notary marks."
    )
    parties: list[str] = Field(
        description="Names of all parties, companies, or entities mentioned as signatories or principals in the document."
    )
    key_terms: dict[str, str] = Field(
        description="Key financial/legal terms extracted as key-value pairs, e.g. rent amount, lease term, purchase price, interest rate. Only include terms actually present."
    )
    chunks: list[SemanticChunk] = Field(
        description="The document text split into semantically meaningful chunks for embedding. "
        "Each chunk should cover one coherent topic, section, or clause (target ~300-500 words each). "
        "Prefer natural boundaries: section headings, clause breaks, topic shifts. "
        "Every chunk must be self-contained enough to be useful when retrieved independently."
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
    summary: str = Field(
        description="A concise 2-4 sentence summary of the document's content and purpose."
    )
    expiry_date: str | None = Field(
        description=(
            "The LEASE EXPIRY DATE — the contractual end date of the lease term itself "
            "(ISO 8601, e.g. 2032-03-31). "
            "CRITICAL: Do NOT use a break option date, rent review date, notice deadline, "
            "or amendment date here. Break options allow early termination but the lease "
            "formally expires on the lease expiry/end date. "
            "If the document is an amendment, use the base lease's expiry date (unchanged). "
            "Return null only if no lease expiry date is present at all."
        )
    )
    has_signature: bool = Field(
        description="Whether the document mentions or contains signatures."
    )
    has_seal: bool = Field(
        description="Whether the document mentions or contains official seals, stamps, or notary marks."
    )
    parties: list[str] = Field(
        description="Names of all parties, companies, or entities mentioned as signatories or principals in the document."
    )
    key_terms: dict[str, str] = Field(
        description="Key financial/legal terms extracted as key-value pairs, e.g. rent amount, lease term, purchase price, interest rate. Only include terms actually present."
    )
    chunks: list[SemanticChunk] = Field(
        description="The document text split into semantically meaningful chunks for embedding. "
        "Each chunk should cover one coherent topic, section, or clause (target ~300-500 words each). "
        "Prefer natural boundaries: section headings, clause breaks, topic shifts. "
        "Every chunk must be self-contained enough to be useful when retrieved independently."
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
    is_empty: bool = False
    summary: str = ""
    expiry_date: str | None = None
    has_signature: bool = False
    has_seal: bool = False
    parties: list[str] = field(default_factory=list)
    key_terms: dict[str, str] = field(default_factory=dict)
    chunks: list[dict] = field(default_factory=list)
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
    "You analyze documents of all types — PDFs, images, spreadsheets, presentations, "
    "text files, and office documents — to extract text, classify them into categories, "
    "assess completeness, extract key metadata, and produce semantically meaningful chunks for retrieval."
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
4. **Summary**: Write a concise 2-4 sentence summary of the document's content and purpose.
5. **Lease Expiry Date** (CRITICAL — read carefully):
   - Extract the formal LEASE EXPIRY / END DATE — the date on which the lease term contractually expires.
   - This is NOT the break option date. A break option is a right to terminate early; the lease itself still runs to the expiry date unless the break is exercised.
   - This is NOT the rent review date, the amendment date, the notice deadline, or this document's own date.
   - For amendments/deeds of variation: the expiry date is the BASE lease expiry date (which is unchanged by the amendment). Look for phrases like "Lease Expiry Date", "lease expires", "expiry of the term", "end of the term", "demise … expiring on".
   - If the document explicitly states "Lease Expiry Date: YYYY-MM-DD" or "expiring on [date]", use that date.
   - Return in ISO 8601 format (YYYY-MM-DD). Return null only if absolutely no lease expiry date is present.
6. **Signatures & Seals**: Indicate whether the document contains handwritten or digital signatures, and whether it contains official seals, stamps, or notary marks.
7. **Parties**: List the names of all parties, companies, or entities mentioned as signatories or principals.
8. **Key Terms**: Extract key financial and legal terms as key-value pairs. Only include terms actually present in the document. For lease/rental documents, be especially thorough and extract ALL of these if present:
   - "annual_rent" or "rent_amount": the current passing rent (amount and period, e.g. "£369,200/year")
   - "lease_term": duration (e.g. "12 years")
   - "lease_start_date": commencement date in ISO 8601 (YYYY-MM-DD)
   - "lease_end_date": the formal lease EXPIRY date in ISO 8601 — same rule as field 5 above; NOT a break date
   - "break_option_date": break option date in ISO 8601, ONLY if a break clause exists; clearly separate from lease_end_date
   - "break_option_notice": notice period required for break option (e.g. "9 months")
   - "rent_escalation": type and details (e.g. "CPI-linked annually", "Fixed 3% per annum", "Open market review every 5 years")
   - "security_deposit": amount or description
   - "tenant_name": primary tenant name
   - "landlord_name": primary landlord name
   - "property_address": property location
   - "leasable_area": area with unit (e.g. "14,200 sq ft")
   - "rent_review_date": next upcoming rent review date if specified
   - "service_charge": annual amount if specified
   - "vacancy_rate": if mentioned
   - "occupancy_rate": if mentioned
   - "noi" or "net_operating_income": if mentioned
   - "dscr" or "debt_service_coverage": if mentioned
   For other document types, extract terms like purchase price, interest rate, loan amount, valuation, etc.
9. **Semantic Chunking**: Split the document into semantically meaningful chunks for use in search and retrieval.
   - Each chunk should cover ONE coherent topic, section, clause, or logical unit (target ~300-500 words each).
   - Use natural boundaries: section headings, clause breaks, topic shifts, exhibit separators.
   - Give each chunk a short descriptive title and a topic label.
   - Each chunk must be self-contained — if retrieved on its own, a reader should understand its meaning without needing surrounding context.
   - Include all document text across the chunks; do not skip content.

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
3. **Summary**: Write a concise 2-4 sentence summary of the document's content and purpose.
4. **Lease Expiry Date** (CRITICAL — read carefully):
   - Extract the formal LEASE EXPIRY / END DATE — the date on which the lease term contractually expires.
   - This is NOT the break option date. A break option is a right to terminate early; the lease itself still runs to the expiry date unless the break is exercised.
   - This is NOT the rent review date, the amendment date, the notice deadline, or this document's own date.
   - For amendments/deeds of variation: the expiry date is the BASE lease expiry date (unchanged by the amendment). Look for phrases like "Lease Expiry Date", "Base Lease Expiry Date", "expiry of the term", "demise … expiring on".
   - Return in ISO 8601 format (YYYY-MM-DD). Return null only if absolutely no lease expiry date is present.
5. **Signatures & Seals**: Indicate whether the document mentions or contains signatures, and whether it mentions or contains official seals, stamps, or notary marks.
6. **Parties**: List the names of all parties, companies, or entities mentioned as signatories or principals.
7. **Key Terms**: Extract key financial and legal terms as key-value pairs. Only include terms actually present. For lease/rental documents, be especially thorough and extract ALL of these if present:
   - "annual_rent" or "rent_amount": the current passing rent (amount and period)
   - "lease_term": duration (e.g. "12 years")
   - "lease_start_date" (YYYY-MM-DD), "lease_end_date" (YYYY-MM-DD) — the formal expiry, NOT the break date
   - "break_option_date" (YYYY-MM-DD) — ONLY if a break clause exists; must be different from lease_end_date
   - "break_option_notice": notice period for break option
   - "rent_escalation": type and details (e.g. "CPI-linked", "Fixed 3%", "Open market review")
   - "security_deposit", "tenant_name", "landlord_name", "property_address"
   - "leasable_area", "service_charge", "occupancy_rate", "vacancy_rate"
   For financial docs, extract: "noi", "dscr", "purchase_price", "interest_rate", "loan_amount", "valuation"
8. **Semantic Chunking**: Split the document text into semantically meaningful chunks for use in search and retrieval.
   - Each chunk should cover ONE coherent topic, section, clause, or logical unit (target ~300-500 words each).
   - Use natural boundaries: section headings, clause breaks, topic shifts.
   - Give each chunk a short descriptive title and a topic label.
   - Each chunk must be self-contained — if retrieved on its own, a reader should understand its meaning without needing surrounding context.
   - Include all document text across the chunks; do not skip content.

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
    - Path A: PDF/images → Gemini sees the file directly (extraction + classification + everything)
    - Path B: Office files (DOCX/XLSX/PPTX) → convert to PDF, then Gemini sees layout/tables/images
    - Path C: Text files (TXT/CSV/HTML/EML) → send to Gemini as native text Parts
    - Path D: Large PDFs (>50 MB) → split into segments, extract per segment, then classify merged text

    Args:
        document: Dict with keys: id, filename, file_extension, file_size, storage_path
        company_categories: List of dicts with keys: key, label, description
    """
    ext = (document.get("file_extension") or "").lower().lstrip(".")
    file_size = document.get("file_size", 0)
    filename = document.get("filename", "unknown")

    try:
        if ext == "pdf":
            if file_size <= MAX_PDF_SIZE:
                return _process_pdf_direct(document, company_categories)
            else:
                return _process_pdf_large(document, company_categories)
        elif ext in ("png", "jpg", "jpeg", "gif", "webp", "heic", "heif"):
            return _process_image_direct(document, company_categories)
        elif ext in ("tiff", "bmp"):
            # TIFF/BMP not natively supported by Gemini — convert to PDF
            return _process_office_as_pdf(document, company_categories)
        elif ext in ("docx", "xlsx", "pptx"):
            return _process_office_as_pdf(document, company_categories)
        elif ext in ("txt", "csv", "html", "htm", "xml", "rtf", "md", "json", "eml"):
            return _process_text_direct(document, company_categories)
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
        summary=analysis.summary,
        expiry_date=analysis.expiry_date,
        has_signature=analysis.has_signature,
        has_seal=analysis.has_seal,
        parties=analysis.parties,
        key_terms=analysis.key_terms,
        chunks=[c.model_dump() for c in analysis.chunks],
    )


# ── Path A variant: Image direct ────────────────────────────────────────────


def _process_image_direct(document: dict, categories: list[dict]) -> ProcessingResult:
    """Upload image to Gemini for OCR + classification + completeness."""
    sb = get_supabase()
    file_bytes = sb.storage.from_("dataroom-files").download(document["storage_path"])

    ext = (document.get("file_extension") or "").lower().lstrip(".")
    mime_map = {
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "gif": "image/gif", "webp": "image/webp",
        "heic": "image/heic", "heif": "image/heif",
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
        summary=analysis.summary,
        expiry_date=analysis.expiry_date,
        has_signature=analysis.has_signature,
        has_seal=analysis.has_seal,
        parties=analysis.parties,
        key_terms=analysis.key_terms,
        chunks=[c.model_dump() for c in analysis.chunks],
    )


# ── Path B: Office files → PDF → Gemini ──────────────────────────────────────


def _convert_to_pdf(file_bytes: bytes, ext: str) -> bytes | None:
    """Convert an office/image document to PDF for Gemini processing.

    Tries LibreOffice headless first (preserves tables, formatting, images),
    then falls back to a text-based PDF via fpdf2.
    """
    # --- Try LibreOffice headless (best fidelity) ---
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, f"input.{ext}")
            with open(input_path, "wb") as f:
                f.write(file_bytes)

            subprocess.run(
                [
                    "soffice", "--headless", "--norestore",
                    "--convert-to", "pdf", "--outdir", tmpdir, input_path,
                ],
                capture_output=True,
                timeout=120,
                check=True,
            )

            output_path = os.path.join(tmpdir, "input.pdf")
            if os.path.exists(output_path):
                with open(output_path, "rb") as f:
                    return f.read()
    except (FileNotFoundError, subprocess.TimeoutExpired, subprocess.CalledProcessError):
        logger.debug(
            "LibreOffice not available or failed, falling back to text-based PDF for .%s", ext
        )

    # --- Fallback: text-based PDF via fpdf2 ---
    try:
        from fpdf import FPDF

        text = local_extract_text(file_bytes, ext)
        if not text or not text.strip():
            return None

        pdf = FPDF()
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()
        pdf.set_font("Helvetica", size=10)
        # fpdf2 built-in fonts support Latin-1; replace unsupported chars
        clean_text = text.encode("latin-1", errors="replace").decode("latin-1")
        pdf.multi_cell(w=0, h=5, text=clean_text)
        return bytes(pdf.output())
    except Exception as exc:
        logger.warning("Failed to create text-based PDF for .%s: %s", ext, exc)
        return None


def _process_office_as_pdf(document: dict, categories: list[dict]) -> ProcessingResult:
    """Convert office document (or unsupported image) to PDF, then send to Gemini.

    Falls back to text extraction path if PDF conversion fails entirely.
    """
    sb = get_supabase()
    file_bytes = sb.storage.from_("dataroom-files").download(document["storage_path"])
    ext = (document.get("file_extension") or "").lower().lstrip(".")

    pdf_bytes = _convert_to_pdf(file_bytes, ext)
    if not pdf_bytes:
        # Conversion failed — fall back to text extraction + TextAnalysis
        logger.warning(
            "PDF conversion failed for %s, falling back to text extraction", document["filename"]
        )
        return _process_text_fallback(document, categories, file_bytes, ext)

    client = _get_client()
    categories_block = _build_categories_block(categories)
    prompt = _build_full_prompt(categories_block, document["filename"])

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
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
        summary=analysis.summary,
        expiry_date=analysis.expiry_date,
        has_signature=analysis.has_signature,
        has_seal=analysis.has_seal,
        parties=analysis.parties,
        key_terms=analysis.key_terms,
        chunks=[c.model_dump() for c in analysis.chunks],
    )


def _process_text_fallback(
    document: dict, categories: list[dict], file_bytes: bytes, ext: str,
) -> ProcessingResult:
    """Last-resort path: extract text locally, send to Gemini with TextAnalysis."""
    extracted_text = local_extract_text(file_bytes, ext)
    if not extracted_text.strip():
        return ProcessingResult(
            extracted_text="",
            category_key="other",
            classification_confidence=0.0,
            classification_reasoning="No text could be extracted from this file.",
            is_empty=True,
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
        summary=analysis.summary,
        expiry_date=analysis.expiry_date,
        has_signature=analysis.has_signature,
        has_seal=analysis.has_seal,
        parties=analysis.parties,
        key_terms=analysis.key_terms,
        chunks=[c.model_dump() for c in analysis.chunks],
    )


# ── Path C: Text files → Gemini native ──────────────────────────────────────

# Gemini natively supports these MIME types as inline Parts
_TEXT_MIME_MAP: dict[str, str] = {
    "txt": "text/plain",
    "csv": "text/csv",
    "html": "text/html",
    "htm": "text/html",
    "xml": "text/xml",
    "rtf": "text/rtf",
    "md": "text/plain",
    "json": "application/json",
    "eml": "text/plain",  # Gemini doesn't support message/rfc822; send as text
}


def _process_text_direct(document: dict, categories: list[dict]) -> ProcessingResult:
    """Send text-based files directly to Gemini as native file Parts.

    Gemini natively handles text/plain, text/csv, text/html, text/xml, etc.
    Uses DocumentAnalysis so Gemini performs extraction + classification + everything.
    """
    sb = get_supabase()
    file_bytes = sb.storage.from_("dataroom-files").download(document["storage_path"])
    ext = (document.get("file_extension") or "").lower().lstrip(".")

    # Quick empty check
    try:
        text_content = file_bytes.decode("utf-8", errors="replace")
    except Exception:
        text_content = ""

    if not text_content.strip():
        return ProcessingResult(
            extracted_text="",
            category_key="other",
            classification_confidence=0.0,
            classification_reasoning="File is empty.",
            is_empty=True,
        )

    mime_type = _TEXT_MIME_MAP.get(ext, "text/plain")

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
        summary=analysis.summary,
        expiry_date=analysis.expiry_date,
        has_signature=analysis.has_signature,
        has_seal=analysis.has_seal,
        parties=analysis.parties,
        key_terms=analysis.key_terms,
        chunks=[c.model_dump() for c in analysis.chunks],
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
            is_empty=True,
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
        summary=analysis.summary,
        expiry_date=analysis.expiry_date,
        has_signature=analysis.has_signature,
        has_seal=analysis.has_seal,
        parties=analysis.parties,
        key_terms=analysis.key_terms,
        chunks=[c.model_dump() for c in analysis.chunks],
    )


# ── Text chunking for embeddings ─────────────────────────────────────────────

CHUNK_SIZE = 512  # target tokens per chunk (approx 4 chars per token)
CHUNK_OVERLAP = 50  # overlap tokens between consecutive chunks


def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[dict]:
    """Split text into overlapping chunks sized for embedding models.

    Uses paragraph boundaries when possible, falling back to sentence
    boundaries, then hard character splits. Returns a list of dicts:
    [{"content": str, "token_count": int, "chunk_index": int}, ...]
    """
    if not text or not text.strip():
        return []

    # Approximate chars per token (conservative for English text)
    chars_per_token = 4
    target_chars = chunk_size * chars_per_token
    overlap_chars = overlap * chars_per_token

    # Split into paragraphs first
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks: list[dict] = []
    current = ""
    idx = 0

    for para in paragraphs:
        # If adding this paragraph exceeds target, flush current chunk
        if current and len(current) + len(para) + 2 > target_chars:
            chunks.append({
                "content": current.strip(),
                "token_count": max(1, len(current.strip()) // chars_per_token),
                "chunk_index": idx,
            })
            idx += 1
            # Keep overlap from the end of current chunk
            if overlap_chars > 0 and len(current) > overlap_chars:
                current = current[-overlap_chars:] + "\n\n" + para
            else:
                current = para
        else:
            current = (current + "\n\n" + para) if current else para

    # Flush remaining text
    if current.strip():
        chunks.append({
            "content": current.strip(),
            "token_count": max(1, len(current.strip()) // chars_per_token),
            "chunk_index": idx,
        })

    # Handle single very large paragraphs by splitting on hard boundaries
    final_chunks: list[dict] = []
    final_idx = 0
    for chunk in chunks:
        content = chunk["content"]
        if len(content) > target_chars * 2:
            # Hard split
            for start in range(0, len(content), target_chars - overlap_chars):
                piece = content[start:start + target_chars]
                if piece.strip():
                    final_chunks.append({
                        "content": piece.strip(),
                        "token_count": max(1, len(piece.strip()) // chars_per_token),
                        "chunk_index": final_idx,
                    })
                    final_idx += 1
        else:
            chunk["chunk_index"] = final_idx
            final_chunks.append(chunk)
            final_idx += 1

    return final_chunks


# ── Batch processing for a deal ─────────────────────────────────────────────


def process_deal_documents(deal_id: str, progress_callback=None) -> int:
    """Process all documents in a deal: Gemini classification + OpenAI RAG embeddings.

    Pipeline architecture — classification and RAG run in parallel:
    - Classify pool (PROCESSING_CONCURRENCY workers): calls Gemini, writes result to DB.
    - RAG pool (RAG_CONCURRENCY workers): embeds chunks via OpenAI.  Each doc is submitted
      to this pool as soon as it finishes classification, so RAG runs concurrently with
      ongoing classification work (true pipeline parallelism).

    RAG only runs on docs that finish classification with extractable text.
    Already-classified docs that are not yet RAG-indexed are also queued for embedding.

    Args:
        deal_id: The deal ID.
        progress_callback: Optional callable receiving a dict:
            {sub_stage, ai_current, ai_total, rag_current, rag_total, filename}

    Returns the number of documents successfully processed.
    """
    sb = get_supabase()

    # Fetch all docs — include rag_indexed to detect partially-done docs
    docs = (
        sb.table("documents")
        .select(
            "id, filename, original_path, file_extension, file_size, storage_path, "
            "extracted_text, is_empty, processing_status, rag_indexed"
        )
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

    # Bucket docs into three groups:
    # needs_classify  — processing_status is not "completed"/"failed" → full Gemini pipeline
    # needs_rag_only  — already classified (completed) + has text + not RAG-indexed → go straight to RAG pool
    # fully_done      — completed + RAG-indexed (or empty/failed) → nothing to do
    needs_classify: list[dict] = []
    needs_rag_only: list[dict] = []
    fully_done: list[dict] = []

    for doc in docs:
        status = doc.get("processing_status") or "pending"
        has_text = bool(doc.get("extracted_text"))
        is_empty = bool(doc.get("is_empty"))
        rag_done = bool(doc.get("rag_indexed"))
        is_classified = status in ("completed", "failed")

        if is_empty:
            fully_done.append(doc)          # empty files → skip RAG entirely
        elif is_classified and rag_done:
            fully_done.append(doc)          # already fully processed
        elif is_classified and has_text and not rag_done:
            needs_rag_only.append(doc)      # classified, has content, needs embedding
        elif is_classified and not has_text:
            fully_done.append(doc)          # classified but no extractable text → skip RAG
        else:
            needs_classify.append(doc)      # not yet through Gemini → full pipeline

    # Mark already-fully-done docs as completed (main thread, no Gemini call)
    for doc in fully_done:
        if doc.get("processing_status") != "completed":
            sb.table("documents").update({"processing_status": "completed"}).eq("id", doc["id"]).execute()

    total_classify = len(needs_classify)
    # RAG total = newly classified (eligible ones) + already-classified-but-not-yet-RAG'd
    # We use total_classify as upper bound for newly-classified RAG; reduces as empties are found.
    total_rag = total_classify + len(needs_rag_only)

    if total_classify == 0 and not needs_rag_only:
        return len(fully_done)

    # ── Thread-safe progress counters ────────────────────────────────────────
    _lock = threading.Lock()
    _ai_done = [0]   # docs that finished Gemini classification
    _rag_done = [0]  # docs that finished RAG embedding

    def _emit(sub_stage: str, filename: str) -> None:
        """Fire progress callback with current counters."""
        if not progress_callback:
            return
        with _lock:
            ai_cur = _ai_done[0]
            rag_cur = _rag_done[0]
        progress_callback({
            "sub_stage": sub_stage,
            "ai_current": ai_cur,
            "ai_total": total_classify,
            "rag_current": rag_cur,
            "rag_total": total_rag,
            "filename": filename,
        })

    # ── Helper: write semantic/naive chunks to DB ─────────────────────────────
    def _write_chunks(tsb, doc: dict, doc_id: str, result: ProcessingResult) -> None:
        if result.chunks:
            chunk_rows = [
                {
                    "document_id": doc_id,
                    "deal_id": deal_id,
                    "chunk_index": idx,
                    "content": c["content"],
                    "token_count": max(1, len(c["content"]) // 4),
                    "metadata": {
                        "filename": doc.get("filename"),
                        "category": result.category_key,
                        "title": c.get("title", ""),
                        "topic": c.get("topic", ""),
                    },
                }
                for idx, c in enumerate(result.chunks)
            ]
        else:
            naive = _chunk_text(result.extracted_text)
            chunk_rows = [
                {
                    "document_id": doc_id,
                    "deal_id": deal_id,
                    "chunk_index": c["chunk_index"],
                    "content": c["content"],
                    "token_count": c["token_count"],
                    "metadata": {
                        "filename": doc.get("filename"),
                        "category": result.category_key,
                    },
                }
                for c in naive
            ]

        if chunk_rows:
            tsb.table("document_chunks").delete().eq("document_id", doc_id).execute()
            tsb.table("document_chunks").insert(chunk_rows).execute()
            logger.info(
                "Created %d chunks for document %s (semantic=%s)",
                len(chunk_rows), doc_id, bool(result.chunks),
            )

    # ── Classify worker (runs in classify pool) ───────────────────────────────
    def _classify_one(doc: dict) -> tuple[bool, str, str, int]:
        """Run Gemini classification for one doc.  Returns (rag_eligible, doc_id, filename, success)."""
        tsb = _get_thread_supabase()
        doc_id = doc["id"]
        filename = doc.get("original_path") or doc.get("filename", "")

        tsb.table("documents").update({"processing_status": "processing"}).eq("id", doc_id).execute()
        _emit("ai_processing", filename)

        result = process_document(doc, categories)

        if result.error:
            logger.error("Failed to process document %s: %s", doc_id, result.error)
            tsb.table("documents").update({
                "processing_status": "failed",
                "processing_error": str(result.error),
            }).eq("id", doc_id).execute()
            with _lock:
                _ai_done[0] += 1
                _rag_done[0] += 1  # stall-prevention: count error docs as RAG-done
            _emit("ai_processing", filename)
            return False, doc_id, filename, 0

        # Write classification to DB
        tsb.table("documents").update({
            "extracted_text": result.extracted_text or None,
            "assigned_category": result.category_key,
            "classification_confidence": round(result.classification_confidence, 3),
            "classification_reasoning": result.classification_reasoning or None,
            "is_incomplete": result.is_incomplete,
            "incompleteness_reasons": result.incompleteness_reasons or None,
            "is_empty": result.is_empty,
            "summary": result.summary or None,
            "expiry_date": result.expiry_date,
            "has_signature": result.has_signature,
            "has_seal": result.has_seal,
            "parties": result.parties or None,
            "key_terms": result.key_terms or None,
            "processing_status": "completed",
            "classified_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", doc_id).execute()

        rag_eligible = bool(result.extracted_text and result.extracted_text.strip() and not result.is_empty)

        # Write chunks immediately (fast DB insert, no API call — RAG pool can start right away)
        if rag_eligible:
            _write_chunks(tsb, doc, doc_id, result)

        # AI counter done
        with _lock:
            _ai_done[0] += 1
        _emit("ai_processing", filename)

        if not rag_eligible:
            # Empty/un-extractable doc — mark RAG as done so bar doesn't stall
            with _lock:
                _rag_done[0] += 1
            _emit("rag_processing", filename)

        return rag_eligible, doc_id, filename, 1

    # ── RAG worker (runs in rag pool) ─────────────────────────────────────────
    def _rag_one(doc_id: str, filename: str) -> None:
        """Embed chunks for a classified document via OpenAI.  Runs in the RAG pool."""
        from app.services.embeddings import embed_document_chunks

        tsb = _get_thread_supabase()
        _emit("rag_processing", filename)
        try:
            n_embedded = embed_document_chunks(doc_id)
            tsb.table("documents").update({
                "rag_indexed": True,
                "rag_indexed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", doc_id).execute()
            logger.info("Embedded %d chunks for document %s", n_embedded, doc_id)
        except Exception as emb_exc:
            logger.warning("Embedding failed for document %s: %s", doc_id, emb_exc)
        with _lock:
            _rag_done[0] += 1
        _emit("rag_processing", filename)

    # ── Pipeline: classify + RAG pools run concurrently ───────────────────────
    #
    # As each doc finishes classification it is submitted to the RAG pool
    # immediately, so embedding starts while other docs are still being
    # classified.  The rag_pool context manager waits for all submitted tasks
    # before exiting, so we never return until every RAG job is done.
    processed = len(fully_done)

    with (
        ThreadPoolExecutor(max_workers=PROCESSING_CONCURRENCY) as classify_pool,
        ThreadPoolExecutor(max_workers=RAG_CONCURRENCY) as rag_pool,
    ):
        if needs_classify:
            classify_futures = {
                classify_pool.submit(_classify_one, doc): doc for doc in needs_classify
            }
            for future in as_completed(classify_futures):
                doc = classify_futures[future]
                try:
                    rag_eligible, doc_id, filename, success = future.result()
                    processed += success
                    if rag_eligible:
                        # Submit to RAG pool immediately — runs in parallel with
                        # remaining classification work.
                        rag_pool.submit(_rag_one, doc_id, filename)
                except Exception as exc:
                    logger.error("Unexpected error classifying document %s: %s", doc["id"], exc)

        # Already-classified docs that still need RAG — queue them directly
        for doc in needs_rag_only:
            filename = doc.get("original_path") or doc.get("filename", "")
            rag_pool.submit(_rag_one, doc["id"], filename)
            processed += 1  # classified in a previous run; count it

        # rag_pool.__exit__ blocks until every submitted RAG task completes.

    return processed
