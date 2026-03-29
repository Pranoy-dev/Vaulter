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

type RagResult =
  | { ok: true; context: string }
  | { ok: false; reason: "auth_expired" | "no_data" | "error" }

/**
 * Expand short/vague queries into richer semantic terms so cosine similarity
 * has more signal to work with. Maps common intents to domain vocabulary.
 */
function expandQuery(query: string): string {
  const q = query.toLowerCase()
  const expansions: Array<[RegExp, string]> = [
    [/\bclients?\b|\btenants?\b|\blessees?\b|\bparties\b|\bbuyers?\b|\bsellers?\b/,
      "client tenant lessee buyer seller party company name signatory principal"],
    [/\brent\b|\blease\b|\bmonthly\b|\bpayment\b/,
      "rent amount monthly payment lease term rental price"],
    [/\bexpir(y|ation|e)\b|\bend date\b|\btermination\b/,
      "expiry date termination end date lease expiration"],
    [/\bsignatur(e|es)\b|\bsigned\b|\bexecut(ed|ion)\b/,
      "signature signed executed parties execution date"],
    [/\bfinancial\b|\bprice\b|\bvalue\b|\bamount\b/,
      "financial terms price value amount payment cost"],
  ]
  let expanded = query
  for (const [pattern, extra] of expansions) {
    if (pattern.test(q)) {
      expanded = `${query} ${extra}`
      break
    }
  }
  return expanded
}

/** Call backend RAG search and return formatted context block or a typed failure. */
async function fetchRagContext(
  query: string,
  dealId: string,
  authToken: string,
): Promise<RagResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/deals/${dealId}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ query, top_k: 12 }),
    })
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth_expired" }
    if (!res.ok) return { ok: false, reason: "error" }
    const body = await res.json()
    const chunks: Array<{ content: string; filename?: string; score: number }> =
      body.data ?? []
    if (!chunks.length) return { ok: false, reason: "no_data" }

    const lines = chunks.map((c, i) => {
      const src = c.filename ? ` [${c.filename}]` : ""
      return `### Chunk ${i + 1}${src} (relevance: ${(c.score * 100).toFixed(0)}%)\n${c.content}`
    })
    return {
      ok: true,
      context: `The following excerpts are the most relevant passages retrieved from the data room documents for this query:\n\n${lines.join("\n\n")}`,
    }
  } catch {
    return { ok: false, reason: "error" }
  }
}

export const maxDuration = 30

export async function POST(req: Request) {
  const body = await req.json()
  const messages = body.messages as UIMessage[]
  const system = body.system as string | undefined
  const tools = (body.tools ?? {}) as Record<
    string,
    { description?: string; parameters: JSONSchema7 }
  >
  const dealId: string | undefined = body.dealId
  const authToken: string | undefined = body.authToken

  // Extract the latest user message text for RAG retrieval
  let ragContext = ""
  let ragNotice = ""

  if (dealId && authToken) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")
    const queryText = lastUserMsg
      ? lastUserMsg.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join(" ")
      : ""
    if (queryText.trim()) {
      const expandedQuery = expandQuery(queryText.trim())
      const result = await fetchRagContext(expandedQuery, dealId, authToken)
      if (result.ok) {
        ragContext = result.context
      } else if (result.reason === "auth_expired") {
        ragNotice =
          "The user's session has expired and document search is temporarily unavailable. " +
          "Inform the user that their session has expired and they should refresh the page to restore AI document search."
      } else if (result.reason === "no_data") {
        ragNotice =
          "No indexed document data was found for this deal. The files in this data room have not been processed for RAG yet. " +
          "Let the user know that no document data is available and suggest they run AI processing first."
      }
      // reason === "error": backend unreachable — answer without RAG context, no special notice
    }
  } else if (dealId && !authToken) {
    ragNotice =
      "The user's session token is missing. Document search is unavailable. " +
      "Ask the user to refresh the page."
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

  const result = streamText({
    model: openai("gpt-4o"),
    messages: await convertToModelMessages(messages),
    ...(effectiveSystem ? { system: effectiveSystem } : {}),
    stopWhen: stepCountIs(10),
    tools: frontendTools(tools),
  })

  return result.toUIMessageStreamResponse()
}
