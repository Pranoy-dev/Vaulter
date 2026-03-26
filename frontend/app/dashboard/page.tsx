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

  const handleCreate = async () => {
    if (!title.trim()) return
    setLoading(true)
    const result = await apiFetch<{ id: string; name: string }>("/api/deals", getToken, {
      method: "POST",
      body: JSON.stringify({ name: title.trim(), description: description.trim() || undefined }),
    })
    setLoading(false)
    if (!result) return // apiFetch already showed an error toast
    toast.success("Project created", { description: `"${result.name}" is ready.` })
    onOpenChange(false)
    onCreate(result.id, result.name, description.trim())
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setTitle("")
      setDescription("")
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
              onChange={(e) => setTitle(toPascalCase(e.target.value))}
              placeholder="Enter project title"
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim() && !loading) handleCreate()
              }}
              autoFocus
            />
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

  // Derive current deal ID directly from URL
  const selectedDealId = searchParams.get("deal")

  // On first load: if URL has ?deal=<id>, fetch the deal name to restore the title
  React.useEffect(() => {
    if (!selectedDealId) return
    apiFetch<{ id: string; name: string }>(`/api/deals/${selectedDealId}`, getToken).then(
      (deal) => {
        if (deal) setSetupProjectTitle(deal.name)
      },
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealId])

  const openDeal = (id: string, name: string) => {
    setSetupProjectTitle(name)
    router.push(`/dashboard?deal=${id}`)
  }

  const goHome = () => {
    router.push("/dashboard")
  }

  // Sync user to backend DB on first sign-in
  useUserSync()

  return (
    <SidebarProvider className="h-full">
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
      <SidebarInset className="min-h-0">
        {selectedDealId ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ProjectSetupScreen
              dealId={selectedDealId}
              projectTitle={setupProjectTitle}
              onBack={() => {
                goHome()
                setSidebarRefreshKey((k) => k + 1)
              }}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome to DataRoom AI</h1>
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
          setSidebarRefreshKey((k) => k + 1)
          openDeal(dealId, title)
        }}
      />
    </SidebarProvider>
  )
}
