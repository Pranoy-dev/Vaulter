"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ProjectSetupScreen } from "@/features/project-setup"
import { HeaderNav } from "@/components/header-nav"
import { useAuth } from "@clerk/nextjs"
import { apiFetch } from "@/lib/api-client"
import { useUserSync } from "@/hooks/use-user-sync"
import { toast } from "sonner"
import { ArrowLeft, CheckCircle2, FileIcon, FolderUp, HardDriveIcon, Loader2, PlusIcon, SearchIcon, Trash2 } from "lucide-react"
import { uploadFiles, type FileEntry } from "@/lib/chunked-upload"
import { Progress } from "@/components/ui/progress"

// -- Helpers ------------------------------------------------------------------

function toPascalCase(str: string) {
  return str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
}

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return "0 B"
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${(bytes / 1024).toFixed(1)} KB`
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

const CARD_ACCENTS = [
  "from-slate-50 to-blue-50 dark:from-slate-900/60 dark:to-blue-950/30",
  "from-slate-50 to-teal-50 dark:from-slate-900/60 dark:to-teal-950/30",
  "from-slate-50 to-violet-50 dark:from-slate-900/60 dark:to-violet-950/30",
  "from-slate-50 to-amber-50 dark:from-slate-900/60 dark:to-amber-950/30",
  "from-slate-50 to-rose-50 dark:from-slate-900/60 dark:to-rose-950/30",
  "from-slate-50 to-indigo-50 dark:from-slate-900/60 dark:to-indigo-950/30",
]

// -- Types --------------------------------------------------------------------

interface Deal {
  id: string
  name: string
  description?: string | null
  file_count: number
  total_size: number
  created_at: string
}

// -- NewProjectScreen ---------------------------------------------------------

function NewProjectScreen({
  onBack,
  onCreate,
}: {
  onBack: () => void
  onCreate: (dealId: string, title: string) => void
}) {
  const { getToken } = useAuth()
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [selectedFiles, setSelectedFiles] = React.useState<FileEntry[]>([])
  const [isDragging, setIsDragging] = React.useState(false)
  const [uploadPct, setUploadPct] = React.useState(0)
  const [phase, setPhase] = React.useState<"idle" | "creating" | "uploading" | "done">("idle")
  const folderInputRef = React.useRef<HTMLInputElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

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
    if (newEntries.length) setSelectedFiles(newEntries)
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const newEntries = filesToEntries(event.dataTransfer.files)
    if (newEntries.length) setSelectedFiles(newEntries)
  }

  const handleCreate = async () => {
    if (!title.trim()) return
    setNameError(null)
    setLoading(true)
    setPhase("creating")
    const token = await getToken()
    try {
      // Step 1: create project
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: title.trim(), description: description.trim() || undefined }),
      })
      const body = await res.json()
      if (res.status === 409) {
        setNameError(body.error?.message ?? "A project with this name already exists.")
        setLoading(false)
        setPhase("idle")
        return
      }
      if (!res.ok || !body.success) {
        toast.error("Failed to create project", { description: body.error?.message })
        setLoading(false)
        setPhase("idle")
        return
      }
      const result = body.data as { id: string; name: string }

      // Step 2: upload files if any were selected
      if (selectedFiles.length > 0) {
        setPhase("uploading")
        try {
          await uploadFiles(result.id, selectedFiles, getToken, (p) => {
            setUploadPct(Math.round(p.overall * 100))
          })
        } catch (err) {
          if ((err as Error).message !== "Upload cancelled") {
            toast.error("Upload failed", { description: (err as Error).message })
          }
        }
      }

      setPhase("done")
      toast.success("Project ready", { description: `\u201c${result.name}\u201d created successfully.` })
      onCreate(result.id, result.name)
    } catch {
      toast.error("Connection error", { description: "Unable to reach the server." })
      setLoading(false)
      setPhase("idle")
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        {/* Back */}
        <button
          type="button"
          onClick={onBack}
          className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>

        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-8">
        <h1 className="mb-8 text-2xl font-semibold tracking-tight">Create Project</h1>

        <div className="space-y-6">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="new-title">Project title</Label>
            <Input
              id="new-title"
              value={title}
              onChange={(e) => { setTitle(toPascalCase(e.target.value)); setNameError(null) }}
              placeholder="Enter project title"
              autoFocus
              className={nameError ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="new-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              id="new-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this project"
              className="resize-none"
              rows={3}
            />
          </div>

          {/* Upload Project Folder */}
          <div className="space-y-1.5">
            <Label>Upload Project Folder</Label>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onInputChange}
              // @ts-expect-error -- non-standard but widely supported folder picker attribute
              webkitdirectory=""
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onInputChange}
            />

            {selectedFiles.length === 0 ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => folderInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    folderInputRef.current?.click()
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-8 py-10 text-center transition-all duration-200 ${
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
                    Folder upload is supported from your device.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">
                    {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => { setSelectedFiles([]); if (folderInputRef.current) folderInputRef.current.value = ""; if (fileInputRef.current) fileInputRef.current.value = "" }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Actions / Progress */}
          <div className="pt-2">
            {phase === "idle" ? (
              <div className="flex gap-3">
                <Button onClick={handleCreate} disabled={!title.trim() || loading} className="min-w-32">
                  Create Project
                </Button>
                <Button variant="outline" onClick={onBack}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-4">
                <div className="flex items-center gap-3">
                  {phase === "done" ? (
                    <CheckCircle2 className="size-4 shrink-0 text-green-600" />
                  ) : (
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium">
                    {phase === "creating" && "Creating project\u2026"}
                    {phase === "uploading" && `Uploading files\u2026 ${uploadPct}%`}
                    {phase === "done" && "Done! Opening project\u2026"}
                  </span>
                </div>
                {phase === "uploading" && (
                  <Progress value={uploadPct} className="h-1.5" />
                )}
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

// -- ProjectCard --------------------------------------------------------------

function ProjectCard({
  deal,
  index,
  onClick,
  onDelete,
}: {
  deal: Deal
  index: number
  onClick: () => void
  onDelete: () => void
}) {
  const accent = CARD_ACCENTS[index % CARD_ACCENTS.length]

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
    >
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        {/* coloured header banner */}
        <div className={`h-14 w-full bg-gradient-to-br ${accent}`} />

        {/* name + description */}
        <div className="flex flex-col gap-1 px-4 pt-3 pb-2">
          <span className="font-semibold leading-tight text-foreground">{deal.name}</span>
          {deal.description ? (
            <span className="line-clamp-2 text-sm text-muted-foreground">{deal.description}</span>
          ) : (
            <span className="text-sm text-muted-foreground/40 italic">No description</span>
          )}
        </div>

        {/* footer stats */}
        <div className="mt-auto flex items-center justify-between border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <FileIcon className="size-3.5 shrink-0" />
            {deal.file_count ?? 0} docs
          </span>
          <span className="flex items-center gap-1.5">
            <HardDriveIcon className="size-3.5 shrink-0" />
            {formatBytes(deal.total_size ?? 0)}
          </span>
        </div>
      </button>

      {/* delete button — visible on hover */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-background/90 border border-border/80 shadow-sm text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:text-destructive hover:border-destructive/50 hover:bg-destructive/5"
        aria-label="Delete project"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

// -- ProjectsHome -------------------------------------------------------------

function ProjectsHome({
  refreshKey,
  onNewProject,
  onOpenDeal,
}: {
  refreshKey: number
  onNewProject: () => void
  onOpenDeal: (id: string, name: string) => void
}) {
  const { getToken, isSignedIn } = useAuth()
  const [deals, setDeals] = React.useState<Deal[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")

  const [deleteTarget, setDeleteTarget] = React.useState<Deal | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)

  const handleDelete = async (dealId: string, dealName: string) => {
    setIsDeleting(true)
    const result = await apiFetch(`/api/deals/${dealId}`, getToken, { method: "DELETE" })
    setIsDeleting(false)
    if (result !== null) {
      setDeals((prev) => prev.filter((d) => d.id !== dealId))
      setDeleteTarget(null)
      toast.success(`"${dealName}" deleted`)
    }
  }

  React.useEffect(() => {
    if (!isSignedIn) return
    setLoading(true)
    apiFetch<{ deals: Deal[] }>("/api/deals", getToken).then((result) => {
      if (result) setDeals(result.deals)
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, refreshKey])

  const filtered = deals.filter(
    (d) => !search || d.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="rounded-xl border border-border/60 bg-card shadow-sm p-8">
        {/* search bar + new project button */}
        <div className="flex items-center gap-3 pb-6">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              className="pl-10 h-10"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button onClick={onNewProject} className="shrink-0 h-10 px-4">
            <PlusIcon className="size-4 mr-1.5" />
            New Project
          </Button>
        </div>

        {/* project grid */}
        <div className="pb-10">
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="h-44 animate-pulse rounded-xl border border-border/60 bg-muted/40"
                />
              ))}
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  My Projects
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {filtered.length}
                </span>
              </div>

              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <p className="text-sm text-muted-foreground">
                    {search
                      ? "No projects match your search."
                      : "No projects yet. Create your first project to get started."}
                  </p>
                  {!search && (
                    <Button variant="outline" onClick={onNewProject} className="mt-4">
                      <PlusIcon className="size-4 mr-1.5" />
                      New Project
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((deal, i) => (
                    <ProjectCard
                      key={deal.id}
                      deal={deal}
                      index={i}
                      onClick={() => onOpenDeal(deal.id, deal.name)}
                      onDelete={() => setDeleteTarget(deal)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        </div>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> and all its documents will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={(e) => { e.preventDefault(); if (deleteTarget) handleDelete(deleteTarget.id, deleteTarget.name) }}
            >
              {isDeleting ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type View = "home" | "new-project" | "project"

export default function Page() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { getToken } = useAuth()

  const [setupProjectTitle, setSetupProjectTitle] = React.useState<string | null>(null)
  const [homeRefreshKey, setHomeRefreshKey] = React.useState(0)

  const selectedDealId = searchParams.get("deal")
  const view: View = selectedDealId ? "project" : searchParams.get("new") === "1" ? "new-project" : "home"

  // Restore project title when navigating directly to ?deal=<id>
  React.useEffect(() => {
    if (!selectedDealId) return
    apiFetch<{ id: string; name: string }>(`/api/deals/${selectedDealId}`, getToken).then(
      (deal) => { if (deal) setSetupProjectTitle(deal.name) },
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealId])

  const openDeal = (id: string, name: string) => {
    setSetupProjectTitle(name)
    router.push(`/dashboard?deal=${id}`)
  }

  const goHome = () => {
    setSetupProjectTitle(null)
    router.push("/dashboard")
  }

  const { hasCompany } = useUserSync()

  const handleBack = React.useCallback(() => {
    goHome()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full flex-col">
      <HeaderNav
        projectTitle={view === "project" ? setupProjectTitle : undefined}
        onBack={view === "project" ? handleBack : undefined}
      />

      {view === "project" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ProjectSetupScreen
            key={selectedDealId!}
            dealId={selectedDealId}
            projectTitle={setupProjectTitle ?? ""}
            hasCompany={hasCompany}
            onBack={handleBack}
          />
        </div>
      )}

      {view === "new-project" && (
        <NewProjectScreen
          onBack={goHome}
          onCreate={(dealId, title) => {
            setHomeRefreshKey((k) => k + 1)
            setSetupProjectTitle(title)
            router.push(`/dashboard?deal=${dealId}`)
          }}
        />
      )}

      {view === "home" && (
        <ProjectsHome
          refreshKey={homeRefreshKey}
          onNewProject={() => router.push("/dashboard?new=1")}
          onOpenDeal={openDeal}
        />
      )}
    </div>
  )
}
