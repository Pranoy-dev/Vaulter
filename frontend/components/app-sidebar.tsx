"use client"

import * as React from "react"

import { DEMO_WORKSPACE_TITLE } from "@/features/project-setup/demo-workspace/mock-data"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { GalleryVerticalEndIcon, HomeIcon } from "lucide-react"

// This is sample data.
const data = {
  navMain: [
    {
      title: "My projects",
      url: "#",
      items: [
        {
          title: "Sunset Villas",
          url: "#",
        },
        {
          title: "Riverfront Residences",
          url: "#",
        },
        {
          title: "Oakwood Heights",
          url: "#",
        },
        {
          title: "Cityview Towers",
          url: "#",
        },
        {
          title: "Maple Grove Estates",
          url: "#",
        },
      ],
    },
    {
      title: "Example",
      url: "#",
      items: [
        {
          title: DEMO_WORKSPACE_TITLE,
          url: "#",
        },
      ],
    },
  ],
}

export function AppSidebar({
  onOpenDemoWorkspace,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  onOpenDemoWorkspace?: () => void
}) {
  const { setOpen } = useSidebar()

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
                  <span className="font-medium">Vualter</span>
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
            {data.navMain.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild>
                  <a href={item.url} className="font-medium">
                    <HomeIcon className="size-4" />
                    {item.title}
                  </a>
                </SidebarMenuButton>
                {item.items?.length ? (
                  <SidebarMenuSub>
                    {item.items.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        {subItem.title === DEMO_WORKSPACE_TITLE && onOpenDemoWorkspace ? (
                          <SidebarMenuSubButton asChild>
                            <button
                              type="button"
                              className="w-full cursor-pointer"
                              onClick={() => {
                                setOpen(false)
                                onOpenDemoWorkspace()
                              }}
                            >
                              <span className="block min-w-0 flex-1 text-left">
                                {subItem.title}
                              </span>
                            </button>
                          </SidebarMenuSubButton>
                        ) : (
                          <SidebarMenuSubButton asChild>
                            <a href={subItem.url}>
                              <span className="block min-w-0 flex-1">{subItem.title}</span>
                            </a>
                          </SidebarMenuSubButton>
                        )}
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
