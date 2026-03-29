"use client"

import { ArrowLeft } from "lucide-react"
import { UserButton } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"

export function HeaderNav({
  projectTitle,
  onBack,
}: {
  projectTitle?: string
  onBack?: () => void
}) {
  return (
    <header className="relative flex h-11 shrink-0 items-center border-b border-border/60 bg-background/80 backdrop-blur-sm px-3">
      {/* Left: back button or brand */}
      <div className="flex items-center gap-2 z-10">
        {projectTitle && onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
            Projects
          </Button>
        ) : (
          <span className="px-2 text-sm font-semibold tracking-tight"><span className="bg-gradient-to-r from-primary to-violet-400 bg-clip-text text-transparent">DataRoom</span> AI</span>
        )}
      </div>

      {/* Center: project title (absolute so it stays centered) */}
      {projectTitle && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="max-w-xs truncate text-sm font-semibold tracking-tight">
            {projectTitle}
          </span>
        </div>
      )}

      {/* Right: theme toggle + user avatar */}
      <div className="ml-auto flex items-center gap-2 z-10">
        <ThemeToggle />
        <UserButton afterSignOutUrl="/" />
      </div>
    </header>
  )
}
