"use client"

import * as React from "react"
import { useAuth } from "@clerk/nextjs"
import { apiFetch } from "@/lib/api-client"
import {
  Sidebar,
  SidebarContent,
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
import { GalleryVerticalEndIcon, PlusIcon } from "lucide-react"

interface Deal {
  id: string
  name: string
}

export function AppSidebar({
  onNewProject,
  onOpenDeal,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  onNewProject?: () => void
  onOpenDeal?: (id: string, name: string) => void
}) {
  const { getToken, isSignedIn } = useAuth()
  const [deals, setDeals] = React.useState<Deal[]>([])

  React.useEffect(() => {
    if (!isSignedIn) return
    apiFetch<{ deals: Deal[] }>("/api/deals", getToken).then((result) => {
      if (result) setDeals(result.deals)
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
            {deals.length === 0 ? (
              <SidebarMenuItem>
                <span className="px-2 py-1.5 text-xs text-muted-foreground">
                  No projects yet
                </span>
              </SidebarMenuItem>
            ) : (
              deals.map((deal) => (
                <SidebarMenuItem key={deal.id}>
                  <SidebarMenuButton asChild>
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
      <SidebarRail />
    </Sidebar>
  )
}

