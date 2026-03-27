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
  CheckCircle2,
  ChevronRight,
  Copy,
  File as FileIcon,
  FilePenLine,
  Folder,
  FolderTree,
  FolderUp,
  GripVertical,
  Link2,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
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

export type SetupSection =
  | "upload"
  | "ai-insights"
  | "file-structure"
  | "duplication"
  | "lease-amendment"

const sectionToggleItemClass =
  "flex min-h-11 w-full min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-[11px] border-0 bg-transparent px-2 py-2.5 text-center text-[13px] font-medium leading-tight tracking-[-0.015em] text-zinc-500 antialiased transition-[color,background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:bg-black/[0.03] hover:text-zinc-700 hover:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-100/80 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-white data-[state=on]:text-zinc-900 data-[state=on]:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_3px_10px_rgba(0,0,0,0.06)] data-[state=on]:ring-1 data-[state=on]:ring-black/[0.05] data-[state=on]:hover:bg-white sm:min-h-9 sm:rounded-[10px] sm:px-2.5 sm:py-2 [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:text-zinc-400 [&_svg]:opacity-90 data-[state=on]:[&_svg]:text-zinc-600"

const sectionToggleGroupClass =
  "flex w-full flex-col gap-1.5 rounded-[14px] border border-zinc-200/90 bg-zinc-100/95 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),inset_0_-1px_0_rgba(0,0,0,0.02)] backdrop-blur-xl sm:flex-row sm:items-stretch sm:gap-1 sm:rounded-[13px]"

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

