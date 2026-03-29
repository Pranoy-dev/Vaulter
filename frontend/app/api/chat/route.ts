import { openai } from "@ai-sdk/openai"
import { frontendTools } from "@assistant-ui/react-ai-sdk"
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type JSONSchema7,
  type UIMessage,
} from "ai"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""

type ChatContextResult =
  | {
      ok: true
      context: string
      session_id: string
      sources: Array<{ filename?: string; category?: string; score: number; document_id: string }>
      condensed_query: string
    }
  | { ok: false; reason: "auth_expired" | "no_data" | "error" }

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
    if (!res.ok) return { ok: false, reason: "error" }
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
  } catch {
    return { ok: false, reason: "error" }
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
  // Extract the Clerk JWT from the incoming Authorization header.
  // AssistantChatTransport sends a fresh token on every request — no stale state.
  const authToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? ""

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
      }
      // reason === "error": backend unreachable — answer without RAG, no notice
    }
  }

  // Prepend RAG context or notice to the system prompt, plus a hard deal-scope instruction
  const dealScopeInstruction = dealId
    ? "You are an AI assistant for a commercial real estate data room. " +
      "Your answers must be based on the document excerpts provided below. " +
      "Rules you must follow:\n" +
      "1. Base your answers on the provided document excerpts. Do not fabricate facts.\n" +
      "2. Synthesise and list information found across the provided excerpts (e.g. all party names, all dates). If a specific piece of information genuinely does not appear in any excerpt, say: \"I couldn't find that in the available documents.\"\n" +
      "3. Do not reference documents from other deals or external sources.\n" +
      "4. Always cite the source document filename when presenting specific facts.\n" +
      "5. Do not speculate or fill gaps — only report what the documents state."
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
}
