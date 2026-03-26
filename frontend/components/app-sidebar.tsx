"use client"

import * as React from "react"
import { useAuth, useUser, UserButton } from "@clerk/nextjs"
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
  SidebarRail,
} from "@/components/ui/sidebar"
import { GalleryVerticalEndIcon, Loader2, PlusIcon } from "lucide-react"

interface Deal {
  id: string
  name: string
}

export function AppSidebar({
  onNewProject,
  onOpenDeal,
  selectedDealId,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  onNewProject?: () => void
  onOpenDeal?: (id: string, name: string) => void
  selectedDealId?: string | null
}) {
  const { getToken, isSignedIn } = useAuth()
  const { user } = useUser()
  const [deals, setDeals] = React.useState<Deal[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!isSignedIn) return
    setLoading(true)
    apiFetch<{ deals: Deal[] }>("/api/deals", getToken).then((result) => {
      if (result) setDeals(result.deals)
      setLoading(false)
    })
  }, [isSignedIn, getToken])

  return (
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
                  <span className="font-medium">DataRoom AI</span>
                  <span className="">v1.0.0</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>My Projects</SidebarGroupLabel>
          {onNewProject && (
            <SidebarGroupAction title="New project" onClick={onNewProject}>
              <PlusIcon className="size-4" />
              <span className="sr-only">New project</span>
            </SidebarGroupAction>
          )}
          <SidebarMenu>
            {loading ? (
              <SidebarMenuItem>
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading…</span>
                </div>
              </SidebarMenuItem>
            ) : deals.length === 0 ? (
              <SidebarMenuItem>
                <span className="px-2 py-1.5 text-xs text-muted-foreground">
                  No projects yet
                </span>
              </SidebarMenuItem>
            ) : (
              deals.map((deal) => (
                <SidebarMenuItem key={deal.id}>
                  <SidebarMenuButton
                    isActive={selectedDealId === deal.id}
                    asChild
                  >
                    {onOpenDeal ? (
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => onOpenDeal(deal.id, deal.name)}
                      >
                        {deal.name}
                      </button>
                    ) : (
                      <a href={`#deal-${deal.id}`}>{deal.name}</a>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-sidebar-accent transition-colors">
          <UserButton afterSignOutUrl="/" />
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
      <SidebarRail />
    </Sidebar>
  )
}

