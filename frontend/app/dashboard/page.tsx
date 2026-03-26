"use client"

import * as React from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
import { ProjectSetupScreen } from "@/features/project-setup"
import { DEMO_WORKSPACE_TITLE } from "@/features/project-setup/demo-workspace/mock-data"
import { CheckCircle2, FolderUp } from "lucide-react"

type ScreenState = "none" | "create" | "test"

function ProjectCreationView({
  nextScreen,
  setNextScreen,
  setupProjectTitle,
  setSetupProjectTitle,
}: {
  nextScreen: ScreenState
  setNextScreen: React.Dispatch<React.SetStateAction<ScreenState>>
  setupProjectTitle: string
  setSetupProjectTitle: React.Dispatch<React.SetStateAction<string>>
}) {
  const { setOpen } = useSidebar()
  const [title, setTitle] = React.useState("")
  const [isDragging, setIsDragging] = React.useState(false)
  const [selectedFolderName, setSelectedFolderName] = React.useState("")
  const [selectedCount, setSelectedCount] = React.useState(0)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const isTitleValid = title.trim().length > 0

  React.useEffect(() => {
    const input = fileInputRef.current
    if (!input) return

    input.setAttribute("webkitdirectory", "")
    input.setAttribute("directory", "")
  }, [])

  const updateSelection = (files: FileList | null) => {
    if (!files || files.length === 0) {
      setSelectedFolderName("")
      setSelectedCount(0)
      return
    }

    const firstPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath
    const folderName = firstPath?.split("/")[0] || "Selected folder"
    setSelectedFolderName(folderName)
    setSelectedCount(files.length)
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    updateSelection(event.dataTransfer.files)
  }

  const onCreateProject = () => {
    // Placeholder action until API wiring is added.
    console.log("Create Project clicked", {
      title: title.trim(),
      folder: selectedFolderName,
      files: selectedCount,
    })
    setSetupProjectTitle(title.trim() || "Untitled project")
    setOpen(false)
    setNextScreen("create")
  }

  const onTestButtonClick = () => {
    // Placeholder action for the test button.
    console.log("Test button clicked")
    setOpen(false)
    setNextScreen("test")
  }

  if (nextScreen === "create") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ProjectSetupScreen
          projectTitle={setupProjectTitle}
          onBack={() => {
            setNextScreen("none")
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
            <Button variant="outline" onClick={() => setNextScreen("none")}>
              Back
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-muted/20 p-6 md:p-8">
      <Card className="mx-auto w-full max-w-4xl rounded-2xl border border-border/80 bg-card py-0 shadow-2xl shadow-black/20 ring-1 ring-black/10 backdrop-blur-md">
        <CardHeader className="border-b border-border/60 px-8 py-7">
          <CardTitle className="text-2xl font-semibold tracking-tight">Create Project</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8 px-8 py-8">
          <div className="space-y-3">
            <div className="relative">
              <Input
                id="project-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Enter project title"
                className="h-11 rounded-xl border-border/80 pr-10 text-[15px] shadow-none"
              />
              {isTitleValid ? (
                <CheckCircle2
                  className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-green-600"
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium text-foreground/90">Upload Project Folder</Label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => updateSelection(event.target.files)}
            />
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
              className={`flex min-h-64 cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-10 text-center transition-all duration-200 ${
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
            <p className="text-xs text-muted-foreground/90">
              {selectedCount > 0
                ? `${selectedFolderName} selected (${selectedCount} files)`
                : "No folder selected yet."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              onClick={onCreateProject}
              disabled={!isTitleValid}
              className="h-10 rounded-lg px-5"
            >
              Create Project
            </Button>
            <Button
              variant="outline"
              onClick={onTestButtonClick}
              className="h-10 rounded-lg border-border/80 px-5"
            >
              Test Button
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function Page() {
  const [nextScreen, setNextScreen] = React.useState<ScreenState>("none")
  const [setupProjectTitle, setSetupProjectTitle] = React.useState("Untitled project")

  return (
    <SidebarProvider>
      <AppSidebar
        onOpenDemoWorkspace={() => {
          setSetupProjectTitle(DEMO_WORKSPACE_TITLE)
          setNextScreen("create")
        }}
      />
      <SidebarInset className="min-h-0">
        <ProjectCreationView
          nextScreen={nextScreen}
          setNextScreen={setNextScreen}
          setupProjectTitle={setupProjectTitle}
          setSetupProjectTitle={setSetupProjectTitle}
        />
      </SidebarInset>
    </SidebarProvider>
  )
}
