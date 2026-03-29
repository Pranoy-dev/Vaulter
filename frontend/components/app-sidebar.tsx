"use client"

import * as React from "react"
import { useAuth, useUser } from "@clerk/nextjs"
import { apiFetch } from "@/lib/api-client"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { GalleryVerticalEndIcon, HomeIcon, Loader2, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

interface Deal {
  id: string
  name: string
  file_count: number
}

function DeleteProjectDialog({
  deal,
  onClose,
  onDeleted,
}: {
  deal: Deal | null
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const { getToken } = useAuth()
  const [loading, setLoading] = React.useState(false)

  const handleDelete = async () => {
    if (!deal) return
    setLoading(true)
    const result = await apiFetch(`/api/deals/${deal.id}`, getToken, { method: "DELETE" })
    setLoading(false)
    if (result === null) return // apiFetch showed error toast
    toast.success("Project deleted", { description: `"${deal.name}" has been removed.` })
    onDeleted(deal.id)
    onClose()
  }

  return (
    <Dialog open={!!deal} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete Project</DialogTitle>
          <DialogDescription>
            This will permanently delete <span className="font-medium text-foreground">"{deal?.name}"</span> and all its uploaded files. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={loading}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {loading ? <><Loader2 className="size-4 animate-spin" /> Deleting…</> : "Delete Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AppSidebar({
  onNewProject,
  onOpenDeal,
  selectedDealId,
  onDealDeleted,
  onHome,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  onNewProject?: () => void
  onOpenDeal?: (id: string, name: string, hasFiles: boolean) => void
  selectedDealId?: string | null
  onDealDeleted?: (id: string) => void
  onHome?: () => void
}) {
  const { getToken, isSignedIn } = useAuth()
  const { user } = useUser()
  const [deals, setDeals] = React.useState<Deal[]>([])
  const [loading, setLoading] = React.useState(true)
  const [pendingDelete, setPendingDelete] = React.useState<Deal | null>(null)

  React.useEffect(() => {
    if (!isSignedIn) return
    setLoading(true)
    apiFetch<{ deals: Deal[] }>("/api/deals", getToken).then((result) => {
      if (result) setDeals(result.deals)
      setLoading(false)
    })
  }, [isSignedIn, getToken])

  const handleDeleted = (id: string) => {
    setDeals((prev) => prev.filter((d) => d.id !== id))
    onDealDeleted?.(id)
  }

  return (
    <>
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="#">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <GalleryVerticalEndIcon className="size-4" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-medium"><span className="bg-gradient-to-r from-primary to-violet-400 bg-clip-text text-transparent">DataRoom</span> AI</span>
                  <span className="">v1.0.0</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onHome}>
                <HomeIcon className="size-4 shrink-0" />
                Home
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sm font-semibold text-sidebar-foreground">My Projects</SidebarGroupLabel>
          {onNewProject && (
            <SidebarGroupAction title="New project" onClick={onNewProject}>
              <PlusIcon className="size-4" />
              <span className="sr-only">New project</span>
            </SidebarGroupAction>
          )}
          <SidebarMenu>
            {loading ? (
              <>
                {[1, 2, 3].map((i) => (
                  <SidebarMenuItem key={i}>
                    <div className="flex items-center gap-2 px-2 py-2">
                      <div className="h-2.5 w-2/3 animate-pulse rounded bg-muted-foreground/15" />
                    </div>
                  </SidebarMenuItem>
                ))}
              </>
            ) : deals.length === 0 ? (
              <SidebarMenuItem>
                <span className="px-2 py-1.5 text-xs text-muted-foreground">
                  No projects yet
                </span>
              </SidebarMenuItem>
            ) : (
              deals.map((deal) => (
                <SidebarMenuItem key={deal.id} className="group/deal-item">
                  <SidebarMenuButton
                    isActive={selectedDealId === deal.id}
                    asChild
                  >
                    {onOpenDeal ? (
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => onOpenDeal(deal.id, deal.name, (deal.file_count ?? 0) > 0)}
                      >
                        {deal.name}
                      </button>
                    ) : (
                      <a href={`#deal-${deal.id}`}>{deal.name}</a>
                    )}
                  </SidebarMenuButton>
                  <button
                    type="button"
                    title="Delete project"
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(deal) }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity group-hover/deal-item:opacity-100 hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                  >
                    <Trash2Icon className="size-4" />
                  </button>
                </SidebarMenuItem>
              ))
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium leading-tight">
              {user?.fullName ?? user?.username ?? ""}
            </span>
            <span className="truncate text-[11px] text-muted-foreground leading-tight">
              {user?.primaryEmailAddress?.emailAddress ?? ""}
            </span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
    <DeleteProjectDialog
      deal={pendingDelete}
      onClose={() => setPendingDelete(null)}
      onDeleted={handleDeleted}
    />
    </>
  )
}

