"use client"

import * as React from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  useSidebar,
} from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { ProjectSetupScreen } from "@/features/project-setup"
import { useAuth } from "@clerk/nextjs"
import { apiFetch } from "@/lib/api-client"
import { useUserSync } from "@/hooks/use-user-sync"
import { toast } from "sonner"

type ScreenState = "welcome" | "create" | "test"

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
  onCreate: (title: string, description: string) => void
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
    onCreate(result.name, description.trim())
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

function ProjectContentView({
  nextScreen,
  setNextScreen,
  setupProjectTitle,
}: {
  nextScreen: ScreenState
  setNextScreen: (s: ScreenState) => void
  setupProjectTitle: string
}) {
  const { setOpen } = useSidebar()

  if (nextScreen === "welcome") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to DataRoom AI</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your projects will appear in the sidebar. Click the&nbsp;
          <span className="font-medium text-foreground">+</span>&nbsp;button to create your first project.
        </p>
      </div>
    )
  }

  if (nextScreen === "create") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ProjectSetupScreen
          projectTitle={setupProjectTitle}
          onBack={() => {
            setNextScreen("welcome")
            setOpen(true)
          }}
        />
      </div>
    )
  }

  if (nextScreen === "test") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-muted/20 p-6 md:p-8">
        <Card className="mx-auto w-full max-w-4xl rounded-2xl border border-border/80 bg-card py-0 shadow-2xl shadow-black/20 ring-1 ring-black/10 backdrop-blur-md">
          <CardHeader className="border-b border-border/60 px-8 py-7">
            <CardTitle className="text-2xl font-semibold tracking-tight">Test Screen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 px-8 py-8">
            <p className="text-sm text-muted-foreground">
              You are now on the next screen from the test button.
            </p>
            <Button variant="outline" onClick={() => setNextScreen("welcome")}>
              Back
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return null
}

export default function Page() {
  const [nextScreen, setNextScreen] = React.useState<ScreenState>("welcome")
  const [setupProjectTitle, setSetupProjectTitle] = React.useState("Untitled project")
  const [selectedDealId, setSelectedDealId] = React.useState<string | null>(null)
  const [sidebarRefreshKey, setSidebarRefreshKey] = React.useState(0)
  const [newProjectDialogOpen, setNewProjectDialogOpen] = React.useState(false)

  // Sync user to backend DB on first sign-in
  useUserSync()

  return (
    <SidebarProvider className="h-full">
      <AppSidebar
        key={sidebarRefreshKey}
        onHome={() => {
          setNextScreen("welcome")
          setSelectedDealId(null)
        }}
        onNewProject={() => setNewProjectDialogOpen(true)}
        selectedDealId={selectedDealId}
        onOpenDeal={(id, name) => {
          setSelectedDealId(id)
          setSetupProjectTitle(name)
          setNextScreen("create")
        }}
        onDealDeleted={(id) => {
          if (selectedDealId === id) {
            setNextScreen("welcome")
            setSelectedDealId(null)
          }
        }}
      />
      <SidebarInset className="min-h-0">
        <ProjectContentView
          nextScreen={nextScreen}
          setNextScreen={(s) => {
            setNextScreen(s)
            // Refresh sidebar deal list when returning to welcome screen
            if (s === "welcome") {
              setSidebarRefreshKey((k) => k + 1)
              setSelectedDealId(null)
            }
          }}
          setupProjectTitle={setupProjectTitle}
        />
      </SidebarInset>
      <NewProjectDialog
        open={newProjectDialogOpen}
        onOpenChange={setNewProjectDialogOpen}
        onCreate={(title) => {
          setSetupProjectTitle(title)
          setNextScreen("create")
          setSidebarRefreshKey((k) => k + 1)
        }}
      />
    </SidebarProvider>
  )
}
