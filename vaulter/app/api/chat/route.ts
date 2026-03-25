import { openai } from "@ai-sdk/openai"
import { frontendTools } from "@assistant-ui/react-ai-sdk"
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type JSONSchema7,
  type UIMessage,
} from "ai"

export const maxDuration = 30

export async function POST(req: Request) {
  const body = await req.json()
  const messages = body.messages as UIMessage[]
  const system = body.system as string | undefined
  const tools = (body.tools ?? {}) as Record<
    string,
    { description?: string; parameters: JSONSchema7 }
  >

  const result = streamText({
    model: openai("gpt-4o"),
    messages: await convertToModelMessages(messages),
    ...(system ? { system } : {}),
    stopWhen: stepCountIs(10),
    tools: frontendTools(tools),
  })

  return result.toUIMessageStreamResponse()
}
