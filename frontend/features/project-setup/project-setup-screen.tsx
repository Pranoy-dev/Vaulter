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
  Copy,
  ExternalLink,
  Eye,
  File as FileIcon,
  Trash2,
  FilePenLine,
  Folder,
  FolderTree,
  FolderUp,
  GripVertical,
  LayoutGrid,
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
import { useClassifications } from "@/hooks/use-classifications"
import type { Classification } from "@/hooks/use-classifications"
import { useProcessingStatus } from "@/hooks/use-processing-status"

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

// ── File tree helpers ────────────────────────────────────────────────────────

interface TreeNode {
  name: string
  path: string
  children: Record<string, TreeNode>
  files: DealDocument[]
}

function buildTree(documents: DealDocument[]): TreeNode {
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
}: {
  node: TreeNode
  depth?: number
  showStatus?: boolean
  onPreview?: (docId: string, filename: string, ctrlKey: boolean) => void
  loadingPreviewId?: string | null
  onDelete?: (docId: string, filename: string) => void
  deletingId?: string | null
}) {
  const [open, setOpen] = React.useState(true)
  const hasChildren = Object.keys(node.children).length > 0
  const indent = depth * 16

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors"
          style={{ paddingLeft: `${8 + indent}px` }}
        >
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-150 ${
              open ? "rotate-90" : ""
            }`}
          />
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left" title={node.name}>{node.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground/50 tabular-nums">
            {node.files.length + Object.values(node.children).reduce((s, c) => s + c.files.length, 0)}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Sub-folders */}
        {Object.values(node.children)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((child) => (
            <TreeNodeRow key={child.path} node={child} depth={depth + 1} showStatus={showStatus} onPreview={onPreview} loadingPreviewId={loadingPreviewId} onDelete={onDelete} deletingId={deletingId} />
          ))}
        {/* Files in this folder */}
        {node.files.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/30"
            style={{ paddingLeft: `${8 + indent + 20}px` }}
          >
            {showStatus && doc.processing_status === "processing"
              ? <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
              : showStatus && doc.classification_confidence > 0
                ? <CheckCircle2 className="size-3 shrink-0 text-green-600" />
                : <FileIcon className="size-3 shrink-0 text-muted-foreground/40" />}
            {onPreview ? (
              <button
                type="button"
                onClick={(e) => onPreview(doc.id, doc.filename, e.ctrlKey || e.metaKey)}
                disabled={loadingPreviewId === doc.id}
                className="group min-w-0 flex-1 flex items-center gap-1 text-left hover:text-foreground transition-colors disabled:opacity-50"
                title="Click to preview · Ctrl+click to open in new tab"
              >
                {loadingPreviewId === doc.id
                  ? <Loader2 className="size-3 shrink-0 animate-spin" />
                  : <Eye className="size-3 shrink-0 opacity-0 group-hover:opacity-40 transition-opacity" />}
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
                      <span
                        className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-400 cursor-help"
                        title={doc.processing_error ?? "Processing failed"}
                      >Failed</span>
                    ) : doc.is_empty ? (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">Empty</span>
                    ) : doc.classification_confidence > 0 ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_COLORS[doc.assigned_category] ?? CATEGORY_COLORS.other}`}>
                        {CATEGORY_LABELS[doc.assigned_category] ?? doc.assigned_category}
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">Pending</span>
                    )}
                  </div>
                  <div className="w-20 flex justify-end">
                    {doc.is_incomplete && (
                      <span
                        className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-400 cursor-help"
                        title={doc.incompleteness_reasons?.join(", ") ?? "Incomplete"}
                      >Incomplete</span>
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
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <Trash2 className="size-3.5" />}
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
  const visibleDocs = documents.filter((d) => !deletedIds.has(d.id))
  if (visibleDocs.length === 0)
    return <EmptyState icon={FolderTree} message="No files yet — upload to see folder structure." />

  const root = buildTree(visibleDocs)
  const topLevel = Object.values(root.children).sort((a, b) => a.name.localeCompare(b.name))
  const rootFiles = root.files

  return (
    <>
      {/* Confirm delete dialog */}
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
                <ExternalLink className="size-3.5" />Open in new tab
              </a>
            </div>
          </DialogHeader>
          <iframe src={previewDoc?.url} className="w-full border-0" style={{ height: "85vh" }} title={previewDoc?.title} />
        </DialogContent>
      </Dialog>

    <div className="rounded-xl border border-border/60 bg-background/60 overflow-hidden">
      <div className="divide-y divide-border/20">
        {topLevel.map((node) => (
          <TreeNodeRow key={node.path} node={node} depth={0} showStatus={showStatus} onPreview={canPreview ? handlePreview : undefined} loadingPreviewId={loadingPreviewId} onDelete={canDelete ? (id, name) => setConfirmDelete({ id, filename: name }) : undefined} deletingId={deletingId} />
        ))}
        {rootFiles.map((doc) => (
          <div key={doc.id} className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:bg-muted/30">
            {showStatus && doc.processing_status === "processing"
              ? <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
              : showStatus && doc.classification_confidence > 0
                ? <CheckCircle2 className="size-3 shrink-0 text-green-600" />
                : <FileIcon className="size-3 shrink-0 text-muted-foreground/40" />}
            {canPreview ? (
              <button
                type="button"
                onClick={(e) => handlePreview(doc.id, doc.filename, e.ctrlKey || e.metaKey)}
                disabled={loadingPreviewId === doc.id}
                className="group min-w-0 flex-1 flex items-center gap-1 text-left hover:text-foreground transition-colors disabled:opacity-50"
                title="Click to preview · Ctrl+click to open in new tab"
              >
                {loadingPreviewId === doc.id ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Eye className="size-3 shrink-0 opacity-0 group-hover:opacity-40 transition-opacity" />}
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
                      <span
                        className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-400 cursor-help"
                        title={doc.processing_error ?? "Processing failed"}
                      >Failed</span>
                    ) : doc.is_empty ? (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">Empty</span>
                    ) : doc.classification_confidence > 0 ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_COLORS[doc.assigned_category] ?? CATEGORY_COLORS.other}`}>
                        {CATEGORY_LABELS[doc.assigned_category] ?? doc.assigned_category}
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">Pending</span>
                    )}
                  </div>
                  <div className="w-20 flex justify-end">
                    {doc.is_incomplete && (
                      <span
                        className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-400 cursor-help"
                        title={doc.incompleteness_reasons?.join(", ") ?? "Incomplete"}
                      >Incomplete</span>
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
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <Trash2 className="size-3.5" />}
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
                <ExternalLink className="size-3.5" />
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
                  <button
                    type="button"
                    onClick={(e) => handleFileClick(e, m)}
                    disabled={loadingPreview === m.document_id}
                    className="group min-w-0 flex-1 flex items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    title="Click to preview · Ctrl+click to open in new tab"
                  >
                    {loadingPreview === m.document_id
                      ? <Loader2 className="size-3 shrink-0 animate-spin" />
                      : <Eye className="size-3 shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" />}
                    <span className="truncate">{m.filename ?? m.original_path ?? "Unknown"}</span>
                  </button>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground/40">
                      {m.file_size != null ? formatBytes(m.file_size) : ""}
                    </span>
                    {m.is_canonical ? (
                      <span className="w-16 text-right text-[11px] text-green-600">canonical</span>
                    ) : (
                      <button
                        type="button"
                        disabled={deleting === m.document_id}
                        onClick={() => setConfirmDoc({ id: m.document_id, filename: m.filename ?? m.original_path ?? "this file" })}
                        className="w-16 flex justify-end text-muted-foreground/40 hover:text-red-500 transition-colors disabled:opacity-40"
                        title="Delete duplicate"
                      >
                        {deleting === m.document_id
                          ? <Loader2 className="size-3.5 animate-spin" />
                          : <Trash2 className="size-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
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
  loading,
  dealId,
  onProcessed,
  isDocProcessing,
  countdown,
  needsRefresh,
}: {
  classifications: Classification[]
  documents: DealDocument[]
  loading: boolean
  dealId: string | null
  onProcessed: () => void
  isDocProcessing: boolean
  countdown: number
  needsRefresh: boolean
}) {
  const { getToken } = useAuth()
  const [processing, setProcessing] = React.useState(false)
  // null = show all; "unclassified" = unclassified filter; any clf.key = that category
  const [selectedFilter, setSelectedFilter] = React.useState<string | null>(null)

  const handleProcess = React.useCallback(async () => {
    if (!dealId) return
    setProcessing(true)
    try {
      const token = await getToken()
      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? ""}/api/deals/${dealId}/process`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      toast.success("Processing started", { description: "Per-file progress is visible in the file list below." })
      onProcessed()
    } catch {
      toast.error("Failed to start processing")
    } finally {
      setProcessing(false)
    }
  }, [dealId, getToken, onProcessed])

  if (loading) return <LoadingRows />
  if (classifications.length === 0)
    return (
      <EmptyState
        icon={LayoutGrid}
        message="No classification categories defined for your company — add categories before running the classification process."
      />
    )

  // Only count documents that have actually been classified (confidence > 0)
  // Docs that are empty or incomplete are treated as unclassified regardless of confidence
  const classifiedDocs = documents.filter((d) => d.classification_confidence > 0 && !d.is_empty && !d.is_incomplete)
  const unclassifiedDocs = documents.filter((d) => d.classification_confidence <= 0 || d.is_empty || d.is_incomplete)
  const unclassifiedCount = unclassifiedDocs.length

  const countByKey = classifiedDocs.reduce<Record<string, number>>((acc, d) => {
    acc[d.assigned_category] = (acc[d.assigned_category] ?? 0) + 1
    return acc
  }, {})

  const active = classifications.filter((c) => c.is_active)
  const hasUnprocessed = documents.length > 0 && unclassifiedCount > 0

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
              disabled={processing || isDocProcessing || documents.length === 0 || classifications.length === 0}
            >
              {processing || isDocProcessing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {processing ? "Starting…" : isDocProcessing ? "Processing…" : "Process"}
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
                    <Loader2 className="size-3 animate-spin text-primary" />
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
  hasCompany: boolean
  onBack: () => void
}

export function ProjectSetupScreen({ dealId, projectTitle, hasCompany, onBack }: ProjectSetupScreenProps) {
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
  // Only tick when the relevant tab is active
  const tabNeedsRefresh =
    hasDocsNeedingWork &&
    (section === "upload" || section === "file-structure")
  // Keep a stable ref to silentRefresh so the interval closure never goes stale
  const silentRefreshRef = React.useRef(dealData.silentRefresh)
  React.useEffect(() => { silentRefreshRef.current = dealData.silentRefresh }, [dealData.silentRefresh])
  React.useEffect(() => {
    if (!tabNeedsRefresh) {
      setRefreshCountdown(5)
      return
    }
    const timer = setInterval(() => {
      setRefreshCountdown((prev) => {
        if (prev <= 1) {
          silentRefreshRef.current()
          return 5
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [hasDocsNeedingWork])

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
                <ExternalLink className="size-3.5" />Open in new tab
              </a>
            </div>
          </DialogHeader>
          <iframe src={uploadPreview?.url} className="w-full border-0" style={{ height: "85vh" }} title={uploadPreview?.title} />
        </DialogContent>
      </Dialog>
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
                {/* Single-file picker — no webkitdirectory so individual files can be selected */}
                <input
                  ref={fileInputSingleRef}
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
                          <AlertTriangle className="size-3.5 shrink-0 text-red-400" />
                          <span className="min-w-0 flex-1 text-xs font-semibold text-red-600 dark:text-red-400">
                            {skippedFiles.length} skipped
                          </span>
                          <button
                            type="button"
                            onClick={() => setSkippedFiles([])}
                            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-red-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/40 transition-colors"
                          >
                            <X className="size-3" />
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
                                  <X className="size-3.5 shrink-0 text-red-300 dark:text-red-600" />
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
                              <Plus className="size-3.5" />
                              Upload More
                            </Button>
                          </div>
                          {/* AI Processing progress — shown while document_processing stage is active */}
                          {isDocProcessing && (
                            <div className="px-4 py-2.5 border-b border-border/40 bg-primary/5">
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  <Loader2 className="size-3 animate-spin text-primary" />
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
                          {/* Table header */}
                          <div className="grid grid-cols-[1.5rem_1fr_5rem_7rem_9rem_6rem_2.5rem] items-center gap-x-2 border-b border-border/40 bg-muted/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                            <span />
                            <span>File</span>
                            <span className="text-right">Size</span>
                            <span className="text-center">RAG</span>
                            <span className="text-center">Classification</span>
                            <span className="text-center">Status</span>
                            <span />
                          </div>
                          {/* File rows */}
                          <div className={docs.length > 10 ? "max-h-[320px] overflow-y-auto" : ""}>
                            <div className="divide-y divide-border/30">
                              {dealData.loading ? (
                                <div className="p-3 space-y-2">
                                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
                                </div>
                              ) : (
                                docs.filter((d) => !uploadDeletedIds.has(d.id)).map((doc) => {
                                  const classified = doc.classification_confidence > 0
                                  const ragged = doc.rag_indexed
                                  return (
                                    <div key={doc.id} className="grid grid-cols-[1.5rem_1fr_5rem_7rem_9rem_6rem_2.5rem] items-center gap-x-2 px-3 py-1.5 text-xs hover:bg-muted/20">
                                      {/* Icon */}
                                      <div className="flex items-center justify-center">
                                        {doc.processing_status === "processing"
                                          ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                                          : ragged && classified
                                            ? <CheckCircle2 className="size-3.5 shrink-0 text-green-600" />
                                            : <FileIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
                                        }
                                      </div>
                                      {/* File path — clickable preview */}
                                      <button
                                        type="button"
                                        onClick={(e) => handleUploadPreview(doc.id, doc.filename, e.ctrlKey || e.metaKey)}
                                        disabled={uploadLoadingPreviewId === doc.id}
                                        className="group min-w-0 flex items-center gap-1 text-left text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                        title="Click to preview · Ctrl+click to open in new tab"
                                      >
                                        {uploadLoadingPreviewId === doc.id
                                          ? <Loader2 className="size-3 shrink-0 animate-spin" />
                                          : <Eye className="size-3 shrink-0 opacity-0 group-hover:opacity-40 transition-opacity" />}
                                        <span className="truncate">{doc.original_path}</span>
                                      </button>
                                      {/* Size */}
                                      <span className="text-right tabular-nums text-muted-foreground/50">
                                        {formatBytes(doc.file_size)}
                                      </span>
                                      {/* RAG */}
                                      <div className="flex justify-center">
                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                          ragged
                                            ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                                            : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                                        }`}>
                                          {ragged ? "✓ Indexed" : "Pending"}
                                        </span>
                                      </div>
                                      {/* Classification */}
                                      <div className="flex justify-center">
                                        {doc.processing_status === "processing" ? (
                                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                            Analyzing…
                                          </span>
                                        ) : doc.processing_status === "failed" ? (
                                          <span
                                            className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-400 cursor-help"
                                            title={doc.processing_error ?? "Processing failed"}
                                          >
                                            Failed
                                          </span>
                                        ) : doc.is_empty ? (
                                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                                            Empty
                                          </span>
                                        ) : classified ? (
                                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_COLORS[doc.assigned_category] ?? CATEGORY_COLORS.other}`}>
                                            {CATEGORY_LABELS[doc.assigned_category] ?? doc.assigned_category}
                                          </span>
                                        ) : (
                                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                            Pending
                                          </span>
                                        )}
                                      </div>
                                      {/* Status / Incomplete */}
                                      <div className="flex justify-center">
                                        {doc.is_empty ? (
                                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                                            Empty
                                          </span>
                                        ) : doc.is_incomplete ? (
                                          <span
                                            className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/50 dark:text-red-400 cursor-help"
                                            title={doc.incompleteness_reasons?.join(", ") ?? "Incomplete"}
                                          >
                                            Incomplete
                                          </span>
                                        ) : classified && ragged ? (
                                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-950/50 dark:text-green-400">
                                            Done
                                          </span>
                                        ) : (
                                          <span className="text-[11px] text-muted-foreground/30">—</span>
                                        )}
                                      </div>
                                      {/* Delete */}
                                      <div className="flex justify-center">
                                        <button
                                          type="button"
                                          disabled={uploadDeletingId === doc.id}
                                          onClick={() => setUploadConfirmDelete({ id: doc.id, filename: doc.filename })}
                                          className="text-muted-foreground/30 hover:text-red-500 transition-colors disabled:opacity-40"
                                          title="Delete file"
                                        >
                                          {uploadDeletingId === doc.id
                                            ? <Loader2 className="size-3.5 animate-spin" />
                                            : <Trash2 className="size-3.5" />}
                                        </button>
                                      </div>
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
                        <FolderUp className="size-3.5" />
                        Browse folder
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={(e) => { e.stopPropagation(); fileInputSingleRef.current?.click() }}
                      >
                        <FileIcon className="size-3.5" />
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
                <div className="space-y-4">
                  <ClassificationPanel
                    classifications={classifications}
                    documents={dealData.documents}
                    loading={classificationsLoading}
                    dealId={dealId}
                    onProcessed={dealData.refresh}
                    isDocProcessing={
                      processingJob.status === "running" &&
                      processingJob.currentStage === "document_processing"
                    }
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
