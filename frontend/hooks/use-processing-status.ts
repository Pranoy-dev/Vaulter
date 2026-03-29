"use client"

import * as React from "react"
import { useAuth } from "@clerk/nextjs"
import { io, Socket } from "socket.io-client"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""

export type ProcessingStatus = "pending" | "running" | "completed" | "failed" | null
export type ProcessingStage =
  | "indexing"
  | "detecting_hash_duplicates"
  | "document_processing"
  | "detecting_duplicates"
  | "linking_documents"
  | "building_overview"
  | "done"
  | null

export interface ProcessingJobState {
  status: ProcessingStatus
  currentStage: ProcessingStage
  progress: number
  errorMessage: string | null
  /** Sub-stage within document_processing: "ai_processing" | "rag_processing" */
  subStage: string | null
  /** Human-readable detail like "3/10" */
  stageDetail: string | null
  /** Filename of the document currently being processed */
  currentFile: string | null
  /** AI classification progress: { current, total } */
  aiDetail: { current: number; total: number } | null
  /** RAG embedding progress: { current, total } */
  ragDetail: { current: number; total: number } | null
  /** true while the first fetch is in-flight */
  loading: boolean
}

const STAGE_ORDER: Exclude<ProcessingStage, null | "done">[] = [
  "indexing",
  "detecting_hash_duplicates",
  "document_processing",
  "detecting_duplicates",
  "linking_documents",
  "building_overview",
]

/** Returns status of a single stage given the overall job state. */
export function stageStatus(
  stage: Exclude<ProcessingStage, null | "done">,
  job: ProcessingJobState,
): "pending" | "running" | "completed" | "failed" | "idle" {
  if (!job.status || job.status === null) return "idle"
  if (job.status === "failed") {
    const idx = STAGE_ORDER.indexOf(stage)
    const curIdx = job.currentStage ? STAGE_ORDER.indexOf(job.currentStage as any) : -1
    if (idx < curIdx) return "completed"
    if (idx === curIdx) return "failed"
    return "pending"
  }
  if (job.status === "completed" || job.currentStage === "done") return "completed"
  if (job.status === "pending") return "pending"

  // running
  const idx = STAGE_ORDER.indexOf(stage)
  const curIdx = job.currentStage ? STAGE_ORDER.indexOf(job.currentStage as any) : -1
  if (curIdx === -1) return "pending"
  if (idx < curIdx) return "completed"
  if (idx === curIdx) return "running"
  return "pending"
}

/** Parse "3/10" → { current: 3, total: 10 } or null. */
function _parseDetail(detail: string | null | undefined): { current: number; total: number } | null {
  if (!detail) return null
  const m = detail.match(/^(\d+)\/(\d+)$/)
  if (!m) return null
  return { current: parseInt(m[1], 10), total: parseInt(m[2], 10) }
}

export function useProcessingStatus(dealId: string | null): ProcessingJobState {
  const { getToken } = useAuth()
  const [state, setState] = React.useState<ProcessingJobState>({
    status: null,
    currentStage: null,
    progress: 0,
    errorMessage: null,
    subStage: null,
    stageDetail: null,
    currentFile: null,
    aiDetail: null,
    ragDetail: null,
    loading: false,
  })
  const socketRef = React.useRef<Socket | null>(null)
  const getTokenRef = React.useRef(getToken)
  React.useEffect(() => { getTokenRef.current = getToken }, [getToken])

  // Fetch initial state via REST (needed on page load / reconnect)
  const fetchInitial = React.useCallback(async () => {
    if (!dealId) return
    try {
      const token = await getTokenRef.current()
      if (!token) return
      const res = await fetch(`${BACKEND_URL}/api/deals/${dealId}/process`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 404) {
        setState((s) => ({ ...s, loading: false, status: null }))
        return
      }
      if (!res.ok) {
        setState((s) => ({ ...s, loading: false }))
        return
      }
      const body = await res.json()
      const data = body.data ?? body
      setState({
        status: data.status ?? null,
        currentStage: data.current_stage ?? null,
        progress: data.progress ?? 0,
        errorMessage: data.error_message ?? null,
        subStage: data.sub_stage ?? null,
        stageDetail: data.stage_detail ?? null,
        currentFile: data.current_file ?? null,
        aiDetail: _parseDetail(data.ai_detail),
        ragDetail: _parseDetail(data.rag_detail),
        loading: false,
      })
    } catch {
      setState((s) => ({ ...s, loading: false }))
    }
  }, [dealId])

  React.useEffect(() => {
    if (!dealId) return

    setState((s) => ({ ...s, loading: true }))

    // Connect Socket.IO for real-time updates
    const isDev = process.env.NODE_ENV === "development"
    const socket = io(BACKEND_URL, {
      path: "/socket.io",
      // In dev, uvicorn --reload breaks WebSocket upgrade; use polling only.
      // In production (no --reload), allow WebSocket upgrade for lower latency.
      transports: isDev ? ["polling"] : ["polling", "websocket"],
      upgrade: !isDev,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })
    socketRef.current = socket

    socket.on("connect", () => {
      socket.emit("join_deal", { deal_id: dealId })
      // Fetch current state on (re)connect to fill any gap
      fetchInitial()
    })

    socket.on("processing_update", (data: {
      status?: string | null
      current_stage?: string | null
      progress?: number | null
      error_message?: string | null
      sub_stage?: string | null
      stage_detail?: string | null
      current_file?: string | null
      ai_detail?: string | null
      rag_detail?: string | null
    }) => {
      setState((prev) => ({
        status: (data.status ?? prev.status) as ProcessingStatus,
        currentStage: (data.current_stage ?? prev.currentStage) as ProcessingStage,
        progress: data.progress ?? prev.progress,
        errorMessage: data.error_message !== undefined ? data.error_message : prev.errorMessage,
        subStage: data.sub_stage !== undefined ? data.sub_stage : prev.subStage,
        stageDetail: data.stage_detail !== undefined ? data.stage_detail : prev.stageDetail,
        currentFile: data.current_file !== undefined ? data.current_file : prev.currentFile,
        aiDetail: data.ai_detail !== undefined ? _parseDetail(data.ai_detail) : prev.aiDetail,
        ragDetail: data.rag_detail !== undefined ? _parseDetail(data.rag_detail) : prev.ragDetail,
        loading: false,
      }))
    })

    socket.on("disconnect", () => {
      // Socket.IO will auto-reconnect; no action needed
    })

    // Fallback: poll every 15s regardless of socket health
    const pollInterval = setInterval(() => {
      fetchInitial()
    }, 15_000)

    return () => {
      clearInterval(pollInterval)
      socket.emit("leave_deal", { deal_id: dealId })
      socket.disconnect()
      socketRef.current = null
    }
  }, [dealId, fetchInitial])

  return state
}
