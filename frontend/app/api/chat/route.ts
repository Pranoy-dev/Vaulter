import { openai } from "@ai-sdk/openai"
import { frontendTools } from "@assistant-ui/react-ai-sdk"
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type JSONSchema7,
  type UIMessage,
} from "ai"
import { auth } from "@clerk/nextjs/server"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""

type ChatContextResult =
  | {
      ok: true
      context: string
      session_id: string
      sources: Array<{ filename?: string; category?: string; score: number; document_id: string }>
      condensed_query: string
    }
  | { ok: false; reason: "auth_expired" | "no_data" | "error"; detail?: string }

/** Call backend chat/context endpoint — handles history, condensation, deal overview + RAG. */
async function fetchChatContext(
  query: string,
  dealId: string,
  authToken: string,
  sessionId?: string | null,
): Promise<ChatContextResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/deals/${dealId}/chat/context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        query,
        session_id: sessionId ?? undefined,
        top_k: 12,
      }),
    })
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth_expired" }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const errBody = await res.json()
        detail = errBody?.detail ?? errBody?.error?.message ?? detail
      } catch { /* ignore */ }
      return { ok: false, reason: "error", detail }
    }
    const body = await res.json()
    const data = body.data
    if (!data?.has_data) return { ok: false, reason: "no_data" }
    return {
      ok: true,
      context: data.context,
      session_id: data.session_id,
      sources: data.sources ?? [],
      condensed_query: data.condensed_query,
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Network error"
    return { ok: false, reason: "error", detail }
  }
}

/** Save user+assistant message pair after streaming completes. */
async function saveMessages(
  dealId: string,
  authToken: string,
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
  sources?: Array<Record<string, unknown>>,
): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/deals/${dealId}/chat/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        user_message: userMessage,
        assistant_message: assistantMessage,
        sources: sources ?? null,
      }),
    })
  } catch {
    // Best-effort — don't break the chat if save fails
    console.error("[chat] Failed to persist messages")
  }
}

export const maxDuration = 30

