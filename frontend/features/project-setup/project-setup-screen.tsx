"use client"

import * as React from "react"
import { useAuth } from "@clerk/nextjs"
import { ProjectSetupAssistant } from "@/features/project-setup/project-setup-assistant"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { DemoAgentProcessingLog } from "@/features/project-setup/demo-workspace/demo-agent-processing-log"
import { DEMO_WORKSPACE_TITLE } from "@/features/project-setup/demo-workspace/mock-data"
import {
  DemoAiInsightsPanel,
  DemoDuplicatesPanel,
  DemoFileStructurePanel,
  DemoLeaseChainsPanel,
} from "@/features/project-setup/demo-workspace/demo-workspace-panels"
import {
  ArrowLeft,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  ChevronLeft,
  ExternalLink,
  Eye,
  File as FileIcon,
  Files,
  Shield,
  Trash2,
  FilePenLine,
  Folder,
  FolderTree,
  FolderUp,
  GripVertical,
  LayoutGrid,
  Link2,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react"
import type { FileEntry, UploadProgress } from "@/lib/chunked-upload"
import { uploadFiles, isSupported } from "@/lib/chunked-upload"
import { toast } from "sonner"
import { useDealData } from "@/hooks/use-deal-data"
import type { DealDocument, DuplicateGroup, LeaseChain } from "@/hooks/use-deal-data"
import { useClassifications } from "@/hooks/use-classifications"
import type { Classification } from "@/hooks/use-classifications"
import { useProcessingStatus, stageStatus } from "@/hooks/use-processing-status"
import type { ProcessingJobState } from "@/hooks/use-processing-status"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export type SetupSection =
  | "upload"
  | "ai-insights"
  | "file-structure"
  | "duplication"
  | "lease-amendment"

const sectionToggleItemClass =
  "flex min-h-11 w-full min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-[11px] border-0 bg-transparent px-2 py-2.5 text-center text-[13px] font-medium leading-tight tracking-[-0.015em] antialiased transition-[color,background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:min-h-9 sm:rounded-[10px] sm:px-2.5 sm:py-2 [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:opacity-90 " +
  // light
  "text-zinc-500 hover:bg-black/[0.03] hover:text-zinc-700 hover:shadow-none focus-visible:ring-zinc-900/15 focus-visible:ring-offset-zinc-100/80 data-[state=on]:bg-white data-[state=on]:text-zinc-900 data-[state=on]:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_3px_10px_rgba(0,0,0,0.06)] data-[state=on]:ring-1 data-[state=on]:ring-black/[0.05] data-[state=on]:hover:bg-white [&_svg]:text-zinc-400 data-[state=on]:[&_svg]:text-zinc-600 " +
  // dark
  "dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200 dark:focus-visible:ring-zinc-400/20 dark:focus-visible:ring-offset-zinc-800 dark:data-[state=on]:bg-zinc-700 dark:data-[state=on]:text-zinc-100 dark:data-[state=on]:shadow-[0_1px_3px_rgba(0,0,0,0.3)] dark:data-[state=on]:ring-1 dark:data-[state=on]:ring-white/[0.08] dark:data-[state=on]:hover:bg-zinc-700 dark:[&_svg]:text-zinc-500 dark:data-[state=on]:[&_svg]:text-zinc-300"

const sectionToggleGroupClass =
  "flex w-full flex-col gap-1.5 rounded-[14px] border p-1 backdrop-blur-xl sm:flex-row sm:items-stretch sm:gap-1 sm:rounded-[13px] " +
  // light
  "border-zinc-200/90 bg-zinc-100/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),inset_0_-1px_0_rgba(0,0,0,0.02)] " +
  // dark
  "dark:border-white/[0.08] dark:bg-zinc-800/80 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_-1px_0_rgba(0,0,0,0.15)]"

function ClickTooltip({ content, children }: { content: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <span onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-pre-wrap">{content}</TooltipContent>
    </Tooltip>
  )
}

// ── Temporary status log shown as chat-bubble messages (not persisted to DB) ──

const STAGE_LABELS: Record<string, string> = {
  indexing: "Indexing documents for search…",
  detecting_hash_duplicates: "Checking for identical files…",
  document_processing: "Running AI classification & embeddings…",
  detecting_duplicates: "Detecting content duplicates…",
  linking_documents: "Linking lease amendments…",
  building_overview: "Building project overview…",
  done: "Processing complete!",
}

function StatusChatLog({
  uploadProgress,
  processingJob,
  documents,
}: {
  uploadProgress: UploadProgress
  processingJob: ProcessingJobState
  documents: DealDocument[]
}) {
  const entries: { key: string; text: string; icon: React.ReactNode; accent: string }[] = []

  // Helper: split "Folder/Sub/file.pdf" → { folders: ["Folder","Sub"], filename: "file.pdf" }
  function splitPath(path: string): { folders: string[]; filename: string } {
    const parts = path.replace(/\\/g, "/").split("/")
    const filename = parts.pop() ?? path
    return { folders: parts.filter(Boolean), filename }
  }

  // Push folder-then-file entries for a given path
  function pushFilePath(
    keyPrefix: string,
    path: string,
    icon: React.ReactNode,
    accent: string,
    suffix?: string,
  ) {
    const { folders, filename } = splitPath(path)
    if (folders.length > 0) {
      entries.push({
        key: `${keyPrefix}-folders`,
        text: `📁 ${folders.join(" / ")}`,
        icon: <FileIcon className="size-3.5 opacity-40" />,
        accent: "border-transparent",
      })
    }
    entries.push({
      key: `${keyPrefix}-name`,
      text: `↳ ${filename}${suffix ? ` ${suffix}` : ""}`,
      icon,
      accent,
    })
  }

  // Find the most recently classified document for inline result
  const lastClassified = React.useMemo(() => {
    return documents
      .filter((d) => d.classified_at && d.classification_confidence > 0)
      .sort((a, b) => (b.classified_at ?? "").localeCompare(a.classified_at ?? ""))[0] ?? null
  }, [documents])
  // ── Upload status ──────────────────────────────────────────────────────
  if (uploadProgress.state === "initializing") {
    entries.push({ key: "upload-init", text: "Preparing upload…", icon: <Loader2 className="size-3.5 animate-spin" />, accent: "border-blue-500/50" })
  } else if (uploadProgress.state === "uploading") {
    const fileEntries = Object.values(uploadProgress.files)
    const fileCount = fileEntries.length
    const doneCount = fileEntries.filter((f) => f.progress >= 1).length
    entries.push({
      key: "upload-progress",
      text: `Uploading files — ${uploadProgress.overall}%`,
      icon: <Loader2 className="size-3.5 animate-spin" />,
      accent: "border-blue-500/50",
    })
    entries.push({
      key: "upload-count",
      text: `↳ ${doneCount} of ${fileCount} file${fileCount !== 1 ? "s" : ""} done`,
      icon: <FileIcon className="size-3.5 opacity-50" />,
      accent: "border-transparent",
    })
    // Show the file currently in progress
    const current = fileEntries.find((f) => f.progress > 0 && f.progress < 1)
    if (current) {
      pushFilePath(
        "upload-current",
        current.relativePath,
        <Loader2 className="size-3.5 animate-spin opacity-60" />,
        "border-transparent",
        `(${Math.round(current.progress * 100)}%)`,
      )
    }
  } else if (uploadProgress.state === "completing") {
    entries.push({ key: "upload-completing", text: "Finalizing upload…", icon: <Loader2 className="size-3.5 animate-spin" />, accent: "border-blue-500/50" })
  } else if (uploadProgress.state === "done") {
    const count = Object.keys(uploadProgress.files).length
    entries.push({
      key: "upload-done",
      text: `Upload complete — ${count} file${count !== 1 ? "s" : ""} ready`,
      icon: <CheckCircle2 className="size-3.5" />,
      accent: "border-green-500/50",
    })
  } else if (uploadProgress.state === "error") {
    entries.push({ key: "upload-error", text: `Upload failed: ${(uploadProgress as any).error ?? "Unknown error"}`, icon: <AlertTriangle className="size-3.5" />, accent: "border-red-500/50" })
  }

  // ── Processing status ──────────────────────────────────────────────────
  if (processingJob.status === "pending") {
    entries.push({ key: "proc-pending", text: "Processing queued — waiting to start…", icon: <Clock className="size-3.5 opacity-70" />, accent: "border-blue-500/50" })
  } else if (processingJob.status === "running") {
    const stage = processingJob.currentStage
    const pct = Math.round(processingJob.progress * 100)

    if (stage === "indexing") {
      entries.push({ key: "proc-indexing", text: `Indexing documents for search… (${pct}%)`, icon: <Loader2 className="size-3.5 animate-spin" />, accent: "border-blue-500/50" })
    } else if (stage === "detecting_hash_duplicates") {
      entries.push({ key: "proc-hash", text: `Scanning for identical files by hash… (${pct}%)`, icon: <Loader2 className="size-3.5 animate-spin" />, accent: "border-blue-500/50" })
    } else if (stage === "document_processing") {
      const subLabel = processingJob.subStage === "ai_processing"
        ? "AI Classification"
        : processingJob.subStage === "rag_processing"
          ? "RAG Embedding"
          : "AI Processing"
      entries.push({ key: "proc-doc", text: `${subLabel}… (${pct}%)`, icon: <Loader2 className="size-3.5 animate-spin" />, accent: "border-blue-500/50" })

      if (processingJob.aiDetail) {
        const { current, total } = processingJob.aiDetail
        const bar = total > 0 ? `${"█".repeat(Math.round((current / total) * 8))}${"░".repeat(8 - Math.round((current / total) * 8))}` : "░░░░░░░░"
        entries.push({
          key: "proc-ai",
          text: `↳ AI classify  ${bar}  ${current}/${total}`,
          icon: <FileIcon className="size-3.5 opacity-50" />,
          accent: "border-transparent",
        })
      }
      if (processingJob.ragDetail) {
        const { current, total } = processingJob.ragDetail
        const bar = total > 0 ? `${"█".repeat(Math.round((current / total) * 8))}${"░".repeat(8 - Math.round((current / total) * 8))}` : "░░░░░░░░"
        entries.push({
          key: "proc-rag",
          text: `↳ RAG embed    ${bar}  ${current}/${total}`,
          icon: <FileIcon className="size-3.5 opacity-50" />,
          accent: "border-transparent",
        })
      }
      if (processingJob.currentFile) {
        pushFilePath(
          "proc-file",
          processingJob.currentFile,
          <Loader2 className="size-3.5 animate-spin opacity-40" />,
          "border-transparent",
        )
      }
      // ── Last classified file result ────────────────────────────────
      if (lastClassified) {
        const catLabel = CATEGORY_LABELS[lastClassified.assigned_category] ?? lastClassified.assigned_category
        const conf = Math.round(lastClassified.classification_confidence * 100)
        const { folders: lcFolders, filename: lcFilename } = splitPath(lastClassified.original_path || lastClassified.filename)
        if (lcFolders.length > 0) {
          entries.push({
            key: "last-file-folder",
            text: `Last: 📁 ${lcFolders.join(" / ")}`,
            icon: <CheckCircle2 className="size-3.5 opacity-60" />,
            accent: "border-violet-500/40",
          })
          entries.push({
            key: "last-file-name",
            text: `↳ ${lcFilename}`,
            icon: <FileIcon className="size-3.5 opacity-40" />,
            accent: "border-violet-500/40",
          })
        } else {
          entries.push({
            key: "last-file-name",
            text: `Last: ${lcFilename}`,
            icon: <CheckCircle2 className="size-3.5 opacity-60" />,
            accent: "border-violet-500/40",
          })
        }
        // Category + confidence
        entries.push({
          key: "last-file-cat",
          text: `↳ ${catLabel} (${conf}% confidence)`,
          icon: <FileIcon className="size-3.5 opacity-40" />,
          accent: "border-transparent",
        })
        // Classification reasoning (truncated)
        if (lastClassified.classification_reasoning) {
          const reason = lastClassified.classification_reasoning.length > 90
            ? lastClassified.classification_reasoning.slice(0, 87) + "…"
            : lastClassified.classification_reasoning
          entries.push({
            key: "last-file-reason",
            text: `↳ Why: ${reason}`,
            icon: <FileIcon className="size-3.5 opacity-30" />,
            accent: "border-transparent",
          })
        }
        // Parties
        if (lastClassified.parties && lastClassified.parties.length > 0) {
          const partyList = lastClassified.parties.slice(0, 3).join(", ") + (lastClassified.parties.length > 3 ? ` +${lastClassified.parties.length - 3} more` : "")
          entries.push({
            key: "last-file-parties",
            text: `↳ Parties: ${partyList}`,
            icon: <FileIcon className="size-3.5 opacity-30" />,
            accent: "border-transparent",
          })
        }
        // Expiry date
        if (lastClassified.expiry_date) {
          entries.push({
            key: "last-file-expiry",
            text: `↳ Expires: ${lastClassified.expiry_date}`,
            icon: <FileIcon className="size-3.5 opacity-30" />,
            accent: "border-transparent",
          })
        }
        // Signature / seal indicators
        const docTraits: string[] = []
        if (lastClassified.has_signature) docTraits.push("Signed ✓")
        if (lastClassified.has_seal) docTraits.push("Sealed ✓")
        if (docTraits.length > 0) {
          entries.push({
            key: "last-file-traits",
            text: `↳ ${docTraits.join("  ·  ")}`,
            icon: <CheckCircle2 className="size-3.5 opacity-30" />,
            accent: "border-transparent",
          })
        }
        // Empty flag
        if (lastClassified.is_empty) {
          entries.push({
            key: "last-file-empty",
            text: "↳ ⚠ No content extracted — file may be empty or unreadable",
            icon: <AlertTriangle className="size-3.5 opacity-50" />,
            accent: "border-amber-500/40",
          })
        }
        // Incompleteness reasons
        if (lastClassified.is_incomplete) {
          if (lastClassified.incompleteness_reasons && lastClassified.incompleteness_reasons.length > 0) {
            lastClassified.incompleteness_reasons.forEach((r, i) => {
              entries.push({
                key: `last-file-incomplete-${i}`,
                text: `↳ ⚠ Incomplete: ${r}`,
                icon: <AlertTriangle className="size-3.5 opacity-50" />,
                accent: "border-amber-500/40",
              })
            })
          } else {
            entries.push({
              key: "last-file-incomplete",
              text: "↳ ⚠ Document appears incomplete",
              icon: <AlertTriangle className="size-3.5 opacity-50" />,
              accent: "border-amber-500/40",
            })
          }
        }
        // Processing error
        if (lastClassified.processing_error) {
          entries.push({
            key: "last-file-error",
            text: `↳ Error: ${lastClassified.processing_error}`,
            icon: <AlertTriangle className="size-3.5 opacity-50" />,
            accent: "border-red-500/40",
          })
        }
      }
    } else if (stage === "detecting_duplicates") {
      entries.push({ key: "proc-dup", text: `Comparing document content for duplicates… (${pct}%)`, icon: <Loader2 className="size-3.5 animate-spin" />, accent: "border-blue-500/50" })
    } else if (stage === "linking_documents") {
      entries.push({ key: "proc-lease", text: `Building lease amendment chains… (${pct}%)`, icon: <Loader2 className="size-3.5 animate-spin" />, accent: "border-blue-500/50" })
    } else if (stage === "building_overview") {
      entries.push({ key: "proc-overview", text: `Computing summaries and statistics… (${pct}%)`, icon: <Loader2 className="size-3.5 animate-spin" />, accent: "border-blue-500/50" })
    } else {
      entries.push({ key: "proc-running", text: `Processing… (${pct}%)`, icon: <Loader2 className="size-3.5 animate-spin" />, accent: "border-blue-500/50" })
    }
  } else if (processingJob.status === "completed") {
    entries.push({ key: "proc-done", text: "All processing complete", icon: <CheckCircle2 className="size-3.5" />, accent: "border-green-500/50" })
    const totalDocs = documents.length
    const emptyCount = documents.filter((d) => d.is_empty).length
    const incompleteCount = documents.filter((d) => d.is_incomplete).length
    const ragCount = documents.filter((d) => d.rag_indexed).length
    entries.push({ key: "proc-summary", text: `↳ ${ragCount}/${totalDocs} docs indexed for chat`, icon: <CheckCircle2 className="size-3.5 opacity-40" />, accent: "border-transparent" })
    if (emptyCount > 0) entries.push({ key: "proc-empty", text: `↳ ${emptyCount} empty file${emptyCount !== 1 ? "s" : ""} detected`, icon: <AlertTriangle className="size-3.5 opacity-40" />, accent: "border-transparent" })
    if (incompleteCount > 0) entries.push({ key: "proc-incomplete", text: `↳ ${incompleteCount} incomplete file${incompleteCount !== 1 ? "s" : ""} detected`, icon: <AlertTriangle className="size-3.5 opacity-40" />, accent: "border-transparent" })
    entries.push({ key: "proc-hint", text: "↳ Chat is ready — ask anything about the documents", icon: <CheckCircle2 className="size-3.5 opacity-40" />, accent: "border-transparent" })
  } else if (processingJob.status === "failed") {
    entries.push({
      key: "proc-failed",
      text: `Processing failed${processingJob.errorMessage ? `: ${processingJob.errorMessage}` : ""}`,
      icon: <AlertTriangle className="size-3.5" />,
      accent: "border-red-500/50",
    })
    entries.push({ key: "proc-retry", text: "↳ Use the Retry button in the Classification tab", icon: <AlertTriangle className="size-3.5 opacity-40" />, accent: "border-transparent" })
  }

  if (entries.length === 0) return null

  return (
    <div className="px-2 py-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">System</p>
      <div className="space-y-0.5">
        {entries.map((e) => (
          <div
            key={e.key}
            className={`flex items-center gap-2 border-l-2 ${e.accent} py-1 pl-2.5 pr-2 font-mono text-[11px] leading-snug text-muted-foreground/70`}
          >
            <span className="shrink-0">{e.icon}</span>
            <span className="truncate">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HoverTooltip({ content, children }: { content: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{children}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-pre-wrap">{content}</TooltipContent>
    </Tooltip>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1)
  return `${(bytes / k ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

const CATEGORY_LABELS: Record<string, string> = {
  leases_amendments: "Leases & Amendments",
  financial: "Financial",
  technical_environmental: "Technical / Environmental",
  corporate_legal: "Corporate & Legal",
  other: "Other",
}

const CATEGORY_COLORS: Record<string, string> = {
  leases_amendments: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  financial: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  technical_environmental: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400",
  corporate_legal: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-400",
  other: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
}

// ── Data panels ───────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 py-12 text-center">
      <Icon className="size-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  )
}

function AiInsightsPanel({ documents, loading }: { documents: DealDocument[]; loading: boolean }) {
  if (loading) return <LoadingRows />
  if (documents.length === 0)
    return <EmptyState icon={Sparkles} message="No documents yet — upload files to see AI insights." />

  // Category breakdown
  const byCategory = documents.reduce<Record<string, number>>((acc, d) => {
    acc[d.assigned_category] = (acc[d.assigned_category] ?? 0) + 1
    return acc
  }, {})

  const totalSize = documents.reduce((s, d) => s + d.file_size, 0)

  return (
    <div className="space-y-3">
      {/* Summary row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border/70 bg-background/80 px-4 py-3">
          <p className="text-2xl font-semibold tabular-nums">{documents.length}</p>
          <p className="text-xs text-muted-foreground">Total documents</p>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/80 px-4 py-3">
          <p className="text-2xl font-semibold tabular-nums">{formatBytes(totalSize)}</p>
          <p className="text-xs text-muted-foreground">Total size</p>
        </div>
      </div>

      {/* Category cards */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">By category</p>
        {Object.entries(byCategory)
          .sort((a, b) => b[1] - a[1])
          .map(([cat, count]) => (
            <div
              key={cat}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-background/60 px-3 py-2"
            >
              <span className="text-sm">{CATEGORY_LABELS[cat] ?? cat}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.other}`}>
                {count}
              </span>
            </div>
          ))}
      </div>
    </div>
  )
}

// ── File tree helpers ────────────────────────────────────────────────────────

interface TreeNode {
  name: string
  path: string
  children: Record<string, TreeNode>
  files: DealDocument[]
}

function buildTree(documents: DealDocument[], extraFolderPaths: Set<string> = new Set()): TreeNode {
  const root: TreeNode = { name: "", path: "", children: {}, files: [] }
  for (const doc of documents) {
    const parts = doc.original_path.split("/")
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]
      if (!node.children[seg]) {
        const p = parts.slice(0, i + 1).join("/")
        node.children[seg] = { name: seg, path: p, children: {}, files: [] }
      }
      node = node.children[seg]
    }
    node.files.push(doc)
  }
  // Ensure extra (possibly empty) folder paths are represented in the tree
  for (const folderPath of extraFolderPaths) {
    if (!folderPath) continue
    const parts = folderPath.split("/")
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      if (!node.children[seg]) {
        const p = parts.slice(0, i + 1).join("/")
        node.children[seg] = { name: seg, path: p, children: {}, files: [] }
      }
      node = node.children[seg]
    }
  }
  return root
}

