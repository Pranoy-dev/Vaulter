"use client"

import * as React from "react"
import { useAuth } from "@clerk/nextjs"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""
const POLL_INTERVAL_ACTIVE_MS = 5000
const POLL_INTERVAL_HIDDEN_MS = 15000

export type ProcessingStatus = "pending" | "running" | "completed" | "failed" | null
export type ProcessingStage =
  | "indexing"
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
  /** true while the first fetch is in-flight */
  loading: boolean
}

const STAGE_ORDER: Exclude<ProcessingStage, null | "done">[] = [
  "indexing",
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

export function useProcessingStatus(dealId: string | null): ProcessingJobState {
  const { getToken } = useAuth()
  const [state, setState] = React.useState<ProcessingJobState>({
    status: null,
    currentStage: null,
    progress: 0,
    errorMessage: null,
    loading: false,
  })
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFetchingRef = React.useRef(false)
  // Keep a stable ref to getToken so we never need it in effect deps
  const getTokenRef = React.useRef(getToken)
  React.useEffect(() => { getTokenRef.current = getToken }, [getToken])

  const fetchStatus = React.useCallback(async () => {
    if (!dealId || isFetchingRef.current) return
    isFetchingRef.current = true
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
      if (!res.ok) return
      const body = await res.json()
      const data = body.data ?? body
      setState({
        status: data.status ?? null,
        currentStage: data.current_stage ?? null,
        progress: data.progress ?? 0,
        errorMessage: data.error_message ?? null,
        loading: false,
      })
    } catch {
      setState((s) => ({ ...s, loading: false }))
    } finally {
      isFetchingRef.current = false
    }
  }, [dealId])

  React.useEffect(() => {
    if (!dealId) return

    setState((s) => ({ ...s, loading: true }))
    fetchStatus()

    const schedule = () => {
      const interval = document.hidden ? POLL_INTERVAL_HIDDEN_MS : POLL_INTERVAL_ACTIVE_MS
      timerRef.current = setTimeout(async () => {
        await fetchStatus()
        setState((current) => {
          if (current.status === "running" || current.status === "pending") {
            schedule()
          }
          return current
        })
      }, interval)
    }
    schedule()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [dealId, fetchStatus])

  // When a running job completes, do one final fetch after a short delay
  const prevStatus = React.useRef<ProcessingStatus>(null)
  React.useEffect(() => {
    if (prevStatus.current === "running" && state.status === "completed") {
      // already got the completed state — no extra fetch needed
    }
    prevStatus.current = state.status
  }, [state.status])

  return state
}