export async function POST(req: Request) {
  try {
    return await _handlePost(req)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error"
    console.error("[chat/route] Unhandled error:", err)
    return new Response(JSON.stringify({ error: `Chat service error: ${message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}

async function _handlePost(req: Request) {
  // Use Clerk server-side auth to get a fresh JWT — no need for the client to send a token.
  const { getToken } = await auth()
  const authToken = (await getToken()) ?? ""

  const body = await req.json()
  const messages = body.messages as UIMessage[]
  const system = body.system as string | undefined
  const tools = (body.tools ?? {}) as Record<
    string,
    { description?: string; parameters: JSONSchema7 }
  >
  const dealId: string | undefined = body.dealId
  const sessionId: string | undefined = body.sessionId

  // Extract the latest user message text for RAG retrieval
  let ragContext = ""
  let ragNotice = ""
  let activeSessionId: string | undefined = sessionId
  let ragSources: Array<Record<string, unknown>> = []

  if (dealId && authToken) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")
    const queryText = lastUserMsg
      ? lastUserMsg.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join(" ")
      : ""
    if (queryText.trim()) {
      const result = await fetchChatContext(queryText.trim(), dealId, authToken, sessionId)
      if (result.ok) {
        ragContext = result.context
        activeSessionId = result.session_id
        ragSources = result.sources
      } else if (result.reason === "auth_expired") {
        ragNotice =
          "The user's session has expired and document search is temporarily unavailable. " +
          "Inform the user that their session has expired and they should refresh the page to restore AI document search."
      } else if (result.reason === "no_data") {
        ragNotice =
          "No indexed document data was found for this deal. The files in this data room have not been processed for RAG yet. " +
          "Let the user know that no document data is available and suggest they run AI processing first."
      } else if (result.reason === "error") {
        ragNotice =
          "Document search encountered an error and could not retrieve context for this question. " +
          (result.detail ? `Error detail: ${result.detail}. ` : "") +
          "Let the user know that document search is temporarily unavailable, describe the error if present, " +
          "and suggest they try again or check that the backend is running."
      }
    }
  }

  // Prepend RAG context or notice to the system prompt, plus a hard deal-scope instruction
  const ALGORITHM_KNOWLEDGE = `
Platform Technology Overview (use this when users ask how classification, AI insights, or amendments work):

DOCUMENT CLASSIFICATION
- Text is extracted from uploaded files (PDF, DOCX, XLSX, images via OCR).
- Each document is embedded using a large language model which converts the full text into a high-dimensional semantic vector.
- Documents are classified into categories (Leases & Amendments, Financial, Technical/Environmental, Corporate & Legal, Other) by prompting the LLM with the extracted text and an in-context description of each category.
- A confidence score (0–100%) is computed from the model's output certainty. Low-confidence documents are flagged for review.
- Key metadata — parties, expiry dates, signatures, seals, incompleteness — are extracted in the same AI pass.
- Note: proprietary prompt engineering, category ontologies, and confidence-calibration techniques are used internally and cannot be disclosed.

AI INSIGHTS & RISK SCORING
- After classification, a deal-level overview is synthesised: document counts per category, WAULT (Weighted Average Unexpired Lease Term), tenant lists, expiry timelines, and signed/sealed document counts.
- A multi-dimensional risk score (0–100, lower = higher risk) is computed across dimensions such as lease diversification, expiry concentration, documentation completeness, and financial coverage using a weighted aggregation model.
- Risk signals (circuit breakers, missing documents, high-concentration expiry buckets) are derived from threshold rules applied to the computed metrics.
- Note: the exact weighting formulae, threshold values, and risk calibration models are proprietary and cannot be disclosed.

LEASE AMENDMENT CHAIN DETECTION
- Each classified document labelled as a lease or amendment undergoes entity extraction: tenant name, landlord name, document type (Base Lease / Amendment / Side Letter), and effective date.
- Documents are grouped into chains by matching tenant/landlord name pairs using fuzzy string similarity (Levenshtein distance + token-set ratio).
- Within a chain, documents are ordered chronologically. Amendments are linked to the base lease they modify based on date ordering and shared party names.
- Note: the chain-linking heuristics, fuzzy-matching thresholds, and amendment-type classifiers use proprietary calibration that cannot be disclosed.

DUPLICATE DETECTION
- Stage 1 (hash-based): SHA-256 hashes are compared across all uploaded files. Exact binary duplicates are flagged immediately after upload.
- Stage 2 (semantic): Document embedding vectors are compared using cosine similarity. Files whose similarity exceeds a configurable threshold are flagged as near-duplicates.
- Note: the similarity threshold and deduplication ranking logic are proprietary.
`

  const dealScopeInstruction = dealId
    ? "You are an AI assistant for a commercial real estate data room.\n" +
      "The context below contains two sections you must use together:\n" +
      "  - **Data Room Document Inventory**: a structured overview of every file — file type, size, classification, summaries, key terms, parties, expiry dates, and folder structure. Use this for aggregate questions (e.g. 'summarize all documents', 'list all parties', 'what files do we have').\n" +
      "  - **Retrieved Document Excerpts**: the most relevant raw text chunks from the documents, ranked by relevance. Use these for specific detail questions.\n\n" +
      ALGORITHM_KNOWLEDGE + "\n" +
      "Rules:\n" +
      "1. Answer using both the inventory overview AND the retrieved excerpts — they are both authoritative context.\n" +
      "2. For aggregate questions (e.g. 'summarize all documents'), use the summaries in the inventory overview to give a complete answer covering every document.\n" +
      "3. Always cite the source document filename when presenting specific facts.\n" +
      "4. Do not fabricate facts or reference documents outside this data room.\n" +
      "5. Only say 'I couldn't find that in the available documents' if the information is genuinely absent from BOTH the inventory overview AND the retrieved excerpts.\n" +
      "6. When asked about how the platform works (classification, risk scoring, amendments, duplicates), use the Platform Technology Overview above. Always mention that proprietary algorithms are used for fine-tuning and calibration that cannot be disclosed."
    : ""

  const effectiveSystem = [dealScopeInstruction, ragContext || ragNotice, system]
    .filter(Boolean)
    .join("\n\n")

  // Get the user's last message text for persistence
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")
  const userQueryText = lastUserMsg
    ? lastUserMsg.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ")
    : ""

  try {
    const result = streamText({
      model: openai("gpt-4o"),
      messages: await convertToModelMessages(messages),
      ...(effectiveSystem ? { system: effectiveSystem } : {}),
      stopWhen: stepCountIs(10),
      tools: frontendTools(tools),
      async onFinish({ text }) {
        // Persist the exchange to DB for history-aware future queries
        if (dealId && authToken && activeSessionId && userQueryText && text) {
          await saveMessages(
            dealId,
            authToken,
            activeSessionId,
            userQueryText,
            text,
            ragSources,
          )
        }
      },
    })

    return result.toUIMessageStreamResponse()
  } catch (err) {
    // Surface model/network errors back to the UI via the stream error protocol
    // so assistant-ui renders them inline in the chat thread.
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred"
    const isQuota = message.includes("429") || message.toLowerCase().includes("quota")
    const isUnavailable =
      message.includes("503") ||
      message.toLowerCase().includes("unavailable") ||
      message.toLowerCase().includes("overloaded")
    const isNetwork =
      message.toLowerCase().includes("fetch") ||
      message.toLowerCase().includes("econnrefused") ||
      message.toLowerCase().includes("network")

    let friendly = `AI service error: ${message}`
    if (isQuota) friendly = "Request limit reached. Please wait a moment and try again."
    else if (isUnavailable) friendly = "The AI model is temporarily unavailable. Please try again shortly."
    else if (isNetwork) friendly = "Could not reach the AI service. Check your connection and try again."

    console.error("[chat/route] streamText error:", err)
    return new Response(JSON.stringify({ error: friendly }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }
}
