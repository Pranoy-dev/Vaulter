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
  const dealScopeInstruction = dealId
    ? "You are an AI assistant for a commercial real estate data room.\n" +
      "The context below contains two sections you must use together:\n" +
      "  - **Data Room Document Inventory**: a structured overview of every file — file type, size, classification, summaries, key terms, parties, expiry dates, and folder structure. Use this for aggregate questions (e.g. 'summarize all documents', 'list all parties', 'what files do we have').\n" +
      "  - **Retrieved Document Excerpts**: the most relevant raw text chunks from the documents, ranked by relevance. Use these for specific detail questions.\n\n" +
      "Rules:\n" +
      "1. Answer using both the inventory overview AND the retrieved excerpts — they are both authoritative context.\n" +
      "2. For aggregate questions (e.g. 'summarize all documents'), use the summaries in the inventory overview to give a complete answer covering every document.\n" +
      "3. Always cite the source document filename when presenting specific facts.\n" +
      "4. Do not fabricate facts or reference documents outside this data room.\n" +
      "5. Only say 'I couldn't find that in the available documents' if the information is genuinely absent from BOTH the inventory overview AND the retrieved excerpts."
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
