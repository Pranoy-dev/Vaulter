"use client"

import { Thread } from "@/components/assistant-ui/thread"
import { AssistantRuntimeProvider } from "@assistant-ui/react"
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk"
import { useAuth } from "@clerk/nextjs"
import { cn } from "@/lib/utils"
import * as React from "react"
import type { ReactNode } from "react"
import type { UIMessage } from "ai"
import { HistoryIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { toast } from "sonner"
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""

// ── Types ─────────────────────────────────────────────────────────────────

interface ChatSession {
  id: string
  title: string | null
  created_at: string
  updated_at: string
}

// ── History panel ─────────────────────────────────────────────────────────

function ChatHistorySheet({
  open,
  onOpenChange,
  dealId,
  getToken,
  currentSessionId,
  onLoadSession,
  onDeleteSession,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dealId: string | null | undefined
  getToken: () => Promise<string | null>
  currentSessionId: string
  onLoadSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
}) {
  const [sessions, setSessions] = React.useState<ChatSession[]>([])
  const [loading, setLoading] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || !dealId) return
    setLoading(true)
    getToken().then((token) => {
      if (!token) { setLoading(false); return }
      fetch(`${BACKEND_URL}/api/deals/${dealId}/chat/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((body) => setSessions(body.data ?? []))
        .catch(() => toast.error("Failed to load chat history"))
        .finally(() => setLoading(false))
    })
  }, [open, dealId, getToken])

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (!dealId) return
    const token = await getToken()
    if (!token) return
    setDeletingId(sessionId)
    try {
      const res = await fetch(`${BACKEND_URL}/api/deals/${dealId}/chat/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error()
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      onDeleteSession(sessionId)
      toast.success("Chat deleted")
    } catch {
      toast.error("Failed to delete chat")
    } finally {
      setDeletingId(null)
    }
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    if (diffDays === 1) return "Yesterday"
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" })
    return d.toLocaleDateString([], { month: "short", day: "numeric" })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-white/10">
          <SheetTitle className="text-sm">Chat History</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto py-2">
          {loading && (
            <p className="px-4 py-6 text-xs text-muted-foreground text-center">Loading…</p>
          )}
          {!loading && sessions.length === 0 && (
            <p className="px-4 py-6 text-xs text-muted-foreground text-center">No saved chats yet.</p>
          )}
          {!loading && sessions.map((s) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => { onLoadSession(s.id); onOpenChange(false) }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { onLoadSession(s.id); onOpenChange(false) } }}
              className={cn(
                "group w-full flex items-start justify-between gap-2 px-4 py-2.5 text-left hover:bg-white/5 transition-colors cursor-pointer",
                s.id === currentSessionId && "bg-white/8"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">
                  {s.title || "Untitled chat"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {formatDate(s.updated_at)}
                </p>
              </div>
              <button
                onClick={(e) => handleDelete(e, s.id)}
                disabled={deletingId === s.id}
                className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                title="Delete this chat"
              >
                <Trash2Icon className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Inner component that owns useChatRuntime (so it mounts fresh once messages are ready) ──

function ChatThreadView({
  transport,
  initialMessages,
  chatPrepend,
  dealId,
  sessionId,
  isHistoricSession,
  getToken,
  onTitleResolved,
  onHasSentMessage,
  chatDisabled,
}: {
  transport: AssistantChatTransport
  initialMessages: UIMessage[]
  chatPrepend?: ReactNode
  dealId?: string | null
  sessionId: string
  isHistoricSession?: boolean
  getToken: () => Promise<string | null>
  onTitleResolved: (title: string) => void
  onHasSentMessage: () => void
  chatDisabled?: boolean
}) {
  const runtime = useChatRuntime({
    transport,
    ...(initialMessages.length > 0 ? { messages: initialMessages } : {}),
  })

  React.useEffect(() => {
    return runtime.thread.subscribe(() => {
      const msgs = runtime.thread.getState().messages
      if (msgs.length > 0) onHasSentMessage()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime])

  // Fetch the backend-generated session title once an assistant message arrives (new sessions).
  // For historic sessions the title was already fetched by the parent.
  const hasAssistantMsg = React.useRef(false)
  const cancelTitleFetch = React.useRef(false)
  React.useEffect(() => {
    if (isHistoricSession) return // title already resolved by parent
    cancelTitleFetch.current = false
    const unsubscribe = runtime.thread.subscribe(async () => {
      const msgs = runtime.thread.getState().messages
      const assistantArrived = msgs.some((m) => m.role === "assistant")
      if (!assistantArrived || hasAssistantMsg.current || !dealId) return
      hasAssistantMsg.current = true
      const fetchTitle = async (attempt = 0) => {
        if (cancelTitleFetch.current) return
        try {
          const token = await getToken()
          if (!token || cancelTitleFetch.current) return
          const res = await fetch(`${BACKEND_URL}/api/deals/${dealId}/chat/sessions`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          const body = await res.json()
          const session = (body.data ?? []).find((s: ChatSession) => s.id === sessionId)
          if (cancelTitleFetch.current) return
          if (session?.title) {
            onTitleResolved(session.title)
          } else if (attempt < 5) {
            setTimeout(() => fetchTitle(attempt + 1), 2000)
          }
        } catch {}
      }
      setTimeout(() => fetchTitle(), 1500)
    })
    return () => {
      cancelTitleFetch.current = true
      unsubscribe()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime])

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div
        className={cn(
          "aui-sidechat flex min-h-0 flex-1 flex-col",
          "[--thread-max-width:100%]",
          "[&_.aui-thread-viewport]:px-2 [&_.aui-thread-viewport]:pb-0 [&_.aui-thread-viewport]:pl-2 [&_.aui-thread-viewport]:pr-2 [&_.aui-thread-viewport]:pt-0",
          "[&_.aui-thread-chat-prepend]:-mx-2 [&_.aui-thread-chat-prepend]:border-white/10 [&_.aui-thread-chat-prepend]:px-0 [&_.aui-thread-chat-prepend]:pt-3",
          "[&_.aui-thread-viewport]:scroll-pt-3",
          "[&_.aui-thread-viewport-footer]:mx-0 [&_.aui-thread-viewport-footer]:max-w-none [&_.aui-thread-viewport-footer]:w-full [&_.aui-thread-viewport-footer]:pb-2 [&_.aui-thread-viewport-footer]:md:pb-3",
          "[&_.aui-assistant-message-root]:mx-0 [&_.aui-assistant-message-root]:max-w-none",
          "[&_.aui-user-message-root]:mx-0 [&_.aui-user-message-root]:max-w-none",
          "[&_.aui-thread-scroll-to-bottom]:self-start [&_.aui-thread-scroll-to-bottom]:left-2 [&_.aui-thread-scroll-to-bottom]:-translate-x-0",
        )}
      >
        <Thread chatPrepend={chatPrepend} disabled={chatDisabled} />
      </div>
    </AssistantRuntimeProvider>
  )
}

// ── Chat instance (re-mounts on resetKey change) ──────────────────────────

function ChatInstance({
  chatPrepend,
  dealId,
  initialSessionId,
  isHistoricSession,
  getToken,
  onNewChat,
  onDeleteChat,
  onOpenHistory,
  isDeleting,
  chatDisabled,
}: {
  chatPrepend?: ReactNode
  dealId?: string | null
  initialSessionId: string
  isHistoricSession?: boolean
  getToken: () => Promise<string | null>
  onNewChat: () => void
  onDeleteChat: (sessionId: string) => void
  onOpenHistory: () => void
  isDeleting: boolean
  chatDisabled?: boolean
}) {
  const sessionId = initialSessionId

  const [resolvedMessages, setResolvedMessages] = React.useState<UIMessage[] | null>(
    isHistoricSession ? null : [],
  )
  const [sessionTitle, setSessionTitle] = React.useState<string | null>(null)
  const [hasSentMessage, setHasSentMessage] = React.useState(!!isHistoricSession)

  // Load messages + title from backend when opening a historic session
  React.useEffect(() => {
    if (!isHistoricSession || !dealId) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token || cancelled) return
        const [msgsRes, sessionsRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/deals/${dealId}/chat/sessions/${sessionId}/messages`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${BACKEND_URL}/api/deals/${dealId}/chat/sessions`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ])
        if (cancelled) return
        const msgsBody = await msgsRes.json()
        const sessionsBody = await sessionsRes.json()
        if (cancelled) return
        const rawMessages: { id: string; role: string; content: string }[] = msgsBody.data ?? []
        const uiMessages: UIMessage[] = rawMessages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          parts: [{ type: "text" as const, text: m.content }],
          content: m.content,
        }))
        const session = (sessionsBody.data ?? []).find((s: ChatSession) => s.id === sessionId)
        if (session?.title && !cancelled) setSessionTitle(session.title)
        if (!cancelled) setResolvedMessages(uiMessages)
      } catch {
        if (!cancelled) setResolvedMessages([])
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const transport = React.useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/chat",
        body: {
          ...(dealId ? { dealId } : {}),
          ...(dealId ? { sessionId } : {}),
        },
      }),
    [dealId, sessionId],
  )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Chat action bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground mr-2" title={sessionTitle ?? undefined}>{sessionTitle ?? "Chat"}</span>
        <div className="flex items-center gap-1">
          {hasSentMessage && dealId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => onDeleteChat(sessionId)}
              disabled={isDeleting}
              title="Delete this chat"
            >
              <Trash2Icon className="h-3.5 w-3.5" />
            </Button>
          )}
          {dealId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={onOpenHistory}
              title="Chat history"
            >
              <HistoryIcon className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onNewChat}
            title="New chat"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {resolvedMessages === null ? (
        /* Loading history */
        <div className="flex flex-1 items-center justify-center text-muted-foreground/50">
          <Loader2Icon className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        /* Thread — mounts fresh once resolvedMessages is set, so useChatRuntime gets messages at init */
        <ChatThreadView
          transport={transport}
          initialMessages={resolvedMessages}
          chatPrepend={chatPrepend}
          dealId={dealId}
          sessionId={sessionId}
          isHistoricSession={isHistoricSession}
          getToken={getToken}
          onTitleResolved={setSessionTitle}
          onHasSentMessage={() => setHasSentMessage(true)}
          chatDisabled={chatDisabled}
        />
      )}
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────

export function ProjectSetupAssistant({
  chatPrepend,
  dealId,
  chatDisabled,
  onNewChat: onNewChatProp,
}: {
  chatPrepend?: ReactNode
  dealId?: string | null
  chatDisabled?: boolean
  onNewChat?: () => void
}) {
  const { getToken } = useAuth()
  // resetKey forces full re-mount of ChatInstance (new session)
  const [resetKey, setResetKey] = React.useState(0)
  // activeSessionId is seeded into the new ChatInstance on load from history
  const [activeSessionId, setActiveSessionId] = React.useState(() => crypto.randomUUID())
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [isHistoricSession, setIsHistoricSession] = React.useState(false)

  const handleNewChat = () => {
    setActiveSessionId(crypto.randomUUID())
    setIsHistoricSession(false)
    setResetKey((k) => k + 1)
    onNewChatProp?.()
  }

  const handleDeleteChat = async (sessionId: string) => {
    if (!dealId) return
    const token = await getToken()
    if (!token) return
    setIsDeleting(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/deals/${dealId}/chat/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error("Delete failed")
      toast.success("Chat deleted")
    } catch {
      toast.error("Failed to delete chat")
    } finally {
      setIsDeleting(false)
      handleNewChat()
    }
  }

  const handleLoadSession = (sessionId: string) => {
    setActiveSessionId(sessionId)
    setIsHistoricSession(true)
    setResetKey((k) => k + 1)
  }

  // When a session is deleted from the history panel and it was the active one,
  // start a new chat automatically.
  const handleHistoryDelete = (sessionId: string) => {
    if (sessionId === activeSessionId) handleNewChat()
  }

  return (
    <>
      <ChatInstance
        key={resetKey}
        chatPrepend={chatPrepend}
        dealId={dealId}
        initialSessionId={activeSessionId}
        isHistoricSession={isHistoricSession}
        getToken={getToken}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        onOpenHistory={() => setHistoryOpen(true)}
        isDeleting={isDeleting}
        chatDisabled={chatDisabled}
      />
      <ChatHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        dealId={dealId}
        getToken={getToken}
        currentSessionId={activeSessionId}
        onLoadSession={handleLoadSession}
        onDeleteSession={handleHistoryDelete}
      />
    </>
  )
}