function TreeNodeRow({
  node,
  depth = 0,
  showStatus = false,
  onPreview,
  loadingPreviewId,
  onDelete,
  deletingId,
  onMove,
  movingId,
  onDeleteFolder,
}: {
  node: TreeNode
  depth?: number
  showStatus?: boolean
  onPreview?: (docId: string, filename: string, ctrlKey: boolean) => void
  loadingPreviewId?: string | null
  onDelete?: (docId: string, filename: string) => void
  deletingId?: string | null
  onMove?: (docId: string, targetFolder: string) => void
  movingId?: string | null
  onDeleteFolder?: (folderPath: string, folderName: string, fileCount: number) => void
}) {
  const [open, setOpen] = React.useState(true)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const hasChildren = Object.keys(node.children).length > 0
  const indent = depth * 16

  function countAllFiles(n: TreeNode): number {
    return n.files.length + Object.values(n.children).reduce((s, c) => s + countAllFiles(c), 0)
  }
  const totalFiles = countAllFiles(node)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={`group/folder relative flex items-center transition-colors ${isDragOver ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault(); setIsDragOver(false)
          const docId = e.dataTransfer.getData("text/plain")
          if (docId && onMove) { onMove(docId, node.path); if (!open) setOpen(true) }
        }}
      >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex flex-1 min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium bg-muted/40 hover:bg-muted/60 transition-colors"
          style={{ paddingLeft: `${8 + indent}px` }}
        >
          <ChevronRight
            className={`size-4 shrink-0 text-muted-foreground/50 transition-transform duration-150 ${
              open ? "rotate-90" : ""
            }`}
          />
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left" title={node.name}>{node.name}</span>
          {totalFiles === 0 ? (
            <span className="shrink-0 text-[11px] text-muted-foreground/30 italic">empty</span>
          ) : (
            <span className="shrink-0 text-[11px] text-muted-foreground/50 tabular-nums">{totalFiles}</span>
          )}
        </button>
      </CollapsibleTrigger>
      {onDeleteFolder && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDeleteFolder(node.path, node.name, totalFiles) }}
          className="shrink-0 rounded p-1 mr-1 text-muted-foreground/30 opacity-0 group-hover/folder:opacity-100 hover:text-red-500 transition-all"
          title="Delete folder"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
      </div>
      <CollapsibleContent>
        {/* Sub-folders */}
        {Object.values(node.children)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((child) => (
            <TreeNodeRow key={child.path} node={child} depth={depth + 1} showStatus={showStatus} onPreview={onPreview} loadingPreviewId={loadingPreviewId} onDelete={onDelete} deletingId={deletingId} onMove={onMove} movingId={movingId} onDeleteFolder={onDeleteFolder} />
          ))}
        {/* Files in this folder */}
        {node.files.map((doc) => (
          <div
            key={doc.id}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData("text/plain", doc.id); e.dataTransfer.effectAllowed = "move" }}
            className="group/filerow flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/30 cursor-default active:opacity-50"
            style={{ paddingLeft: `${8 + indent + 20}px` }}
          >
            <GripVertical className="size-4 shrink-0 text-muted-foreground/20 opacity-0 group-hover/filerow:opacity-100 cursor-grab active:cursor-grabbing transition-opacity" />
            {movingId === doc.id
              ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
              : showStatus && doc.processing_status === "processing"
                ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                : showStatus && (doc.classification_confidence > 0 || doc.processing_status === "completed")
                  ? <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />
                  : <FileIcon className="size-3.5 shrink-0 text-muted-foreground/40" />}
            {onPreview ? (
              <button
                type="button"
                onClick={(e) => onPreview(doc.id, doc.filename, e.ctrlKey || e.metaKey)}
                disabled={loadingPreviewId === doc.id}
                className="group min-w-0 flex-1 flex items-center gap-1 text-left hover:text-foreground transition-colors disabled:opacity-50"
                title="Click to preview · Ctrl+click to open in new tab"
              >
                {loadingPreviewId === doc.id
                  ? <Loader2 className="size-3.5 shrink-0 animate-spin" />
                  : <Eye className="size-3.5 shrink-0 opacity-0 group-hover:opacity-40 transition-opacity" />}
                <span className="truncate">{doc.filename}</span>
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate" title={doc.filename}>{doc.filename}</span>
            )}
            <div className="flex items-center gap-2 shrink-0">
              <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground/40">{formatBytes(doc.file_size)}</span>
              {showStatus && (
                <>
                  <div className="w-40 flex justify-end">
                    {doc.processing_status === "processing" ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Analyzing…</span>
                    ) : doc.processing_status === "failed" ? (
                      <ClickTooltip content={doc.processing_error ?? "Processing failed"}>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-400 cursor-pointer">Failed</span>
                      </ClickTooltip>
                    ) : doc.is_empty ? (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">Empty</span>
                    ) : doc.classification_confidence > 0 ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_COLORS[doc.assigned_category] ?? CATEGORY_COLORS.other}`}>
                        {CATEGORY_LABELS[doc.assigned_category] ?? doc.assigned_category}
                      </span>
                    ) : doc.processing_status === "completed" ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">Unclassified</span>
                    ) : (
                      <HoverTooltip content="Classification pending — this file has not been processed yet. Run the AI processing to classify it.">
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 cursor-default">Pending</span>
                      </HoverTooltip>
                    )}
                  </div>
                  <div className="w-20 flex justify-end">
                    {doc.is_incomplete && (
                      <ClickTooltip content={doc.incompleteness_reasons?.join(", ") ?? "Incomplete"}>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-400 cursor-pointer">Incomplete</span>
                      </ClickTooltip>
                    )}
                  </div>
                  <div className="w-24 flex justify-end">
                    {doc.is_empty ? (
                      <HoverTooltip content="This file is empty — no content to index for AI search.">
                        <span className="whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-default">RAG Skipped</span>
                      </HoverTooltip>
                    ) : (
                      <HoverTooltip content={doc.rag_indexed ? `Indexed for AI search${doc.rag_indexed_at ? ` on ${new Date(doc.rag_indexed_at).toLocaleDateString()}` : ""}.` : "Not yet indexed for AI search (RAG). This file won't be searchable by the AI assistant until indexed."}>
                        {doc.rag_indexed
                          ? <span className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-950/50 dark:text-green-400 cursor-default">RAG Done</span>
                          : <span className="whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-default">RAG Pending</span>}
                      </HoverTooltip>
                    )}
                  </div>
                </>
              )}
              {onDelete && (
                <button
                  type="button"
                  disabled={deletingId === doc.id}
                  onClick={() => onDelete(doc.id, doc.filename)}
                  className="text-muted-foreground/30 hover:text-red-500 transition-colors disabled:opacity-40"
                  title="Delete file"
                >
                  {deletingId === doc.id
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Trash2 className="size-4" />}
                </button>
              )}
            </div>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function FileStructurePanel({
  documents,
  loading,
  showStatus = false,
  dealId,
  getToken,
  onDeleted,
}: {
  documents: DealDocument[]
  loading: boolean
  showStatus?: boolean
  dealId?: string | null
  getToken?: () => Promise<string | null>
  onDeleted?: () => void
}) {
  const [previewDoc, setPreviewDoc] = React.useState<{ url: string; title: string } | null>(null)
  const [loadingPreviewId, setLoadingPreviewId] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState<{ id: string; filename: string } | null>(null)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [deletedIds, setDeletedIds] = React.useState<Set<string>>(new Set())
  const [rootDragOver, setRootDragOver] = React.useState(false)
  const [localPathOverrides, setLocalPathOverrides] = React.useState<Record<string, string>>({})
  const [movingId, setMovingId] = React.useState<string | null>(null)
  const [extraFolderPaths, setExtraFolderPaths] = React.useState<Set<string>>(new Set())
  const [confirmFolderDelete, setConfirmFolderDelete] = React.useState<{ path: string; name: string; fileCount: number } | null>(null)
  const [deletingFolder, setDeletingFolder] = React.useState(false)

  // Clear overrides when the parent documents list updates (server confirmed the change)
  const prevDocsRef = React.useRef(documents)
  React.useEffect(() => {
    if (prevDocsRef.current !== documents) {
      prevDocsRef.current = documents
      setLocalPathOverrides({})
      // Keep folders that are now empty so they remain visible as drop targets
      setExtraFolderPaths((prev) => {
        const newExtra = new Set<string>()
        for (const folderPath of prev) {
          const hasFiles = documents.some((d) => d.original_path.startsWith(folderPath + "/"))
          if (!hasFiles) newExtra.add(folderPath)
        }
        return newExtra
      })
    }
  }, [documents])

  async function handleMove(docId: string, targetFolder: string) {
    if (!dealId || !getToken) return
    const doc = documents.find((d) => d.id === docId)
    if (!doc) return
    const filename = doc.filename
    const newPath = targetFolder ? `${targetFolder}/${filename}` : filename
    // Track source folder so it stays visible even if it becomes empty
    const currentPath = localPathOverrides[docId] ?? doc.original_path
    const parts = currentPath.split("/")
    if (parts.length > 1) {
      const sourceFolder = parts.slice(0, -1).join("/")
      setExtraFolderPaths((prev) => new Set([...prev, sourceFolder]))
    }
    setMovingId(docId)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL ?? ""}/api/deals/${dealId}/documents/${docId}/move`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ new_folder: targetFolder }),
        },
      )
      if (res.ok) {
        // Move confirmed — update path immediately in UI, then trigger background refresh
        setLocalPathOverrides((prev) => ({ ...prev, [docId]: newPath }))
        onDeleted?.()
      } else {
        const body = await res.json().catch(() => null)
        const detail = body?.error?.message ?? body?.detail ?? `Server error (${res.status})`
        toast.error("Failed to move file", { description: detail })
      }
    } catch (err) {
      toast.error("Failed to move file", { description: err instanceof Error ? err.message : "Network error" })
    } finally {
      setMovingId(null)
    }
  }

  function getAllDocIdsInFolder(folderPath: string, docs: typeof visibleDocs): string[] {
    return docs
      .filter((d) => d.original_path === folderPath + "/" + d.filename || d.original_path.startsWith(folderPath + "/"))
      .map((d) => d.id)
  }

  async function handleFolderDeleteConfirmed() {
    if (!dealId || !getToken || !confirmFolderDelete) return
    // Compute visibleDocs inline here so it's available at call time
    const currentDocs = documents
      .filter((d) => !deletedIds.has(d.id))
      .map((d) => localPathOverrides[d.id] !== undefined ? { ...d, original_path: localPathOverrides[d.id] } : d)
    const docIds = getAllDocIdsInFolder(confirmFolderDelete.path, currentDocs)
    setConfirmFolderDelete(null)
    setDeletingFolder(true)
    try {
      const token = await getToken()
      if (!token) return
      await Promise.all(
        docIds.map((docId) =>
          fetch(
            `${process.env.NEXT_PUBLIC_BACKEND_URL ?? ""}/api/deals/${dealId}/documents/${docId}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
          )
        )
      )
      setDeletedIds((prev) => new Set([...prev, ...docIds]))
      // Remove the folder from extraFolderPaths too
      setExtraFolderPaths((prev) => {
        const next = new Set(prev)
        next.delete(confirmFolderDelete.path)
        return next
      })
      toast.success(`Folder "${confirmFolderDelete.name}" and ${docIds.length} file${docIds.length !== 1 ? "s" : ""} deleted`)
      onDeleted?.()
    } catch {
      toast.error("Failed to delete folder")
    } finally {
      setDeletingFolder(false)
    }
  }

  async function handlePreview(docId: string, filename: string, ctrlKey: boolean) {
    if (!dealId || !getToken) return
    setLoadingPreviewId(docId)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL ?? ""}/api/deals/${dealId}/documents/${docId}/download`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) { toast.error("Could not load file"); return }
      const body = await res.json()
      const url = body.data?.url
      if (!url) { toast.error("Could not load file"); return }
      if (ctrlKey) { window.open(url, "_blank", "noopener,noreferrer") }
      else { setPreviewDoc({ url, title: filename }) }
    } finally {
      setLoadingPreviewId(null)
    }
  }

  async function handleDeleteConfirmed() {
    if (!dealId || !getToken || !confirmDelete) return
    const { id: docId, filename } = confirmDelete
    setConfirmDelete(null)
    setDeletingId(docId)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL ?? ""}/api/deals/${dealId}/documents/${docId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      )
      if (res.ok) {
        toast.success(`"${filename}" deleted`)
        setDeletedIds((prev) => new Set(prev).add(docId))
        onDeleted?.()
      } else {
        toast.error("Failed to delete document")
      }
    } finally {
      setDeletingId(null)
    }
  }

  const canPreview = !!(dealId && getToken)
  const canDelete = !!(dealId && getToken)

  if (loading) return <LoadingRows />
  const visibleDocs = documents
    .filter((d) => !deletedIds.has(d.id))
    .map((d) => localPathOverrides[d.id] !== undefined ? { ...d, original_path: localPathOverrides[d.id] } : d)
  if (visibleDocs.length === 0)
    return <EmptyState icon={FolderTree} message="No files yet — upload to see folder structure." />

  const root = buildTree(visibleDocs, extraFolderPaths)
  const topLevel = Object.values(root.children).sort((a, b) => a.name.localeCompare(b.name))
  const rootFiles = root.files

  return (
    <>
      {/* Confirm folder delete dialog */}
      <Dialog open={!!confirmFolderDelete} onOpenChange={(open) => { if (!open) setConfirmFolderDelete(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete folder?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Folder <span className="font-medium text-foreground">{confirmFolderDelete?.name}</span> and{" "}
            {confirmFolderDelete?.fileCount === 0
              ? "all its contents"
              : <><span className="font-medium text-foreground">{confirmFolderDelete?.fileCount} file{confirmFolderDelete?.fileCount !== 1 ? "s" : ""}</span> inside it</>}{" "}
            will be permanently deleted.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmFolderDelete(null)} disabled={deletingFolder}>Cancel</Button>
            <Button variant="destructive" onClick={handleFolderDeleteConfirmed} disabled={deletingFolder}>
              {deletingFolder ? <><Loader2 className="size-4 animate-spin mr-1" />Deleting…</> : "Delete folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm file delete dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete file?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{confirmDelete?.filename}</span> will be permanently removed.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteConfirmed}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!previewDoc} onOpenChange={(open) => { if (!open) setPreviewDoc(null) }}>
        <DialogContent className="w-[90vw] max-w-[1200px] sm:max-w-[1200px] p-0 overflow-hidden" showCloseButton>
          <DialogHeader className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between gap-2 pr-8">
              <DialogTitle className="truncate text-sm">{previewDoc?.title}</DialogTitle>
              <a href={previewDoc?.url} target="_blank" rel="noopener noreferrer" className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ExternalLink className="size-4" />Open in new tab
              </a>
            </div>
          </DialogHeader>
          <iframe src={previewDoc?.url} className="w-full border-0" style={{ height: "85vh" }} title={previewDoc?.title} />
        </DialogContent>
      </Dialog>

    <div className="rounded-xl border border-border/60 bg-background/60 overflow-hidden">
      <div className="divide-y divide-border/20">
        {topLevel.map((node) => (
          <TreeNodeRow key={node.path} node={node} depth={0} showStatus={showStatus} onPreview={canPreview ? handlePreview : undefined} loadingPreviewId={loadingPreviewId} onDelete={canDelete ? (id, name) => setConfirmDelete({ id, filename: name }) : undefined} deletingId={deletingId} onMove={handleMove} movingId={movingId} onDeleteFolder={canDelete ? (path, name, count) => setConfirmFolderDelete({ path, name, fileCount: count }) : undefined} />
        ))}
        {/* Root-level drop zone — drop here to move to root */}
        <div
          className={`flex items-center gap-1.5 px-3 py-1 text-[11px] transition-colors ${
            rootDragOver ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : ""
          }`}
          onDragOver={(e) => { e.preventDefault(); setRootDragOver(true) }}
          onDragLeave={() => setRootDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setRootDragOver(false)
            const docId = e.dataTransfer.getData("text/plain")
            if (docId) handleMove(docId, "")
          }}
        >
          {rootDragOver && <span className="text-primary/60">Drop here to move to root</span>}
        </div>
        {rootFiles.map((doc) => (
          <div
            key={doc.id}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData("text/plain", doc.id); e.dataTransfer.effectAllowed = "move" }}
            className="group/filerow flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:bg-muted/30 cursor-default active:opacity-50"
          >
            <GripVertical className="size-4 shrink-0 text-muted-foreground/20 opacity-0 group-hover/filerow:opacity-100 cursor-grab active:cursor-grabbing transition-opacity" />
            {movingId === doc.id
              ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
              : showStatus && doc.processing_status === "processing"
                ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                : showStatus && (doc.classification_confidence > 0 || doc.processing_status === "completed")
                  ? <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />
                  : <FileIcon className="size-3.5 shrink-0 text-muted-foreground/40" />}
            {canPreview ? (
              <button
                type="button"
                onClick={(e) => handlePreview(doc.id, doc.filename, e.ctrlKey || e.metaKey)}
                disabled={loadingPreviewId === doc.id}
                className="group min-w-0 flex-1 flex items-center gap-1 text-left hover:text-foreground transition-colors disabled:opacity-50"
                title="Click to preview · Ctrl+click to open in new tab"
              >
                {loadingPreviewId === doc.id ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Eye className="size-3.5 shrink-0 opacity-0 group-hover:opacity-40 transition-opacity" />}
                <span className="truncate">{doc.filename}</span>
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate" title={doc.filename}>{doc.filename}</span>
            )}
            <div className="flex items-center gap-2 shrink-0">
              <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground/40">{formatBytes(doc.file_size)}</span>
              {showStatus && (
                <>
                  <div className="w-40 flex justify-end">
                    {doc.processing_status === "processing" ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Analyzing…</span>
                    ) : doc.processing_status === "failed" ? (
                      <ClickTooltip content={doc.processing_error ?? "Processing failed"}>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-400 cursor-pointer">Failed</span>
                      </ClickTooltip>
                    ) : doc.is_empty ? (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">Empty</span>
                    ) : doc.classification_confidence > 0 ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_COLORS[doc.assigned_category] ?? CATEGORY_COLORS.other}`}>
                        {CATEGORY_LABELS[doc.assigned_category] ?? doc.assigned_category}
                      </span>
                    ) : doc.processing_status === "completed" ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">Unclassified</span>
                    ) : (
                      <HoverTooltip content="Classification pending — this file has not been processed yet. Run the AI processing to classify it.">
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 cursor-default">Classification Pending</span>
                      </HoverTooltip>
                    )}
                  </div>
                  <div className="w-20 flex justify-end">
                    {doc.is_incomplete && (
                      <ClickTooltip content={doc.incompleteness_reasons?.join(", ") ?? "Incomplete"}>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-400 cursor-pointer">Incomplete</span>
                      </ClickTooltip>
                    )}
                  </div>
                  <div className="w-24 flex justify-end">
                    {doc.is_empty ? (
                      <HoverTooltip content="This file is empty — no content to index for AI search.">
                        <span className="whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-default">RAG Skipped</span>
                      </HoverTooltip>
                    ) : (
                      <HoverTooltip content={doc.rag_indexed ? `Indexed for AI search${doc.rag_indexed_at ? ` on ${new Date(doc.rag_indexed_at).toLocaleDateString()}` : ""}.` : "Not yet indexed for AI search (RAG). This file won't be searchable by the AI assistant until indexed."}>
                        {doc.rag_indexed
                          ? <span className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-950/50 dark:text-green-400 cursor-default">RAG Done</span>
                          : <span className="whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-default">RAG Pending</span>}
                      </HoverTooltip>
                    )}
                  </div>
                </>
              )}
              {canDelete && (
                <button
                  type="button"
                  disabled={deletingId === doc.id}
                  onClick={() => setConfirmDelete({ id: doc.id, filename: doc.filename })}
                  className="text-muted-foreground/30 hover:text-red-500 transition-colors disabled:opacity-40"
                  title="Delete file"
                >
                  {deletingId === doc.id
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Trash2 className="size-4" />}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
    </>
  )
}

