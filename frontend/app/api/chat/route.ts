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

/** Call backend RAG search and return formatted context block, or "" if unavailable. */
async function fetchRagContext(
  query: string,
  dealId: string,
  authToken: string,
): Promise<string> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/deals/${dealId}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ query, top_k: 8 }),
    })
    if (!res.ok) return ""
    const body = await res.json()
    const chunks: Array<{ content: string; filename?: string; score: number }> =
      body.data ?? []
    if (!chunks.length) return ""

    const lines = chunks.map((c, i) => {
      const src = c.filename ? ` [${c.filename}]` : ""
      return `### Chunk ${i + 1}${src} (relevance: ${(c.score * 100).toFixed(0)}%)\n${c.content}`
    })
    return `The following excerpts are the most relevant passages retrieved from the data room documents for this query:\n\n${lines.join("\n\n")}`
  } catch {
    return ""
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
  if (dealId && authToken) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")
    const queryText =
      lastUserMsg?.content
        ? typeof lastUserMsg.content === "string"
          ? lastUserMsg.content
          : lastUserMsg.content
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join(" ")
        : ""
    if (queryText.trim()) {
      ragContext = await fetchRagContext(queryText.trim(), dealId, authToken)
    }
  }

  // When we have a deal but no RAG context was found, let the model know
  const noRagNotice =
    dealId && !ragContext
      ? "No indexed document data was found for this deal. The files in this data room have not been processed for RAG yet, so you cannot reference their contents. Let the user know that no document data is available and suggest they run AI processing first."
      : ""

  // Prepend RAG context (or the no-data notice) to the system prompt
  const effectiveSystem = [ragContext || noRagNotice, system]
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
