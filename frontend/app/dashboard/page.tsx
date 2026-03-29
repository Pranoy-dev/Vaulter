"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { ProjectSetupScreen } from "@/features/project-setup"
import { HeaderNav } from "@/components/header-nav"
import { useAuth } from "@clerk/nextjs"
import { apiFetch } from "@/lib/api-client"
import { useUserSync } from "@/hooks/use-user-sync"
import { toast } from "sonner"

function toPascalCase(str: string) {
  return str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
}

function NewProjectDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (dealId: string, title: string, description: string) => void
}) {
  const { getToken } = useAuth()
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [nameError, setNameError] = React.useState<string | null>(null)

  const handleCreate = async () => {
    if (!title.trim()) return
    setNameError(null)
    setLoading(true)

    // Use raw fetch so we can intercept 409 and show an inline error
    const token = await getToken()
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: title.trim(), description: description.trim() || undefined }),
      })
      const body = await res.json()
      if (res.status === 409) {
        setNameError(body.error?.message ?? "A project with this name already exists.")
        setLoading(false)
        return
      }
      if (!res.ok || !body.success) {
        toast.error("Failed to create project", { description: body.error?.message })
        setLoading(false)
        return
      }
      const result = body.data as { id: string; name: string }
      toast.success("Project created", { description: `"${result.name}" is ready.` })
      onOpenChange(false)
      onCreate(result.id, result.name, description.trim())
    } catch {
      toast.error("Connection error", { description: "Unable to reach the server." })
    }
    setLoading(false)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setTitle("")
      setDescription("")
      setNameError(null)
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-project-title">Title</Label>
            <Input
              id="new-project-title"
              value={title}
              onChange={(e) => { setTitle(toPascalCase(e.target.value)); setNameError(null) }}
              placeholder="Enter project title"
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim() && !loading) handleCreate()
              }}
              autoFocus
              className={nameError ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {nameError && (
              <p className="text-xs text-destructive">{nameError}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-project-description">Description</Label>
            <Textarea
              id="new-project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description (optional)"
              className="resize-none"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={loading}>Cancel</Button>
          </DialogClose>
          <Button onClick={handleCreate} disabled={!title.trim() || loading}>
            {loading ? "Creating…" : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function Page() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { getToken } = useAuth()

  const [setupProjectTitle, setSetupProjectTitle] = React.useState("Untitled project")
  const [sidebarRefreshKey, setSidebarRefreshKey] = React.useState(0)
  const [newProjectDialogOpen, setNewProjectDialogOpen] = React.useState(false)
  // Track whether the current project was just created (skip loading spinner for new empty projects)
  const [isNewProject, setIsNewProject] = React.useState(false)
  // Track whether the selected project already has files (determines if full-page loader is shown).
  // Defaults to true so URL-based loads (e.g. page refresh) always show the full loader.
  const [selectedDealHasFiles, setSelectedDealHasFiles] = React.useState(true)

  // Derive current deal ID directly from URL
  const selectedDealId = searchParams.get("deal")

  // On first load: if URL has ?deal=<id>, fetch the deal name and file_count to restore state
  React.useEffect(() => {
    if (!selectedDealId) return
    apiFetch<{ id: string; name: string; file_count: number }>(`/api/deals/${selectedDealId}`, getToken).then(
      (deal) => {
        if (deal) {
          setSetupProjectTitle(deal.name)
          setSelectedDealHasFiles((deal.file_count ?? 0) > 0)
        }
      },
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealId])

  // When navigating to a project from the sidebar/list, clear the new-project flag
  const openDeal = (id: string, name: string, hasFiles = false) => {
    setIsNewProject(false)
    setSelectedDealHasFiles(hasFiles)
    setSetupProjectTitle(name)
    router.push(`/dashboard?deal=${id}`)
  }

  const goHome = () => {
    router.push("/dashboard")
  }

  // Sync user to backend DB on first sign-in
  const { hasCompany } = useUserSync()

  const handleBack = React.useCallback(() => {
    goHome()
    setSidebarRefreshKey((k) => k + 1)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <HeaderNav
        projectTitle={selectedDealId ? setupProjectTitle : undefined}
        onBack={selectedDealId ? handleBack : undefined}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SidebarProvider className="h-full">
          {!selectedDealId && (
            <AppSidebar
              key={sidebarRefreshKey}
              onHome={goHome}
              onNewProject={() => setNewProjectDialogOpen(true)}
              selectedDealId={selectedDealId}
              onOpenDeal={openDeal}
              onDealDeleted={(id) => {
                if (selectedDealId === id) goHome()
              }}
            />
          )}
          <SidebarInset className="min-h-0">
            {selectedDealId ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <ProjectSetupScreen
                  key={selectedDealId}
                  dealId={selectedDealId}
                  projectTitle={setupProjectTitle}
                  hasCompany={hasCompany}
                  isNewProject={isNewProject}
                  hasFiles={selectedDealHasFiles}
                  onBack={handleBack}
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">Welcome to <span className="bg-gradient-to-r from-primary to-violet-400 bg-clip-text text-transparent">DataRoom</span> AI</h1>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Your projects will appear in the sidebar. Click the&nbsp;
                  <span className="font-medium text-foreground">+</span>&nbsp;button to create your first project.
                </p>
              </div>
            )}
          </SidebarInset>
          <NewProjectDialog
            open={newProjectDialogOpen}
            onOpenChange={setNewProjectDialogOpen}
            onCreate={(dealId, title) => {
              setIsNewProject(true)
              setSidebarRefreshKey((k) => k + 1)
              openDeal(dealId, title)
            }}
          />
        </SidebarProvider>
      </div>
    </div>
  )
}