function FileStructurePanel({ documents, loading }: { documents: DealDocument[]; loading: boolean }) {
  if (loading) return <LoadingRows />
  if (documents.length === 0)
    return <EmptyState icon={FolderTree} message="No files yet — upload to see folder structure." />

  // Build folder tree
  const tree: Record<string, DealDocument[]> = {}
  for (const doc of documents) {
    const parts = doc.original_path.split("/")
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "/"
    if (!tree[folder]) tree[folder] = []
    tree[folder].push(doc)
  }

  return (
    <div className="space-y-2 pr-1">
        {Object.entries(tree)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([folder, docs]) => (
            <div key={folder} className="rounded-xl border border-border/60 bg-background/60 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2">
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium" title={folder}>
                  {folder === "/" ? "Root" : folder}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground/70">{docs.length}</span>
              </div>
              <div className="divide-y divide-border/30">
                {docs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-2 px-3 py-1.5">
                    <FileIcon className="size-3 shrink-0 text-muted-foreground/50" />
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={doc.filename}>
                      {doc.filename}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground/50 tabular-nums">
                      {formatBytes(doc.file_size)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
  )
}

function DuplicationPanel({ groups, loading }: { groups: DuplicateGroup[]; loading: boolean }) {
  if (loading) return <LoadingRows />
  if (groups.length === 0)
    return <EmptyState icon={Copy} message="No duplicates detected yet." />

  return (
    <div className="space-y-2 pr-1">
        {groups.map((group) => (
          <div key={group.id} className="rounded-xl border border-border/60 bg-background/60 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2">
              <Copy className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={group.group_name}>
                {group.group_name}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                group.match_type === "exact"
                  ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
              }`}>
                {group.match_type}
              </span>
            </div>
            <div className="divide-y divide-border/30">
              {group.members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 px-3 py-1.5">
                  {m.is_canonical
                    ? <CheckCircle2 className="size-3 shrink-0 text-green-600" />
                    : <FileIcon className="size-3 shrink-0 text-muted-foreground/50" />
                  }
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={m.original_path ?? ""}>
                    {m.filename ?? m.original_path ?? "Unknown"}
                  </span>
                  {m.is_canonical && (
                    <span className="shrink-0 text-[11px] text-green-600">canonical</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
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
              <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
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
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={doc.original_path ?? ""}>
                    {doc.filename ?? doc.original_path ?? "Unknown"}
                  </span>
                  <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-700 dark:bg-blue-950/50 dark:text-blue-400">
                    {DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type}
                    {doc.amendment_number != null ? ` #${doc.amendment_number}` : ""}
                  </span>
                  {doc.is_orphaned && (
                    <AlertTriangle className="size-3.5 shrink-0 text-amber-500" title="Orphaned" />
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
  onBack: () => void
}

export function ProjectSetupScreen({ dealId, projectTitle, onBack }: ProjectSetupScreenProps) {
  const { getToken } = useAuth()
  const [section, setSection] = React.useState<SetupSection>("upload")
  const [chatOpen, setChatOpen] = React.useState(true)
  const [chatWidth, setChatWidth] = React.useState(320)
  const isDemoWorkspace = projectTitle === DEMO_WORKSPACE_TITLE

  // ── Real deal data ────────────────────────────────────────────────────────
  const dealData = useDealData(dealId)

  const startDrag = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
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

  React.useEffect(() => {
    const input = fileInputRef.current
    if (!input) return
    input.setAttribute("webkitdirectory", "")
    input.setAttribute("directory", "")
  }, [])

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
      setSkippedFiles(result.skippedFiles)
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
    setSkippedFiles([])
    setOverwriteSet(new Set())
    setUploadProgress({ overall: 0, files: {}, state: "idle" })
    setShowDropzone(true)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // Hide dropzone if this project already has files (loaded from sidebar)
  React.useEffect(() => {
    if (dealData.documents.length > 0) setShowDropzone(false)
  }, [dealData.documents.length])

  const folderName =
    selectedFiles.length > 0
      ? selectedFiles[0].relativePath.split("/")[0] || "Selected files"
      : ""

  const isUploading = ["initializing", "uploading", "completing"].includes(uploadProgress.state)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/20">
      {/* Top navigation bar */}
      <nav className="relative flex shrink-0 items-center border-b border-border/60 bg-background/80 px-3 py-2 backdrop-blur-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
          Projects
        </Button>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="max-w-xs truncate text-sm font-semibold tracking-tight">{projectTitle}</span>
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row md:items-stretch">

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
              <ToggleGroupItem
                value="ai-insights"
                aria-label="AI insights"
                className={sectionToggleItemClass}
              >
                <Sparkles aria-hidden />
                AI Insights
              </ToggleGroupItem>
              <ToggleGroupItem
                value="file-structure"
                aria-label="File structure"
                className={sectionToggleItemClass}
              >
                <FolderTree aria-hidden />
                File Structure
              </ToggleGroupItem>
              <ToggleGroupItem
                value="duplication"
                aria-label="Duplication"
                className={sectionToggleItemClass}
              >
                <Copy aria-hidden />
                Duplication
              </ToggleGroupItem>
              <ToggleGroupItem
                value="lease-amendment"
                aria-label="Lease amendment"
                className={sectionToggleItemClass}
              >
                <FilePenLine aria-hidden />
                Lease Amendment
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg px-0.5 pt-1 pb-1 md:px-1">
            {section === "upload" ? (
              <div className="space-y-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={onInputChange}
                />

                {/* Step 1: Loading state */}
                {dealData.loading ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" />
                    <span>Loading files…</span>
                  </div>
                ) : (
                  <>
                {/* Existing files — shown when project already has files and dropzone is hidden */}
                {!showDropzone && dealData.documents.length > 0 && !isUploading && (
                  <div className="space-y-3">
                    {/* ── Block 1: Failed / Skipped files ── */}
                    {dealData.skippedFiles.length > 0 && (
                      <div className="rounded-xl border border-red-200/80 bg-red-50/40 dark:border-red-900/40 dark:bg-red-950/20 overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-red-200/60 dark:border-red-800/40 px-4 py-2.5">
                          <AlertTriangle className="size-3.5 shrink-0 text-red-400" />
                          <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                            {dealData.skippedFiles.length} failed — unsupported format
                          </span>
                        </div>
                        <div className={dealData.skippedFiles.length > 10 ? "max-h-[280px] overflow-y-auto" : ""}>
                          <div className="divide-y divide-red-200/40 dark:divide-red-800/30">
                            {dealData.skippedFiles.map((path) => (
                              <div key={path} className="flex items-center gap-2 px-4 py-1.5 text-xs">
                                <X className="size-3.5 shrink-0 text-red-300 dark:text-red-600" />
                                <span className="min-w-0 flex-1 truncate text-red-400 line-through decoration-red-300/60" title={path}>
                                  {path}
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

                      return (
                        <div className="rounded-xl border border-border/70 bg-background/60 overflow-hidden">
                          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/50">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">{docs.length} file{docs.length !== 1 ? "s" : ""} uploaded</p>
                              <p className="text-xs text-muted-foreground">
                                {formatBytes(docs.reduce((s, d) => s + d.file_size, 0))} total
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1.5 text-xs"
                              onClick={resetUpload}
                            >
                              <Plus className="size-3.5" />
                              Upload More
                            </Button>
                          </div>
                          {/* RAG & Classification summary bars */}
                          <div className="grid grid-cols-2 gap-2 px-4 py-2.5 border-b border-border/40">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-muted-foreground">RAG Indexed</span>
                                <span className="text-[11px] font-semibold tabular-nums">
                                  {ragCount}/{docs.length} ({ragPct}%)
                                </span>
                              </div>
                              <Progress value={ragPct} className="h-1" />
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-muted-foreground">Classified</span>
                                <span className="text-[11px] font-semibold tabular-nums">
                                  {classifiedCount}/{docs.length} ({classPct}%)
                                </span>
                              </div>
                              <Progress value={classPct} className="h-1" />
                            </div>
                          </div>
                          {/* File rows — first 10 always visible, rest scrollable */}
                          <div className={docs.length > 10 ? "max-h-[320px] overflow-y-auto" : ""}>
                            <div className="divide-y divide-border/30">
                              {dealData.loading ? (
                                <div className="p-3 space-y-2">
                                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
                                </div>
                              ) : (
                                docs.map((doc) => {
                                  const classified = doc.classification_confidence > 0
                                  const ragged = doc.rag_indexed
                                  return (
                                    <div key={doc.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/20">
                                      {ragged && classified
                                        ? <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />
                                        : <FileIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
                                      }
                                      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={doc.original_path}>
                                        {doc.original_path}
                                      </span>
                                      <span className="shrink-0 tabular-nums text-muted-foreground/50">
                                        {formatBytes(doc.file_size)}
                                      </span>
                                      {/* RAG status */}
                                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                        ragged
                                          ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                                          : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                                      }`}>
                                        {ragged ? "RAG ✓" : "RAG pending"}
                                      </span>
                                      {/* Classification status */}
                                      {classified ? (
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_COLORS[doc.assigned_category] ?? CATEGORY_COLORS.other}`}>
                                          {CATEGORY_LABELS[doc.assigned_category] ?? doc.assigned_category}
                                        </span>
                                      ) : (
                                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                                          Pending
                                        </span>
                                      )}
                                    </div>
                                  )
                                })
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Dropzone — only shown when nothing is selected yet or upload is idle */}
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
                    className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-10 text-center transition-all duration-200 ${
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
                        Drag a folder here, or click to browse
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Folder upload is supported. Large files are uploaded in resumable chunks.
                      </p>
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
                              <RotateCcw className="size-3.5" />
                              Re-select
                            </Button>
                            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={startUpload} disabled={!dealId}>
                              <FolderUp className="size-3.5" />
                              Upload
                            </Button>
                          </>
                        )}
                        {isUploading && (
                          <Button size="sm" variant="destructive" className="h-8 gap-1.5 text-xs" onClick={cancelUpload}>
                            <X className="size-3.5" />
                            Cancel
                          </Button>
                        )}
                        {uploadProgress.state === "done" && (
                          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={resetUpload}>
                            <CheckCircle2 className="size-3.5 text-green-600" />
                            Done — upload more
                          </Button>
                        )}
                        {uploadProgress.state === "error" && (
                          <>
                            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={resetUpload}>
                              Reset
                            </Button>
                            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={startUpload}>
                              <RotateCcw className="size-3.5" />
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
                              <AlertTriangle className="size-3.5 shrink-0 text-orange-500" />
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
                                    <FileIcon className="size-3.5 shrink-0 text-orange-400" />
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
                            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        <Progress value={uploadProgress.overall * 100} className="h-1.5" />
                        {uploadProgress.error && (
                          <p className="text-xs text-destructive">{uploadProgress.error}</p>
                        )}
                      </div>
                    )}

                    {/* Per-file list */}
                    <ScrollArea className="max-h-[40vh]">
                      <div className="space-y-0.5">
                        {selectedFiles.map((entry) => {
                          const supported = isSupported(entry.relativePath)
                          const isConflict = existingPathSet.has(entry.relativePath) && supported
                          const willOverwrite = overwriteSet.has(entry.relativePath)
                          const willSkip = isConflict && !willOverwrite
                          const fp = uploadProgress.files[entry.relativePath]
                          const pct = fp ? Math.round(fp.progress * 100) : 0
                          const isDone = fp && fp.uploadedChunks === fp.totalChunks && fp.totalChunks > 0
                          return (
                            <div
                              key={entry.relativePath}
                              className={`group flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs hover:bg-muted/30 ${!supported || willSkip ? "opacity-60" : ""}`}
                            >
                              {!supported ? (
                                <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                              ) : isDone ? (
                                <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />
                              ) : isConflict ? (
                                <AlertTriangle className="size-3.5 shrink-0 text-orange-400" />
                              ) : (
                                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span
                                className={`min-w-0 flex-1 truncate ${!supported ? "text-amber-600 line-through decoration-amber-400/60" : willSkip ? "text-muted-foreground/50 line-through" : "text-muted-foreground"}`}
                                title={entry.relativePath}
                              >
                                {entry.relativePath}
                              </span>
                              <span className="shrink-0 tabular-nums text-muted-foreground/70">
                                {formatBytes(entry.file.size)}
                              </span>
                              {!supported ? (
                                <span className="shrink-0 text-amber-500">skipped</span>
                              ) : willSkip && uploadProgress.state === "idle" ? (
                                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground/60">skip</span>
                              ) : fp && uploadProgress.state !== "idle" && !isDone ? (
                                <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground/70">
                                  {pct}%
                                </span>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    </ScrollArea>

                    {/* Skipped-files banner — shown after upload completes */}
                    {skippedFiles.length > 0 && uploadProgress.state === "done" && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/30">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
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
                <FileStructurePanel documents={dealData.documents} loading={dealData.loading} />
              )
            ) : null}
            {section === "duplication" ? (
              isDemoWorkspace ? (
                <DemoDuplicatesPanel />
              ) : (
                <DuplicationPanel groups={dealData.duplicates} loading={dealData.loading} />
              )
            ) : null}
            {section === "lease-amendment" ? (
              isDemoWorkspace ? (
                <DemoLeaseChainsPanel />
              ) : (
                <LeaseAmendmentPanel chains={dealData.leaseChains} loading={dealData.loading} />
              )
            ) : null}
          </div>
        </div>

        {/* Chat panel — right side, collapsible */}
        {chatOpen ? (
          <Card
            className="dark group relative flex min-h-0 w-full max-md:min-h-[min(42dvh,24rem)] flex-1 flex-col gap-0 overflow-hidden rounded-none border-0 border-border/80 border-t bg-card py-0 shadow-none ring-0 ring-transparent [color-scheme:dark] md:flex-none md:self-stretch md:border-t-0 md:border-l md:border-white/[0.09] md:rounded-none md:shadow-[-2px_0_18px_-6px_rgba(0,0,0,0.12)]"
            style={{ width: chatWidth }}
          >
            {/* Drag handle on the left border */}
            <div
              onMouseDown={startDrag}
              className="absolute top-0 left-0 z-10 hidden h-full w-3 cursor-col-resize md:flex"
              aria-hidden
            >
              <div className="m-auto flex h-16 w-full items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100">
                <GripVertical className="size-4 text-white/50" />
              </div>
            </div>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0">
              <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.09] px-2 py-2.5 md:px-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-foreground/60 hover:bg-white/10 hover:text-foreground"
                  onClick={() => setChatOpen(false)}
                  aria-label="Collapse chat"
                >
                  <PanelRightClose className="size-4" />
                </Button>
                <h2 className="min-w-0 flex-1 truncate text-center text-sm font-semibold tracking-tight text-foreground">
                  AI Assistant
                </h2>
              </header>
              <div className="min-h-0 flex-1">
                <ProjectSetupAssistant
                  chatPrepend={isDemoWorkspace ? <DemoAgentProcessingLog /> : undefined}
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="dark hidden shrink-0 flex-col items-center border-l border-white/[0.09] bg-card py-2 [color-scheme:dark] md:flex md:w-7">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-foreground/60 hover:bg-white/10 hover:text-foreground"
              onClick={() => setChatOpen(true)}
              aria-label="Open chat"
            >
              <PanelRightOpen className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
