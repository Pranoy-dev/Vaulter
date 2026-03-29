"use client"

import * as React from "react"
import { CheckCircle2, CircleDashed, Loader2, AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  stageStatus,
  useProcessingStatus,
  type ProcessingJobState,
} from "@/hooks/use-processing-status"
import { useAuth } from "@clerk/nextjs"
import { apiFetch } from "@/lib/api-client"

const STAGES = [
  {
    key: "indexing" as const,
    label: "Document Indexing",
    description: "Extracting and indexing text for RAG search",
  },
  {
    key: "document_processing" as const,
    label: "AI Document Processing",
    description: "Extracting text, classifying, and checking completeness via Gemini",
  },
  {
    key: "detecting_duplicates" as const,
    label: "Duplicate Detection",
    description: "Finding exact and near-duplicate files",
  },
  {
    key: "linking_documents" as const,
    label: "Lease Linking",
    description: "Building lease amendment chains",
  },
  {
    key: "building_overview" as const,
    label: "Building Overview",
    description: "Computing summaries and insight data",
  },
]

function StageRow({
  label,
  description,
  status,
  subStage,
  currentFile,
  aiDetail,
  ragDetail,
}: {
  label: string
  description: string
  status: "idle" | "pending" | "running" | "completed" | "failed"
  subStage?: string | null
  currentFile?: string | null
  aiDetail?: { current: number; total: number } | null
  ragDetail?: { current: number; total: number } | null
}) {
  const isDocRunning = status === "running" && (aiDetail || ragDetail)

  const aiPct = aiDetail && aiDetail.total > 0 ? Math.round((aiDetail.current / aiDetail.total) * 100) : 0
  const ragPct = ragDetail && ragDetail.total > 0 ? Math.round((ragDetail.current / ragDetail.total) * 100) : 0

  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-2.5">
      <span className="shrink-0 mt-0.5">
        {status === "completed" && <CheckCircle2 className="size-4 text-green-600" />}
        {status === "running" && <Loader2 className="size-4 animate-spin text-primary" />}
        {status === "pending" && <CircleDashed className="size-4 text-muted-foreground/50" />}
        {status === "idle" && <CircleDashed className="size-4 text-muted-foreground/30" />}
        {status === "failed" && <AlertCircle className="size-4 text-destructive" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p
            className={`text-xs font-medium ${
              status === "completed"
                ? "text-foreground"
                : status === "running"
                  ? "text-foreground"
                  : status === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground"
            }`}
          >
            {label}
          </p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              status === "completed"
                ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                : status === "running"
                  ? "bg-primary/10 text-primary"
                  : status === "failed"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground/60"
            }`}
          >
            {status === "idle" ? "—" : status}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/70">{description}</p>

        {/* Sub-stage details — separate AI and RAG progress */}
        {isDocRunning && (
          <div className="mt-2 space-y-2">
            {/* AI Classification row */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary">
                  {subStage === "ai_processing" && <Loader2 className="size-2.5 animate-spin" />}
                  AI Classification
                </span>
                <span className="text-[10px] font-semibold tabular-nums text-primary">
                  {aiDetail ? `${aiDetail.current}/${aiDetail.total}` : "—"} ({aiPct}%)
                </span>
              </div>
              <Progress value={aiPct} className="h-1" />
            </div>

            {/* RAG Embedding row */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                  {subStage === "rag_processing" && <Loader2 className="size-2.5 animate-spin text-violet-600 dark:text-violet-400" />}
                  RAG Embedding
                </span>
                <span className="text-[10px] font-semibold tabular-nums text-violet-600 dark:text-violet-400">
                  {ragDetail ? `${ragDetail.current}/${ragDetail.total}` : "—"} ({ragPct}%)
                </span>
              </div>
              <Progress value={ragPct} className="h-1 [&_[data-slot=progress-indicator]]:bg-violet-500" />
            </div>

            {/* Current file */}
            {currentFile && (
              <p className="truncate text-[10px] text-muted-foreground" title={currentFile}>
                ↳ {currentFile}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function ProcessingStatusPanel({ dealId }: { dealId: string | null }) {
  const job = useProcessingStatus(dealId)
  const { getToken } = useAuth()

  const triggerProcessing = async () => {
    if (!dealId) return
    await apiFetch(`/api/deals/${dealId}/process`, getToken, { method: "POST" })
  }

  // Don't render anything until a real job exists
  if (job.status === null) return null

  const isActive = job.status === "running"
  const hasError = job.status === "failed"

  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-background/80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          {isActive && <Loader2 className="size-3.5 animate-spin text-primary" />}
          {job.status === "completed" && <CheckCircle2 className="size-3.5 text-green-600" />}
          {hasError && <AlertCircle className="size-3.5 text-destructive" />}
          {job.status === "pending" && !isActive && <CircleDashed className="size-3.5 text-muted-foreground/50" />}
          <span className="text-xs font-semibold">
            {job.status === "completed"
              ? "Processing complete"
              : job.status === "failed"
                ? "Processing failed"
                : job.status === "running"
                  ? "Processing…"
                  : "Processing queued"}
          </span>
        </div>
        {hasError && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs"
            onClick={triggerProcessing}
          >
            <RefreshCw className="size-3" />
            Retry
          </Button>
        )}
      </div>

      {/* Overall progress bar */}
      {(isActive || job.status === "completed") && (
        <div className="px-3 pt-2.5 pb-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Overall progress</span>
            <span className="text-[10px] font-semibold text-foreground">{Math.round(job.progress * 100)}%</span>
          </div>
          <Progress value={job.progress * 100} className="h-1" />
        </div>
      )}

      {/* Stage rows */}
      <div className="divide-y divide-border/40 py-0.5">
        {STAGES.map((stage) => {
          const status = stageStatus(stage.key, job)
          const isDocProcessing = stage.key === "document_processing"
          return (
            <StageRow
              key={stage.key}
              label={stage.label}
              description={stage.description}
              status={status}
              subStage={isDocProcessing && status === "running" ? job.subStage : null}
              currentFile={isDocProcessing && status === "running" ? job.currentFile : null}
              aiDetail={isDocProcessing && status === "running" ? job.aiDetail : null}
              ragDetail={isDocProcessing && status === "running" ? job.ragDetail : null}
            />
          )
        })}
      </div>

      {/* Error message */}
      {hasError && job.errorMessage && (
        <div className="border-t border-border/60 bg-destructive/5 px-3 py-2">
          <p className="text-xs text-destructive">{job.errorMessage}</p>
        </div>
      )}
    </div>
  )
}
