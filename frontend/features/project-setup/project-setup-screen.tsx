"use client"

import * as React from "react"
import { ProjectSetupAssistant } from "@/features/project-setup/project-setup-assistant"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DemoAgentProcessingLog } from "@/features/project-setup/demo-workspace/demo-agent-processing-log"
import { DEMO_WORKSPACE_TITLE } from "@/features/project-setup/demo-workspace/mock-data"
import {
  DemoAiInsightsPanel,
  DemoDuplicatesPanel,
  DemoFileStructurePanel,
  DemoLeaseChainsPanel,
} from "@/features/project-setup/demo-workspace/demo-workspace-panels"
import { ArrowLeft, Copy, FilePenLine, FolderTree, FolderUp, GripVertical, PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react"

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

export type ProjectSetupScreenProps = {
  projectTitle: string
  onBack: () => void
}

export function ProjectSetupScreen({ projectTitle, onBack }: ProjectSetupScreenProps) {
  const [section, setSection] = React.useState<SetupSection>("upload")
  const [chatOpen, setChatOpen] = React.useState(true)
  const [chatWidth, setChatWidth] = React.useState(320)
  const isDemoWorkspace = projectTitle === DEMO_WORKSPACE_TITLE

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
  const [selectedFolderName, setSelectedFolderName] = React.useState("")
  const [selectedCount, setSelectedCount] = React.useState(0)

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
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg px-0.5 pt-1 pb-1 md:px-1">
            {section === "upload" ? (
              <div className="space-y-3">
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
            ) : null}
            {section === "ai-insights" ? (
              isDemoWorkspace ? (
                <DemoAiInsightsPanel />
              ) : (
                <div className="space-y-1.5">
                  <h3 className="text-sm font-medium">AI Insights</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Summaries, risks, and suggested next steps from your project documents will
                    appear here.
                  </p>
                </div>
              )
            ) : null}
            {section === "file-structure" ? (
              isDemoWorkspace ? (
                <DemoFileStructurePanel />
              ) : (
                <div className="space-y-1.5">
                  <h3 className="text-sm font-medium">File Structure</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Explore and validate the folder layout for this real-estate project. Detailed
                    tree and checks will appear here.
                  </p>
                </div>
              )
            ) : null}
            {section === "duplication" ? (
              isDemoWorkspace ? (
                <DemoDuplicatesPanel />
              ) : (
                <div className="space-y-1.5">
                  <h3 className="text-sm font-medium">Duplication</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Review detected duplicate documents or clauses across uploads. Results will
                    surface here.
                  </p>
                </div>
              )
            ) : null}
            {section === "lease-amendment" ? (
              isDemoWorkspace ? (
                <DemoLeaseChainsPanel />
              ) : (
                <div className="space-y-1.5">
                  <h3 className="text-sm font-medium">Lease Amendment</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Track amendment versions, redlines, and key lease changes for this project.
                  </p>
                </div>
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
