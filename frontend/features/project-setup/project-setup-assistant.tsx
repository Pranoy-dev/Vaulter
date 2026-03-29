"use client"

import { Thread } from "@/components/assistant-ui/thread"
import { AssistantRuntimeProvider } from "@assistant-ui/react"
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk"
import { useAuth } from "@clerk/nextjs"
import { cn } from "@/lib/utils"
import * as React from "react"
import type { ReactNode } from "react"
import { HistoryIcon, PlusIcon, Trash2Icon } from "lucide-react"
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
  authToken,
  currentSessionId,
  onLoadSession,
  onDeleteSession,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dealId: string | null | undefined
  authToken: string | null
  currentSessionId: string
  onLoadSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
}) {
  const [sessions, setSessions] = React.useState<ChatSession[]>([])
  const [loading, setLoading] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || !dealId || !authToken) return
    setLoading(true)
    fetch(`${BACKEND_URL}/api/deals/${dealId}/chat/sessions`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => r.json())
      .then((body) => setSessions(body.data ?? []))
      .catch(() => toast.error("Failed to load chat history"))
      .finally(() => setLoading(false))
  }, [open, dealId, authToken])

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    if (!dealId || !authToken) return
    setDeletingId(sessionId)
    try {
      const res = await fetch(`${BACKEND_URL}/api/deals/${dealId}/chat/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
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
            <button
              key={s.id}
              onClick={() => { onLoadSession(s.id); onOpenChange(false) }}
              className={cn(
                "group w-full flex items-start justify-between gap-2 px-4 py-2.5 text-left hover:bg-white/5 transition-colors",
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
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── Chat instance (re-mounts on resetKey change) ──────────────────────────

function ChatInstance({
  chatPrepend,
  dealId,
  initialSessionId,
  onNewChat,
  onDeleteChat,
  onOpenHistory,
  isDeleting,
  chatDisabled,
}: {
  chatPrepend?: ReactNode
  dealId?: string | null
  initialSessionId: string
  onNewChat: () => void
  onDeleteChat: (sessionId: string) => void
  onOpenHistory: () => void
  isDeleting: boolean
  chatDisabled?: boolean
}) {
  const sessionId = initialSessionId

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

  const runtime = useChatRuntime({ transport })

  const [hasSentMessage, setHasSentMessage] = React.useState(false)
  React.useEffect(() => {
    return runtime.thread.subscribe(() => {
      const msgs = runtime.thread.getState().messages
      if (msgs.length > 0) setHasSentMessage(true)
    })
  }, [runtime])

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        {/* Chat action bar */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">Chat</span>
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

        {/* Thread */}
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
      </div>
    </AssistantRuntimeProvider>
  )
}

// ── Public component ──────────────────────────────────────────────────────

export function ProjectSetupAssistant({
  chatPrepend,
  dealId,
  chatDisabled,
}: {
  chatPrepend?: ReactNode
  dealId?: string | null
  chatDisabled?: boolean
}) {
  const { getToken } = useAuth()
  // resetKey forces full re-mount of ChatInstance (new session)
  const [resetKey, setResetKey] = React.useState(0)
  // activeSessionId is seeded into the new ChatInstance on load from history
  const [activeSessionId, setActiveSessionId] = React.useState(() => crypto.randomUUID())
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)

  // authToken is only needed for the history sheet and delete calls
  // (the transport itself uses the Authorization header for /api/chat)
  const [authToken, setAuthToken] = React.useState<string | null>(null)
  React.useEffect(() => {
    getToken().then((t) => setAuthToken(t ?? null))
  }, [getToken])

  const handleNewChat = () => {
    setActiveSessionId(crypto.randomUUID())
    setResetKey((k) => k + 1)
  }

  const handleDeleteChat = async (sessionId: string) => {
    if (!dealId || !authToken) return
    setIsDeleting(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/deals/${dealId}/chat/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
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
        authToken={authToken}
        currentSessionId={activeSessionId}
        onLoadSession={handleLoadSession}
        onDeleteSession={handleHistoryDelete}
      />
    </>
  )
}