function DuplicationPanel({
  groups,
  loading,
  dealId,
  getToken,
  onDeleted,
}: {
  groups: DuplicateGroup[]
  loading: boolean
  dealId: string | null
  getToken: () => Promise<string | null>
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = React.useState<string | null>(null)
  const [confirmDoc, setConfirmDoc] = React.useState<{ id: string; filename: string } | null>(null)
  const [deletedIds, setDeletedIds] = React.useState<Set<string>>(new Set())
  const [loadingPreview, setLoadingPreview] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<{ url: string; title: string } | null>(null)

  async function fetchSignedUrl(docId: string): Promise<string | null> {
    if (!dealId) return null
    const token = await getToken()
    if (!token) return null
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL ?? ""}/api/deals/${dealId}/documents/${docId}/download`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) return null
    const body = await res.json()
    return body.data?.url ?? null
  }

  async function handleFileClick(e: React.MouseEvent, m: { document_id: string; filename: string | null }) {
    setLoadingPreview(m.document_id)
    try {
      const url = await fetchSignedUrl(m.document_id)
      if (!url) { toast.error("Could not load file"); return }
      if (e.ctrlKey || e.metaKey) {
        window.open(url, "_blank", "noopener,noreferrer")
      } else {
        setPreview({ url, title: m.filename ?? "Preview" })
      }
    } finally {
      setLoadingPreview(null)
    }
  }

  async function handleDelete() {
    if (!dealId || !confirmDoc) return
    const { id: docId, filename } = confirmDoc
    setConfirmDoc(null)
    setDeleting(docId)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL ?? ""}/api/deals/${dealId}/documents/${docId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      )
      if (res.ok) {
        toast.success(`"${filename}" deleted`)
        setDeletedIds((prev) => new Set(prev).add(docId))
        onDeleted()
      } else {
        toast.error("Failed to delete document")
      }
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return <LoadingRows />
  if (groups.length === 0)
    return <EmptyState icon={Copy} message="No duplicates detected yet." />

  const visibleGroups = groups
    .map((g) => ({ ...g, members: g.members.filter((m) => !deletedIds.has(m.document_id)) }))
    .filter((g) => g.members.length >= 2)

  return (
    <>
      {/* Confirm delete dialog */}
      <Dialog open={!!confirmDoc} onOpenChange={(open) => { if (!open) setConfirmDoc(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete duplicate?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{confirmDoc?.filename}</span> will be permanently removed.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDoc(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File preview dialog */}
      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null) }}>
        <DialogContent className="w-[90vw] max-w-[1200px] sm:max-w-[1200px] p-0 overflow-hidden" showCloseButton>
          <DialogHeader className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between gap-2 pr-8">
              <DialogTitle className="truncate text-sm">{preview?.title}</DialogTitle>
              <a
                href={preview?.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-4" />
                Open in new tab
              </a>
            </div>
          </DialogHeader>
          <iframe
            src={preview?.url}
            className="w-full border-0"
            style={{ height: "85vh" }}
            title={preview?.title}
          />
        </DialogContent>
      </Dialog>

      <div className="space-y-2 pr-1">
        {visibleGroups.map((group) => (
          <div key={group.id} className="rounded-xl border border-border/60 bg-background/60 overflow-hidden">
            {/* Group header */}
            <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2">
              <Files className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={group.group_name}>
                {group.group_name}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                group.match_type === "exact"
                  ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
              }`}>
                {group.match_type === "exact" ? "Identical File" : "Content Match"}
              </span>
            </div>
            {/* Column headers */}
            <div className="grid grid-cols-[28px_1fr_auto_110px_80px] items-center gap-x-2 border-b border-border/30 bg-muted/15 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
              <span />
              <span>File</span>
              <span>Reason</span>
              <span className="text-center">Status</span>
              <span className="text-right">Action</span>
            </div>
            {/* Rows */}
            <div className="divide-y divide-border/30">
              {group.members.map((m) => {
                // Build reason text
                const reason = m.is_canonical
                  ? group.match_type === "exact"
                    ? "First copy found — retained as reference"
                    : "Reference document for this group"
                  : group.match_type === "exact"
                    ? "Byte-for-byte identical to the keeper"
                    : m.similarity_score != null
                      ? `${Math.round(m.similarity_score * 100)}% content similarity to the keeper`
                      : "Similar content to the keeper"

                return (
                  <div key={m.id} className="grid grid-cols-[28px_1fr_auto_110px_80px] items-center gap-x-2 px-3 py-2">
                    {/* Col 1: icon */}
                    <div className="flex items-center justify-center">
                      {m.is_canonical
                        ? <Shield className="size-4 shrink-0 text-green-500" />
                        : <Files className="size-4 shrink-0 text-muted-foreground/40" />
                      }
                    </div>

                    {/* Col 2: folder + filename (clickable preview) */}
                    <button
                      type="button"
                      onClick={(e) => handleFileClick(e, m)}
                      disabled={loadingPreview === m.document_id}
                      className="group min-w-0 flex items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      title={m.original_path ?? m.filename ?? ""}
                    >
                      {loadingPreview === m.document_id
                        ? <Loader2 className="size-3.5 shrink-0 animate-spin" />
                        : <Eye className="size-3.5 shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" />}
                      <span className="min-w-0 flex flex-col leading-tight">
                        {(() => {
                          const fullPath = (m.original_path ?? m.filename ?? "Unknown").replace(/\\/g, "/")
                          const parts = fullPath.split("/")
                          const fname = parts.pop() ?? fullPath
                          const folder = parts.join(" / ")
                          return folder ? (
                            <>
                              <span className="truncate text-[10px] opacity-50">📁 {folder}</span>
                              <span className="truncate">{fname}</span>
                            </>
                          ) : (
                            <span className="truncate">{fname}</span>
                          )
                        })()}
                      </span>
                    </button>

                    {/* Col 3: reason */}
                    <span className="min-w-0 truncate text-[11px] text-muted-foreground/60 italic max-w-[220px]">
                      {reason}
                    </span>

                    {/* Col 4: status badge */}
                    <div className="flex justify-center">
                      {m.is_canonical ? (
                        <HoverTooltip content="This is the original copy — the one that will be kept. Delete the duplicates to clean up.">
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400 cursor-default">
                            <Shield className="size-2.5" />
                            Keeper
                          </span>
                        </HoverTooltip>
                      ) : (
                        <HoverTooltip content={group.match_type === "exact" ? "Exact byte-for-byte copy — safe to delete." : "Near-duplicate based on content similarity."}>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium cursor-default ${
                            group.match_type === "exact"
                              ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                          }`}>
                            <Files className="size-2.5" />
                            {group.match_type === "exact" ? "Duplicate" : "Similar"}
                          </span>
                        </HoverTooltip>
                      )}
                    </div>

                    {/* Col 5: action */}
                    <div className="flex justify-end">
                      {m.is_canonical ? (
                        <span className="text-[11px] text-muted-foreground/30 pr-1">—</span>
                      ) : (
                        <button
                          type="button"
                          disabled={deleting === m.document_id}
                          onClick={() => setConfirmDoc({ id: m.document_id, filename: m.filename ?? m.original_path ?? "this file" })}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground/50 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400 transition-colors disabled:opacity-40"
                          title="Delete this duplicate"
                        >
                          {deleting === m.document_id
                            ? <Loader2 className="size-4 animate-spin" />
                            : <><Trash2 className="size-3.5" /> Delete</>}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ── Classification panel ────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  leases_amendments: "📄",
  financial: "💰",
  technical_environmental: "🔧",
  corporate_legal: "⚖️",
  other: "📁",
}

const CATEGORY_BAR_COLORS: Record<string, string> = {
  leases_amendments: "bg-blue-400",
  financial: "bg-emerald-400",
  technical_environmental: "bg-orange-400",
  corporate_legal: "bg-purple-400",
  other: "bg-zinc-400",
}

function ClassificationPanel({
  classifications,
  documents,
  duplicates,
  loading,
  dealId,
  onProcessed,
  isDocProcessing,
  isProcessingActive,
  countdown,
  needsRefresh,
}: {
  classifications: Classification[]
  documents: DealDocument[]
  duplicates: DuplicateGroup[]
  loading: boolean
  dealId: string | null
  onProcessed: () => void
  isDocProcessing: boolean
  isProcessingActive: boolean
  countdown: number
  needsRefresh: boolean
}) {
  const { getToken } = useAuth()
  const [processing, setProcessing] = React.useState(false)
  const [showDuplicateWarning, setShowDuplicateWarning] = React.useState(false)
  // null = show all; "unclassified" = unclassified filter; any clf.key = that category
  const [selectedFilter, setSelectedFilter] = React.useState<string | null>(null)

  const doProcess = React.useCallback(async () => {
    if (!dealId) return
    setProcessing(true)
    try {
      const token = await getToken()
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? ""}/api/deals/${dealId}/process`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const msg = body?.detail ?? `Server error (${res.status})`
        toast.error("Failed to start processing", { description: msg })
        return
      }
      toast.success("Processing started", { description: "Per-file progress is visible in the file list below." })
      onProcessed()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error — is the backend running?"
      toast.error("Failed to start processing", { description: msg })
    } finally {
      setProcessing(false)
    }
  }, [dealId, getToken, onProcessed])

  const handleProcess = React.useCallback(() => {
    if (duplicates.length > 0) {
      setShowDuplicateWarning(true)
    } else {
      doProcess()
    }
  }, [duplicates.length, doProcess])

  if (loading) return <LoadingRows />
  if (classifications.length === 0)
    return (
      <EmptyState
        icon={LayoutGrid}
        message="No classification categories defined for your company — add categories before running the classification process."
      />
    )

  // Docs that have actually been classified (confidence > 0, not empty, not incomplete)
  const classifiedDocs = documents.filter((d) => d.classification_confidence > 0 && !d.is_empty && !d.is_incomplete)
  const unclassifiedDocs = documents.filter((d) => d.classification_confidence <= 0 || d.is_empty || d.is_incomplete)

  // Only count docs that haven't been through Gemini yet as needing classification.
  // Incomplete / low-confidence docs that are already "completed" should NOT trigger reclassification.
  const unclassifiedCount = documents.filter(
    (d) => !d.processing_status || d.processing_status === "pending"
  ).length

  const countByKey = classifiedDocs.reduce<Record<string, number>>((acc, d) => {
    acc[d.assigned_category] = (acc[d.assigned_category] ?? 0) + 1
    return acc
  }, {})

  const active = classifications.filter((c) => c.is_active)
  // Empty files are skipped for RAG — don't count them as needing indexing
  const notRagIndexedCount = documents.filter(
    (d) => !d.rag_indexed && !d.is_empty && d.processing_status === "completed"
  ).length
  const hasUnprocessed = documents.length > 0 && (unclassifiedCount > 0 || notRagIndexedCount > 0)

  // Filtered docs for the tree
  const filteredDocs = selectedFilter === null
    ? documents
    : selectedFilter === "unclassified"
      ? unclassifiedDocs
      : classifiedDocs.filter((d) => d.assigned_category === selectedFilter)

  const toggleFilter = (key: string) =>
    setSelectedFilter((prev) => (prev === key ? null : key))

  return (
    <div className="space-y-3">
      {/* Duplicate warning dialog */}
      <Dialog open={showDuplicateWarning} onOpenChange={setShowDuplicateWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate files detected</DialogTitle>
            <DialogDescription>
              {duplicates.length} duplicate group{duplicates.length !== 1 ? "s" : ""} exist in your data room. Processing now may classify duplicates separately. Consider resolving duplicates first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDuplicateWarning(false)}>Cancel</Button>
            <Button size="sm" onClick={() => { setShowDuplicateWarning(false); doProcess() }}>Process anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Action bar */}
      {dealId && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">
                {documents.length === 0
                  ? "Upload files to classify them."
                  : classifiedDocs.length === documents.length
                    ? `All ${documents.length} files classified.`
                    : `${classifiedDocs.length} of ${documents.length} files classified.`}
              </p>
              {needsRefresh && !isDocProcessing && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground/50">
                  <RotateCcw className="size-2.5 text-muted-foreground/40" />
                  {countdown}s
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant={hasUnprocessed ? "default" : "outline"}
              className="h-8 gap-1.5 text-xs"
              onClick={handleProcess}
              disabled={processing || isProcessingActive || documents.length === 0 || classifications.length === 0}
            >
              {processing || isDocProcessing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {processing ? "Starting…" : isDocProcessing ? "Processing…" : "Process"}
              {!processing && !isDocProcessing && hasUnprocessed && (
                <span className="ml-0.5 inline-flex items-center gap-1 font-semibold">
                  {unclassifiedCount > 0 && (
                    <span className="rounded bg-white/25 px-2 py-0.5 text-[10px] leading-none tabular-nums">
                      {unclassifiedCount} classify
                    </span>
                  )}
                  {notRagIndexedCount > 0 && (
                    <span className="rounded bg-white/25 px-2 py-0.5 text-[10px] leading-none tabular-nums">
                      {notRagIndexedCount} RAG
                    </span>
                  )}
                </span>
              )}
            </Button>
          </div>
          {/* Per-file processing progress bar */}
          {isDocProcessing && (() => {
            const processingCount = documents.filter((d) => d.processing_status === "processing").length
            const processedCount = documents.filter((d) => d.processing_status === "completed" || d.processing_status === "failed").length
            const processPct = documents.length > 0 ? Math.round((processedCount / documents.length) * 100) : 0
            return (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    <span className="text-[11px] font-medium text-primary">
                      AI Processing{processingCount > 0 ? ` — ${processingCount} file${processingCount !== 1 ? "s" : ""} in progress` : "…"}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold tabular-nums text-primary">
                    {processedCount}/{documents.length} ({processPct}%)
                  </span>
                </div>
                <Progress value={processPct} className="h-1.5" />
              </div>
            )
          })()}
        </div>
      )}

      {/* Classification cards grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((clf) => {
          const count = countByKey[clf.key] ?? 0
          const colorClass = CATEGORY_COLORS[clf.key] ?? CATEGORY_COLORS.other
          const emoji = CATEGORY_ICONS[clf.key] ?? "📁"
          const pct = documents.length > 0 ? Math.round((count / documents.length) * 100) : 0
          const isSelected = selectedFilter === clf.key
          return (
            <button
              key={clf.id}
              type="button"
              onClick={() => toggleFilter(clf.key)}
              className={`text-left flex flex-col gap-2 rounded-xl border px-4 py-3.5 transition-all ${
                isSelected
                  ? "border-primary/50 bg-primary/[0.04] shadow-sm ring-1 ring-primary/20"
                  : "border-border/70 bg-background/80 hover:shadow-sm hover:border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none" aria-hidden>{emoji}</span>
                  <span className="text-sm font-semibold leading-tight">{clf.label}</span>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${
                  count > 0 ? colorClass : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                }`}>
                  {count} {count === 1 ? "file" : "files"}
                </span>
              </div>
              {clf.description && (
                <p className="text-xs leading-relaxed text-muted-foreground">{clf.description}</p>
              )}
              {documents.length > 0 && (
                <div className="space-y-1">
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        count > 0 ? (CATEGORY_BAR_COLORS[clf.key] ?? "bg-zinc-400") : "bg-zinc-200 dark:bg-zinc-700"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground/60 tabular-nums">{pct}% of documents</p>
                </div>
              )}
            </button>
          )
        })}

        {/* Unclassified card — always shown when there are documents */}
        {documents.length > 0 && (() => {
          const isSelected = selectedFilter === "unclassified"
          return (
            <button
              type="button"
              onClick={() => toggleFilter("unclassified")}
              className={`text-left flex flex-col gap-2 rounded-xl border border-dashed px-4 py-3.5 transition-all ${
                isSelected
                  ? "border-amber-400/60 bg-amber-50/40 shadow-sm ring-1 ring-amber-300/30 dark:bg-amber-950/20"
                  : "border-border/60 bg-muted/20 hover:border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none" aria-hidden>❓</span>
                  <span className="text-sm font-semibold leading-tight text-muted-foreground">Unclassified</span>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${
                  unclassifiedCount > 0
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                    : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                }`}>
                  {unclassifiedCount} {unclassifiedCount === 1 ? "file" : "files"}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Files not yet processed or below confidence threshold.
              </p>
              <div className="space-y-1">
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      unclassifiedCount > 0 ? "bg-amber-300" : "bg-zinc-200 dark:bg-zinc-700"
                    }`}
                    style={{ width: `${Math.round((unclassifiedCount / documents.length) * 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground/60 tabular-nums">
                  {Math.round((unclassifiedCount / documents.length) * 100)}% of documents
                </p>
              </div>
            </button>
          )
        })()}
      </div>

      {/* File tree below cards — filtered by selected card */}
      {documents.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {selectedFilter === null
                ? "All files"
                : selectedFilter === "unclassified"
                  ? "Unclassified files"
                  : `${active.find((c) => c.key === selectedFilter)?.label ?? selectedFilter} files`}
            </p>
            {selectedFilter !== null && (
              <button
                type="button"
                className="text-[11px] text-muted-foreground/70 hover:text-foreground underline underline-offset-2"
                onClick={() => setSelectedFilter(null)}
              >
                Show all
              </button>
            )}
          </div>
          {filteredDocs.length === 0 ? (
            <EmptyState icon={FolderTree} message="No files in this category yet." />
          ) : (
            <FileStructurePanel documents={filteredDocs} loading={false} showStatus dealId={dealId} getToken={getToken} onDeleted={onProcessed} />
          )}
        </div>
      )}
    </div>
  )
}

function LeaseAmendmentPanel({ chains, loading }: { chains: LeaseChain[]; loading: boolean }) {
  if (loading) return <LoadingRows />
  if (chains.length === 0)
    return <EmptyState icon={Link2} message="No lease chains found yet." />

  const DOC_TYPE_LABEL: Record<string, string> = {
    base_lease: "Base Lease",
    amendment: "Amendment",
    side_letter: "Side Letter",
    correspondence: "Correspondence",
    unknown: "Unknown",
  }

  return (
    <div className="space-y-2 pr-1">
        {chains.map((chain) => (
          <div key={chain.id} className="rounded-xl border border-border/60 bg-background/60 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2">
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{chain.tenant_name}</p>
                {chain.tenant_identifier && (
                  <p className="truncate text-[11px] text-muted-foreground/70">{chain.tenant_identifier}</p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {chain.documents.length} doc{chain.documents.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="divide-y divide-border/30">
              {chain.documents.map((doc) => (
                <div key={doc.id} className="flex items-center gap-2 px-3 py-1.5">
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/40" />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={doc.original_path ?? ""}>
                    {doc.filename ?? doc.original_path ?? "Unknown"}
                  </span>
                  <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-700 dark:bg-blue-950/50 dark:text-blue-400">
                    {DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type}
                    {doc.amendment_number != null ? ` #${doc.amendment_number}` : ""}
                  </span>
                  {doc.is_orphaned && (
                    <AlertTriangle className="size-4 shrink-0 text-amber-500" title="Orphaned" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
  )
}

export type ProjectSetupScreenProps = {
  dealId: string | null
  projectTitle: string
  hasCompany: boolean
  isNewProject?: boolean
  onBack: () => void
}

export function ProjectSetupScreen({ dealId, projectTitle, hasCompany, isNewProject = false, onBack }: ProjectSetupScreenProps) {
  const { getToken } = useAuth()
  const [section, setSection] = React.useState<SetupSection>("upload")
  const [chatOpen, setChatOpen] = React.useState(true)
  const [chatWidth, setChatWidth] = React.useState(320)
  const isDemoWorkspace = projectTitle === DEMO_WORKSPACE_TITLE

  // ── Real deal data ────────────────────────────────────────────────────────
  const dealData = useDealData(dealId)
  const { classifications, loading: classificationsLoading } = useClassifications()
  const processingJob = useProcessingStatus(dealId)

  // ── Auto-refresh countdown ────────────────────────────────────────────────
  const [refreshCountdown, setRefreshCountdown] = React.useState(5)
  const hasDocsNeedingWork =
    dealData.documents.length > 0 &&
    dealData.documents.some(
      (d) =>
        d.processing_status === "processing" ||
        d.processing_status === "pending" ||
        (!d.rag_indexed && d.processing_status !== "failed"),
    )
  // Only tick when the relevant tab is active AND processing is running
  const isProcessingActive = processingJob.status === "running"
  const tabNeedsRefresh =
    processingJob.status === "running" &&
    hasDocsNeedingWork &&
    (section === "upload" || section === "file-structure")
  // Keep a stable ref to silentRefresh so the interval closure never goes stale
  const silentRefreshRef = React.useRef(dealData.silentRefresh)
  React.useEffect(() => { silentRefreshRef.current = dealData.silentRefresh }, [dealData.silentRefresh])

  // Refresh document list when processing transitions to completed
  const prevProcessingStatus = React.useRef(processingJob.status)
  React.useEffect(() => {
    if (prevProcessingStatus.current === "running" && processingJob.status === "completed") {
      silentRefreshRef.current()
    }
    prevProcessingStatus.current = processingJob.status
  }, [processingJob.status])
  const REFRESH_INTERVAL = 15
  React.useEffect(() => {
    if (!tabNeedsRefresh) {
      setRefreshCountdown(REFRESH_INTERVAL)
      return
    }
    const timer = setInterval(() => {
      setRefreshCountdown((prev) => {
        if (prev <= 1) {
          silentRefreshRef.current()
          return REFRESH_INTERVAL
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [tabNeedsRefresh])

  const startDrag = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      const maxWidth = Math.floor(window.innerWidth * 0.8) - 320
      const next = Math.min(maxWidth, Math.max(240, startWidth + delta))
      setChatWidth(next)
    }

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [chatWidth])

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const fileInputSingleRef = React.useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  // Show dropzone when no files uploaded yet, or when user explicitly wants to add more
  const [showDropzone, setShowDropzone] = React.useState(true)

  // ── File selection state ──────────────────────────────────────────────────
  const [selectedFiles, setSelectedFiles] = React.useState<FileEntry[]>([])
  const [skippedFiles, setSkippedFiles] = React.useState<string[]>([])
  // Paths the user has explicitly chosen to overwrite
  const [overwriteSet, setOverwriteSet] = React.useState<Set<string>>(new Set())
  const [uploadProgress, setUploadProgress] = React.useState<UploadProgress>({
    overall: 0,
    files: {},
    state: "idle",
  })
  const abortRef = React.useRef<AbortController | null>(null)

  // ── Upload card: document preview & delete ─────────────────────────────────
  const [uploadPreview, setUploadPreview] = React.useState<{ url: string; title: string } | null>(null)
  const [uploadLoadingPreviewId, setUploadLoadingPreviewId] = React.useState<string | null>(null)
  const [uploadConfirmDelete, setUploadConfirmDelete] = React.useState<{ id: string; filename: string } | null>(null)
  const [uploadDeletingId, setUploadDeletingId] = React.useState<string | null>(null)
  const [uploadDeletedIds, setUploadDeletedIds] = React.useState<Set<string>>(new Set())

  async function handleUploadPreview(docId: string, filename: string, ctrlKey: boolean) {
    setUploadLoadingPreviewId(docId)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL ?? ""}/api/deals/${dealId}/documents/${docId}/download`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) { toast.error("Could not load file"); return }
      const body = await res.json()
      const url = body.data?.url
      if (!url) { toast.error("Could not load file"); return }
      if (ctrlKey) { window.open(url, "_blank", "noopener,noreferrer") }
      else { setUploadPreview({ url, title: filename }) }
    } finally {
      setUploadLoadingPreviewId(null)
    }
  }

  async function handleUploadDeleteConfirmed() {
    if (!dealId || !uploadConfirmDelete) return
    const { id: docId, filename } = uploadConfirmDelete
    setUploadConfirmDelete(null)
    setUploadDeletingId(docId)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL ?? ""}/api/deals/${dealId}/documents/${docId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      )
      if (res.ok) {
        toast.success(`"${filename}" deleted`)
        setUploadDeletedIds((prev) => new Set(prev).add(docId))
        dealData.silentRefresh()
      } else {
        toast.error("Failed to delete document")
      }
    } finally {
      setUploadDeletingId(null)
    }
  }

  /** Convert a FileList (from input or drop) into FileEntry[] preserving relative paths. */
  const filesToEntries = (files: FileList | null): FileEntry[] => {
    if (!files) return []
    const entries: FileEntry[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i] as File & { webkitRelativePath?: string }
      const rel = f.webkitRelativePath || f.name
      entries.push({ file: f, relativePath: rel })
    }
    return entries
  }

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newEntries = filesToEntries(event.target.files)
    if (newEntries.length) {
      const existingByPath = Object.fromEntries(dealData.documents.map((d) => [d.original_path, d]))
      const autoOverwrite = new Set(
        newEntries
          .filter((f) => isSupported(f.relativePath) && existingByPath[f.relativePath] && existingByPath[f.relativePath].file_size !== f.file.size)
          .map((f) => f.relativePath),
      )
      setOverwriteSet(autoOverwrite)
      setSelectedFiles(newEntries)
    }
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const newEntries = filesToEntries(event.dataTransfer.files)
    if (newEntries.length) {
      const existingByPath = Object.fromEntries(dealData.documents.map((d) => [d.original_path, d]))
      const autoOverwrite = new Set(
        newEntries
          .filter((f) => isSupported(f.relativePath) && existingByPath[f.relativePath] && existingByPath[f.relativePath].file_size !== f.file.size)
          .map((f) => f.relativePath),
      )
      setOverwriteSet(autoOverwrite)
      setSelectedFiles(newEntries)
    }
  }

  // ── Upload handler ────────────────────────────────────────────────────────
  const startUpload = React.useCallback(async () => {
    if (!dealId || selectedFiles.length === 0) return
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const existingPaths = new Set(dealData.documents.map((d) => d.original_path))
      const filesToUpload = selectedFiles.filter(
        (f) => !existingPaths.has(f.relativePath) || overwriteSet.has(f.relativePath),
      )
      const result = await uploadFiles(dealId, filesToUpload, getToken, setUploadProgress, ac.signal)
      setSkippedFiles((prev) => {
        const merged = [...prev]
        for (const p of result.skippedFiles) {
          if (!merged.includes(p)) merged.push(p)
        }
        return merged
      })
      setShowDropzone(false)
      dealData.refresh()
      toast.success(
        `Upload complete — ${result.filesUploaded} file${result.filesUploaded !== 1 ? "s" : ""} uploaded`,
        result.skippedFiles.length > 0
          ? { description: `${result.skippedFiles.length} file${result.skippedFiles.length !== 1 ? "s" : ""} skipped (unsupported format)` }
          : undefined,
      )
    } catch (err) {
      if ((err as Error).message !== "Upload cancelled") {
        setUploadProgress((p) => ({ ...p, state: "error", error: (err as Error).message }))
      }
    }
  }, [dealId, selectedFiles, overwriteSet, getToken, dealData])

  const cancelUpload = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setUploadProgress({ overall: 0, files: {}, state: "idle" })
  }

  const resetUpload = () => {
    setSelectedFiles([])
    setOverwriteSet(new Set())
    setUploadProgress({ overall: 0, files: {}, state: "idle" })
    setShowDropzone(true)
    if (fileInputRef.current) fileInputRef.current.value = ""
    if (fileInputSingleRef.current) fileInputSingleRef.current.value = ""
  }

  // Reset dropzone state when switching projects
  React.useEffect(() => {
    setShowDropzone(true)
    setSelectedFiles([])
    setOverwriteSet(new Set())
    setUploadProgress({ overall: 0, files: {}, state: "idle" })
  }, [dealId])

  // Hide dropzone if this project already has files (loaded from sidebar)
  React.useEffect(() => {
    if (dealData.documents.length > 0) setShowDropzone(false)
  }, [dealData.documents.length])

  const folderName =
    selectedFiles.length > 0
      ? selectedFiles[0].relativePath.split("/")[0] || "Selected files"
      : ""

  const isUploading = ["initializing", "uploading", "completing"].includes(uploadProgress.state)

  // Show a full-screen loader when opening an existing project (not a fresh new one).
  // Must be after all hooks.
  if (!isNewProject && dealData.loading) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-7 animate-spin" />
        <p className="text-sm">Loading project…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/20">
      {/* Upload card: confirm delete dialog */}
      <Dialog open={!!uploadConfirmDelete} onOpenChange={(open) => { if (!open) setUploadConfirmDelete(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete file?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{uploadConfirmDelete?.filename}</span> will be permanently removed.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleUploadDeleteConfirmed}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Upload card: file preview dialog */}
      <Dialog open={!!uploadPreview} onOpenChange={(open) => { if (!open) setUploadPreview(null) }}>
        <DialogContent className="w-[90vw] max-w-[1200px] sm:max-w-[1200px] p-0 overflow-hidden" showCloseButton>
          <DialogHeader className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between gap-2 pr-8">
              <DialogTitle className="truncate text-sm">{uploadPreview?.title}</DialogTitle>
              <a href={uploadPreview?.url} target="_blank" rel="noopener noreferrer" className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ExternalLink className="size-4" />Open in new tab
              </a>
            </div>
          </DialogHeader>
          <iframe src={uploadPreview?.url} className="w-full border-0" style={{ height: "85vh" }} title={uploadPreview?.title} />
        </DialogContent>
      </Dialog>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row md:items-stretch">

        {/* Chat panel — left side, collapsible */}
        {chatOpen ? (
          <Card
            className="group relative flex min-h-0 w-full max-md:min-h-[min(42dvh,24rem)] flex-1 flex-col gap-0 overflow-hidden rounded-none border-0 border-border/80 border-t bg-card py-0 shadow-none ring-0 ring-transparent md:flex-none md:self-stretch md:border-t-0 md:border-r md:border-border/50 md:rounded-none md:shadow-[2px_0_18px_-6px_rgba(0,0,0,0.12)]"
            style={{ width: chatWidth }}
          >
            {/* Drag handle on the right border */}
            <div
              onMouseDown={startDrag}
              className="absolute top-0 right-0 z-10 hidden h-full w-3 cursor-col-resize md:flex"
              aria-hidden
            >
              <div className="m-auto flex h-16 w-full items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100">
                <GripVertical className="size-4 text-foreground/30" />
              </div>
            </div>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0">
              <header className="flex shrink-0 items-center gap-2 border-b border-border/50 px-2 py-2.5 md:px-3">
                <h2 className="min-w-0 flex-1 truncate text-center text-sm font-semibold tracking-tight text-foreground">
                  <span className="bg-gradient-to-r from-primary to-violet-400 bg-clip-text text-transparent">DataRoom</span> AI Assistant
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-foreground/50 hover:bg-muted hover:text-foreground"
                  onClick={() => setChatOpen(false)}
                  aria-label="Collapse chat"
                >
                  <PanelLeftClose className="size-4" />
                </Button>
              </header>
              <div className="min-h-0 flex-1">
                <ProjectSetupAssistant
                  chatPrepend={isDemoWorkspace ? <DemoAgentProcessingLog /> : <StatusChatLog uploadProgress={uploadProgress} processingJob={processingJob} documents={dealData.documents} />}
                  dealId={dealId}
                  chatDisabled={!isDemoWorkspace && !dealData.documents.some((d) => d.rag_indexed)}
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="hidden shrink-0 flex-col items-center border-r border-border/50 bg-card py-2 md:flex md:w-7">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-foreground/50 hover:bg-muted hover:text-foreground"
              onClick={() => setChatOpen(true)}
              aria-label="Open chat"
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </div>
        )}

        <div className="flex min-h-0 min-w-[320px] flex-1 flex-col gap-2 px-3 py-2 md:gap-2.5 md:px-4 md:py-3">
          <div className="shrink-0">
            <ToggleGroup
              type="single"
              value={section}
              onValueChange={(value) => {
                if (value) setSection(value as SetupSection)
              }}
              variant="default"
              size="sm"
              spacing={1}
              className={sectionToggleGroupClass}
            >
              <ToggleGroupItem
                value="upload"
                aria-label="Upload"
                className={sectionToggleItemClass}
              >
                <FolderUp aria-hidden />
                Upload
              </ToggleGroupItem>
              {(isDemoWorkspace || dealData.documents.length > 0) && (
                <>
                  {(isDemoWorkspace || dealData.duplicates.length > 0) && (
                    <ToggleGroupItem
                      value="duplication"
                      aria-label="Duplication"
                      className={sectionToggleItemClass}
                    >
                      <Copy aria-hidden />
                      Duplication
                      {dealData.duplicates.length > 0 && (
                        <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-red-700 dark:bg-red-950/50 dark:text-red-400">
                          {dealData.duplicates.length}
                        </span>
                      )}
                    </ToggleGroupItem>
                  )}
                  <ToggleGroupItem
                    value="file-structure"
                    aria-label="Classification"
                    className={sectionToggleItemClass}
                  >
                    <LayoutGrid aria-hidden />
                    Classification
                    {dealData.documents.length > 0 && (() => {
                      const classified = dealData.documents.filter((d) => d.classification_confidence > 0 && !d.is_empty && !d.is_incomplete).length
                      const pct = Math.round((classified / dealData.documents.length) * 100)
                      return (
                        <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                          pct === 100
                            ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                            : pct >= 80
                              ? "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400"
                              : "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400"
                        }`}>
                          {pct}%
                        </span>
                      )
                    })()}
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="lease-amendment"
                    aria-label="Lease amendment"
                    className={sectionToggleItemClass}
                  >
                    <FilePenLine aria-hidden />
                    Lease Amendment
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="ai-insights"
                    aria-label="AI insights"
                    className={sectionToggleItemClass}
                  >
                    <Sparkles aria-hidden />
                    AI Insights
                  </ToggleGroupItem>
                </>
              )}
            </ToggleGroup>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg px-0.5 pt-1 pb-1 md:px-1">
            {section === "upload" ? (
              <div className={showDropzone && selectedFiles.length === 0 && dealData.documents.length === 0 ? "flex flex-1 flex-col items-center justify-center" : "space-y-3"}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={onInputChange}
                  // @ts-expect-error – non-standard but widely supported folder picker attribute
                  webkitdirectory=""
                />
                {/* Single-file picker — no webkitdirectory so individual files can be selected */}
                <input
                  ref={fileInputSingleRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={onInputChange}
                />

                {/* Step 1: Loading state — skipped when dropzone is shown (new/empty project) */}
                {dealData.loading && !showDropzone ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" />
                    <span>Loading files…</span>
                  </div>
                ) : !hasCompany ? (
                  <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 py-12 text-center">
                    <Building2 className="size-8 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                      No company linked to your account — uploads are disabled until a company is set up.
                    </p>
                  </div>
                ) : (
                  <>
                {/* Existing files — shown when project already has files and dropzone is hidden */}
                {!showDropzone && dealData.documents.length > 0 && !isUploading && (
                  <div className="space-y-3">
                    {/* ── Block 1: Failed / Skipped files ── */}
                    {skippedFiles.length > 0 && (
                      <div className="rounded-xl border border-red-200/80 bg-red-50/40 dark:border-red-900/40 dark:bg-red-950/20 overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-red-200/60 dark:border-red-800/40 px-4 py-2.5">
                          <AlertTriangle className="size-4 shrink-0 text-red-400" />
                          <span className="min-w-0 flex-1 text-xs font-semibold text-red-600 dark:text-red-400">
                            {skippedFiles.length} skipped
                          </span>
                          <button
                            type="button"
                            onClick={() => setSkippedFiles([])}
                            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-red-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/40 transition-colors"
                          >
                            <X className="size-3.5" />
                            Clear
                          </button>
                        </div>
                        {/* Table header */}
                        <div className="grid grid-cols-[1fr_160px] items-center gap-2 border-b border-red-200/50 dark:border-red-800/30 bg-red-100/40 dark:bg-red-950/30 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-500/70 dark:text-red-400/60">
                          <span>File</span>
                          <span>Skip reason</span>
                        </div>
                          <div className={skippedFiles.length > 10 ? "max-h-[280px] overflow-y-auto" : ""}>
                          <div className="divide-y divide-red-200/40 dark:divide-red-800/30">
                            {skippedFiles.map((path) => (
                              <div key={path} className="grid grid-cols-[1fr_160px] items-center gap-2 px-4 py-1.5 text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                  <X className="size-4 shrink-0 text-red-300 dark:text-red-600" />
                                  <span className="min-w-0 flex-1 truncate text-red-400 line-through decoration-red-300/60" title={path}>
                                    {path}
                                  </span>
                                </div>
                                <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:bg-red-950/50 dark:text-red-400">
                                  Unsupported format
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Block 2: Successfully uploaded files with RAG & classification status ── */}
                    {(() => {
                      const docs = dealData.documents
                      const ragCount = docs.filter((d) => d.rag_indexed).length
                      const classifiedCount = docs.filter((d) => d.classification_confidence > 0).length
                      const ragPct = docs.length > 0 ? Math.round((ragCount / docs.length) * 100) : 0
                      const classPct = docs.length > 0 ? Math.round((classifiedCount / docs.length) * 100) : 0

                      // Processing counts
                      const processingCount = docs.filter((d) => d.processing_status === "processing").length
                      const processedCount = docs.filter((d) => d.processing_status === "completed" || d.processing_status === "failed").length
                      const isDocProcessing = processingJob.status === "running" && processingJob.currentStage === "document_processing"
                      const processPct = docs.length > 0 ? Math.round((processedCount / docs.length) * 100) : 0

                      return (
                        <div className="space-y-3">
                        <div className="rounded-xl border border-border/70 bg-background/60 overflow-hidden">
                          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/50">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">{docs.length} file{docs.length !== 1 ? "s" : ""} uploaded</p>
                              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                {(() => {
                                  const classifiedCount = docs.filter((d) => d.classification_confidence > 0).length
                                  if (classifiedCount === docs.length) return `All ${docs.length} classified`
                                  return `${classifiedCount} of ${docs.length} classified`
                                })()}
                                {tabNeedsRefresh && (
                                  <>
                                    <span className="text-muted-foreground/30">·</span>
                                    <RotateCcw className="size-2.5 text-muted-foreground/40" />
                                    <span>{refreshCountdown}s</span>
                                  </>
                                )}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-8 gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white border-0"
                              onClick={resetUpload}
                            >
                              <Plus className="size-4" />
                              Upload More
                            </Button>
                          </div>
                          {/* AI Processing progress — shown while document_processing stage is active */}
                          {isDocProcessing && (
                            <div className="px-4 py-2.5 border-b border-border/40 bg-primary/5">
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  <Loader2 className="size-3.5 animate-spin text-primary" />
                                  <span className="text-[11px] font-medium text-primary">
                                    AI Processing{processingCount > 0 ? ` — ${processingCount} file${processingCount !== 1 ? "s" : ""} in progress` : "…"}
                                  </span>
                                </div>
                                <span className="text-[11px] font-semibold tabular-nums text-primary">
                                  {processedCount}/{docs.length} ({processPct}%)
                                </span>
                              </div>
                              <Progress value={processPct} className="h-1.5" />
                            </div>
                          )}
                          {/* RAG & Classification summary bars */}
                          <div className="grid grid-cols-2 gap-2 px-4 py-2.5 border-b border-border/40">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-muted-foreground">Classified</span>
                                <span className="text-[11px] font-semibold tabular-nums">
                                  {classifiedCount}/{docs.length} ({classPct}%)
                                </span>
                              </div>
                              <Progress value={classPct} className="h-1" />
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-muted-foreground">RAG Indexed</span>
                                <span className="text-[11px] font-semibold tabular-nums">
                                  {ragCount}/{docs.length} ({ragPct}%)
                                </span>
                              </div>
                              <Progress value={ragPct} className="h-1" />
                            </div>
                          </div>
                        </div>
                        <FileStructurePanel documents={docs} loading={false} showStatus dealId={dealId} getToken={getToken} onDeleted={dealData.silentRefresh} />
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Dropzone — only shown when nothing is selected yet or upload is idle */}
                {showDropzone && selectedFiles.length === 0 && dealData.documents.length > 0 && (
                  <div className="flex items-center gap-2 pb-1">
                    <button
                      type="button"
                      onClick={() => setShowDropzone(false)}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                    >
                      <ChevronLeft className="size-4" />
                      Back to files
                    </button>
                  </div>
                )}

                {showDropzone && selectedFiles.length === 0 ? (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        fileInputRef.current?.click()
                      }
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setIsDragging(true)
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={onDrop}
                    className={`w-full max-w-lg md:max-w-2xl flex min-h-48 md:min-h-72 cursor-pointer flex-col items-center justify-center gap-4 md:gap-6 rounded-2xl border-2 border-dashed px-8 py-10 md:py-16 text-center transition-all duration-200 ${
                      isDragging
                        ? "border-primary/80 bg-primary/5 shadow-[0_0_0_4px_hsl(var(--primary)/0.08)]"
                        : "border-border/80 bg-muted/20 hover:border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="rounded-full border border-border/70 bg-background p-3">
                      <FolderUp className="size-6 text-muted-foreground" />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium text-foreground/95">
                        Drag files or a folder here
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Large files are uploaded in resumable chunks.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                      >
                        <FolderUp className="size-4" />
                        Browse folder
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={(e) => { e.stopPropagation(); fileInputSingleRef.current?.click() }}
                      >
                        <FileIcon className="size-4" />
                        Browse files
                      </Button>
                    </div>
                  </div>
                ) : null}

                {showDropzone && selectedFiles.length > 0 ? (
                  <div className="space-y-3">
                    {/* Selection summary + actions */}
                    {(() => {
                      const existingPathSet = new Set(dealData.documents.map((d) => d.original_path))
                      const serverSizeByPath = Object.fromEntries(dealData.documents.map((d) => [d.original_path, d.file_size]))
                      const conflictFiles = selectedFiles.filter(
                        (f) => isSupported(f.relativePath) && existingPathSet.has(f.relativePath),
                      )
                      const allOverwritten = conflictFiles.length > 0 && conflictFiles.every((f) => overwriteSet.has(f.relativePath))
                      return (
                        <>
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-muted/30 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{folderName}</p>
                        <p className="text-xs text-muted-foreground">
                          {selectedFiles.filter((f) => isSupported(f.relativePath)).length} supported
                          {selectedFiles.some((f) => !isSupported(f.relativePath)) && (
                            <span className="text-amber-500">
                              {" · "}
                              {selectedFiles.filter((f) => !isSupported(f.relativePath)).length} unsupported
                            </span>
                          )}
                          {conflictFiles.length > 0 && (
                            <span className="text-orange-500">
                              {" · "}
                              {conflictFiles.length} already exist
                            </span>
                          )}
                          {" · "}
                          {formatBytes(selectedFiles.reduce((s, f) => s + f.file.size, 0))}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {uploadProgress.state === "idle" && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 gap-1.5 text-xs"
                              onClick={() => fileInputRef.current?.click()}
                            >
                              <RotateCcw className="size-4" />
                              Re-select
                            </Button>
                            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={startUpload} disabled={!dealId}>
                              <FolderUp className="size-4" />
                              Upload
                            </Button>
                          </>
                        )}
                        {isUploading && (
                          <Button size="sm" variant="destructive" className="h-8 gap-1.5 text-xs" onClick={cancelUpload}>
                            <X className="size-4" />
                            Cancel
                          </Button>
                        )}
                        {uploadProgress.state === "done" && (
                          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={resetUpload}>
                            <CheckCircle2 className="size-4 text-green-600" />
                            Done — upload more
                          </Button>
                        )}
                        {uploadProgress.state === "error" && (
                          <>
                            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={resetUpload}>
                              Reset
                            </Button>
                            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={startUpload}>
                              <RotateCcw className="size-4" />
                              Retry
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Conflict warning card — only shown when existing files are selected */}
                    {conflictFiles.length > 0 && uploadProgress.state === "idle" && (
                        <div className="rounded-xl border border-orange-200 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-950/20 overflow-hidden">
                          <div className="flex items-center justify-between gap-2 border-b border-orange-200/60 dark:border-orange-800/40 px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="size-4 shrink-0 text-orange-500" />
                              <span className="text-xs font-semibold text-orange-700 dark:text-orange-400">
                                {conflictFiles.length} file{conflictFiles.length !== 1 ? "s" : ""} already exist
                              </span>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1.5 text-xs text-orange-700 hover:bg-orange-100 hover:text-orange-800 dark:text-orange-400 dark:hover:bg-orange-900/30"
                              onClick={() => {
                                if (allOverwritten) {
                                  setOverwriteSet(new Set())
                                } else {
                                  setOverwriteSet(new Set(conflictFiles.map((f) => f.relativePath)))
                                }
                              }}
                            >
                              {allOverwritten ? "Skip All" : "Overwrite All"}
                            </Button>
                          </div>
                          {/* Table header */}
                          <div className="grid grid-cols-[1fr_80px_80px_90px_90px] items-center gap-2 border-b border-orange-200/40 dark:border-orange-800/30 bg-orange-100/40 dark:bg-orange-950/30 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-orange-600/70 dark:text-orange-500/60">
                            <span>File</span>
                            <span className="text-right">Local size</span>
                            <span className="text-right">Server size</span>
                            <span className="text-center">Action</span>
                            <span className="text-center">Toggle</span>
                          </div>
                          <div className="divide-y divide-orange-200/40 dark:divide-orange-800/30">
                            {conflictFiles.map((f) => {
                              const willOverwrite = overwriteSet.has(f.relativePath)
                              const serverSize = serverSizeByPath[f.relativePath] ?? 0
                              const sizeDiffers = f.file.size !== serverSize
                              return (
                                <div key={f.relativePath} className="grid grid-cols-[1fr_80px_80px_90px_90px] items-center gap-2 px-4 py-1.5 text-xs">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <FileIcon className="size-4 shrink-0 text-orange-400" />
                                    <span className="min-w-0 truncate text-orange-700 dark:text-orange-300" title={f.relativePath}>
                                      {f.relativePath}
                                    </span>
                                    {sizeDiffers && (
                                      <span className="shrink-0 rounded-full bg-orange-200 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/50 dark:text-orange-400">Δ size</span>
                                    )}
                                  </div>
                                  <span className="text-right tabular-nums text-muted-foreground">{formatBytes(f.file.size)}</span>
                                  <span className={`text-right tabular-nums ${sizeDiffers ? "text-orange-600 font-medium dark:text-orange-400" : "text-muted-foreground"}`}>{formatBytes(serverSize)}</span>
                                  {/* Action label */}
                                  <div className="flex justify-center">
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                      willOverwrite
                                        ? "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400"
                                        : "bg-muted text-muted-foreground/60"
                                    }`}>
                                      {willOverwrite ? "Replace existing" : "Skip"}
                                    </span>
                                  </div>
                                  <div className="flex justify-center">
                                    <Button
                                      size="sm"
                                      variant={willOverwrite ? "default" : "outline"}
                                      className={`h-6 px-2 text-[11px] ${willOverwrite ? "bg-orange-600 hover:bg-orange-700 text-white border-orange-600" : "border-border text-muted-foreground hover:bg-muted"}`}
                                      onClick={() => {
                                        setOverwriteSet((prev) => {
                                          const next = new Set(prev)
                                          if (next.has(f.relativePath)) next.delete(f.relativePath)
                                          else next.add(f.relativePath)
                                          return next
                                        })
                                      }}
                                    >
                                      {willOverwrite ? "Undo" : "Overwrite"}
                                    </Button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                    )}

                    {/* Overall progress bar */}
                    {uploadProgress.state !== "idle" && (
                      <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/80 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium capitalize text-muted-foreground">
                            {uploadProgress.state === "completing"
                              ? "Finalizing…"
                              : uploadProgress.state === "done"
                                ? "Upload complete"
                                : uploadProgress.state === "error"
                                  ? "Upload failed"
                                  : `Uploading… ${Math.round(uploadProgress.overall * 100)}%`}
                          </span>
                          {isUploading && (
                            <Loader2 className="size-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        <Progress value={uploadProgress.overall * 100} className="h-1.5" />
                        {uploadProgress.error && (
                          <p className="text-xs text-destructive">{uploadProgress.error}</p>
                        )}
                      </div>
                    )}

                    {/* Per-file list */}
                    <div className="rounded-xl border border-border/60 overflow-hidden">
                      {/* Table header */}
                      <div className="grid grid-cols-[1fr_72px_140px] items-center gap-2 border-b border-border/50 bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                        <span>File</span>
                        <span className="text-right">Size</span>
                        <span>Status / Reason</span>
                      </div>
                      <ScrollArea className="max-h-[40vh]">
                        <div className="divide-y divide-border/30">
                          {selectedFiles.map((entry) => {
                            const supported = isSupported(entry.relativePath)
                            const isConflict = existingPathSet.has(entry.relativePath) && supported
                            const willOverwrite = overwriteSet.has(entry.relativePath)
                            const willSkip = isConflict && !willOverwrite
                            const fp = uploadProgress.files[entry.relativePath]
                            const pct = fp ? Math.round(fp.progress * 100) : 0
                            const isDone = fp && fp.uploadedChunks === fp.totalChunks && fp.totalChunks > 0

                            let statusBadge: React.ReactNode
                            if (!supported) {
                              statusBadge = (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                                  Unsupported format
                                </span>
                              )
                            } else if (isDone) {
                              statusBadge = (
                                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-950/50 dark:text-green-400">
                                  Uploaded ✓
                                </span>
                              )
                            } else if (fp && uploadProgress.state !== "idle") {
                              statusBadge = (
                                <span className="tabular-nums text-[11px] text-muted-foreground/70">
                                  {pct}%
                                </span>
                              )
                            } else if (willSkip) {
                              statusBadge = (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground/60">
                                  Already exists — skip
                                </span>
                              )
                            } else if (willOverwrite) {
                              statusBadge = (
                                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-950/50 dark:text-orange-400">
                                  Will overwrite
                                </span>
                              )
                            } else {
                              statusBadge = (
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-400">
                                  Ready
                                </span>
                              )
                            }

                            return (
                              <div
                                key={entry.relativePath}
                                className={`grid grid-cols-[1fr_72px_140px] items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/20 ${!supported || willSkip ? "opacity-60" : ""}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {!supported ? (
                                    <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                                  ) : isDone ? (
                                    <CheckCircle2 className="size-4 shrink-0 text-green-600" />
                                  ) : isConflict ? (
                                    <AlertTriangle className="size-4 shrink-0 text-orange-400" />
                                  ) : (
                                    <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                                  )}
                                  <span
                                    className={`min-w-0 flex-1 truncate ${!supported ? "text-amber-600 line-through decoration-amber-400/60" : willSkip ? "text-muted-foreground/50 line-through" : "text-muted-foreground"}`}
                                    title={entry.relativePath}
                                  >
                                    {entry.relativePath}
                                  </span>
                                </div>
                                <span className="shrink-0 text-right tabular-nums text-muted-foreground/70">
                                  {formatBytes(entry.file.size)}
                                </span>
                                <div>{statusBadge}</div>
                              </div>
                            )
                          })}
                        </div>
                      </ScrollArea>
                    </div>

                    {/* Skipped-files banner — shown after upload completes */}
                    {skippedFiles.length > 0 && uploadProgress.state === "done" && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/30">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          {skippedFiles.length} file{skippedFiles.length !== 1 ? "s were" : " was"} skipped — unsupported file type.
                        </p>
                      </div>
                    )}
                        </>
                      )
                    })()}
                  </div>
                ) : null}
                  </>
                )}

              </div>
            ) : null}
            {section === "ai-insights" ? (
              isDemoWorkspace ? (
                <DemoAiInsightsPanel />
              ) : (
                <AiInsightsPanel documents={dealData.documents} loading={dealData.loading} />
              )
            ) : null}
            {section === "file-structure" ? (
              isDemoWorkspace ? (
                <DemoFileStructurePanel />
              ) : (
                <div className="space-y-4">
                  <ClassificationPanel
                    classifications={classifications}
                    documents={dealData.documents}
                    duplicates={dealData.duplicates}
                    loading={classificationsLoading}
                    dealId={dealId}
                    onProcessed={dealData.silentRefresh}
                    isDocProcessing={
                      processingJob.status === "running" &&
                      processingJob.currentStage === "document_processing"
                    }
                    isProcessingActive={isProcessingActive}
                    countdown={refreshCountdown}
                    needsRefresh={tabNeedsRefresh}
                  />
                </div>
              )
            ) : null}
            {section === "duplication" ? (
              isDemoWorkspace ? (
                <DemoDuplicatesPanel />
              ) : (
                <DuplicationPanel
                    groups={dealData.duplicates}
                    loading={dealData.loading}
                    dealId={dealId}
                    getToken={getToken}
                    onDeleted={dealData.silentRefresh}
                  />
              )
            ) : null}
            {section === "lease-amendment" ? (
              isDemoWorkspace ? (
                <DemoLeaseChainsPanel />
              ) : (
                <LeaseAmendmentPanel chains={dealData.leaseChains} loading={dealData.loading} />
              )
            ) : null}

            {/* ── Section navigation footer ── */}
            {(() => {
              const hasDuplicates = dealData.duplicates.length > 0
              let nextSec: SetupSection | null = null
              let nextLabel = ""
              let NextIcon: React.ElementType | null = null

              if (section === "upload") {
                if (dealData.documents.length === 0 || isUploading || dealData.loading) return null
                nextSec = hasDuplicates ? "duplication" : "file-structure"
                nextLabel = hasDuplicates ? "Duplication" : "Classification"
                NextIcon = hasDuplicates ? Copy : LayoutGrid
              } else if (section === "duplication") {
                nextSec = "file-structure"
                nextLabel = "Classification"
                NextIcon = LayoutGrid
              } else if (section === "file-structure") {
                nextSec = "lease-amendment"
                nextLabel = "Lease Amendment"
                NextIcon = FilePenLine
              } else if (section === "lease-amendment") {
                nextSec = "ai-insights"
                nextLabel = "AI Insights"
                NextIcon = Sparkles
              }
              if (!nextSec || !NextIcon) return null
              const dest = nextSec
              return (
                <div className="flex justify-end pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                    onClick={() => setSection(dest)}
                  >
                    Next: {nextLabel}
                    <NextIcon className="size-4" />
                  </Button>
                </div>
              )
            })()}

          </div>
        </div>

      </div>
    </div>
  )
}
