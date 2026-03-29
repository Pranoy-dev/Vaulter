"use client"

import { Thread } from "@/components/assistant-ui/thread"
import { AssistantRuntimeProvider } from "@assistant-ui/react"
import { useChatRuntime } from "@assistant-ui/react-ai-sdk"
import { useAuth } from "@clerk/nextjs"
import { cn } from "@/lib/utils"
import * as React from "react"
import type { ReactNode } from "react"

export function ProjectSetupAssistant({
  chatPrepend,
  dealId,
}: {
  chatPrepend?: ReactNode
  dealId?: string | null
}) {
  const { getToken } = useAuth()
  const [authToken, setAuthToken] = React.useState<string | null>(null)

  // Refresh token once on mount then every 50 minutes (Clerk tokens live ~60 min).
  // This keeps the token fresh for long-running sessions without requiring a page reload.
  React.useEffect(() => {
    const refresh = () => getToken().then((t) => setAuthToken(t ?? null))
    refresh()
    const interval = setInterval(refresh, 50 * 60 * 1000)
    return () => clearInterval(interval)
  }, [getToken])

  const runtime = useChatRuntime({
    api: "/api/chat",
    body: {
      ...(dealId ? { dealId } : {}),
      ...(authToken ? { authToken } : {}),
    },
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div
        className={cn(
          "aui-sidechat flex h-full min-h-0 min-w-0 flex-col",
          "[--thread-max-width:100%]",
          "[&_.aui-thread-viewport]:px-2 [&_.aui-thread-viewport]:pb-0 [&_.aui-thread-viewport]:pl-2 [&_.aui-thread-viewport]:pr-2 [&_.aui-thread-viewport]:pt-0",
          "[&_.aui-thread-chat-prepend]:-mx-2 [&_.aui-thread-chat-prepend]:border-white/10 [&_.aui-thread-chat-prepend]:px-0 [&_.aui-thread-chat-prepend]:pt-3",
          "[&_.aui-thread-viewport]:scroll-pt-3",
          "[&_.aui-thread-viewport-footer]:mx-0 [&_.aui-thread-viewport-footer]:max-w-none [&_.aui-thread-viewport-footer]:w-full [&_.aui-thread-viewport-footer]:pb-2 [&_.aui-thread-viewport-footer]:md:pb-3",
          "[&_.aui-assistant-message-root]:mx-0 [&_.aui-assistant-message-root]:max-w-none",
          "[&_.aui-user-message-root]:mx-0 [&_.aui-user-message-root]:max-w-none",
          "[&_.aui-thread-scroll-to-bottom]:self-start [&_.aui-thread-scroll-to-bottom]:left-2 [&_.aui-thread-scroll-to-bottom]:-translate-x-0"
        )}
      >
        <Thread chatPrepend={chatPrepend} />
      </div>
    </AssistantRuntimeProvider>
  )
}
