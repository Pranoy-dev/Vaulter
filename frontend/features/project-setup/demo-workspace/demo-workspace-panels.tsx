"use client"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia } from "@/components/ui/item"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import {
  AlertCircle,
  ChevronRight,
  Copy,
  FolderSearch,
  GitBranch,
  Search,
} from "lucide-react"
import * as React from "react"
import {
  demoAiInsightsDashboard,
  demoDuplicateGroupsView,
  demoFileStructureCategories,
  demoFileStructureSummary,
  demoLeaseChainCards,
  type DemoLeaseDocRow,
  type DemoLeaseTimelineKind,
  type DemoFileCategoryAccent,
  type DemoFileStructureFilterId,
  type DemoFileStructureRow,
  type DemoInsightMetricTone,
  type DemoLeaseExpiryBarTone,
  type DemoMissingDocTone,
  type DemoTaxonomyCategoryId,
} from "./mock-data"

const insightCream = "bg-[#FDFBF7]"
const insightCreamCard = "bg-[#F5F0E8]/90"

/** File structure categories + Duplication groups: identical Card, trigger, and content chrome. */
const demoWorkspaceExpandableCardClass =
  "min-w-0 w-full max-w-full gap-0 overflow-hidden border border-zinc-200/70 bg-white/95 py-0 shadow-sm ring-0 data-[size=sm]:gap-0 data-[size=sm]:py-0"

const demoWorkspaceCollapsibleTriggerClass =
  "box-border flex w-full min-w-0 max-w-full items-center gap-2.5 rounded-t-xl px-3 py-2.5 text-left transition-colors hover:bg-zinc-50/90 group-data-[state=closed]/fs:rounded-b-xl group-data-[state=closed]/dup:rounded-b-xl group-data-[state=closed]/lease:rounded-b-xl focus-visible:rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/10 group-data-[state=closed]/fs:focus-visible:rounded-b-xl group-data-[state=closed]/dup:focus-visible:rounded-b-xl group-data-[state=closed]/lease:focus-visible:rounded-b-xl"

const demoWorkspaceCollapsibleRootClass = "min-w-0 w-full max-w-full"

const demoWorkspaceCollapsibleContentClass =
  "rounded-b-xl border-t border-zinc-100 bg-white/95 px-2 py-3 sm:px-3"

const ink = "text-zinc-900"
const inkMuted = "text-zinc-500"
const scoreRed = "text-[#C62828]"

function metricValueClass(tone: DemoInsightMetricTone) {
  if (tone === "danger") return "text-[#B71C1C]"
  if (tone === "warning") return "text-amber-800"
  return ink
}

function missingDotClass(tone: DemoMissingDocTone) {
  void tone
  return "bg-[#C62828]"
}

function barToneClass(tone: DemoLeaseExpiryBarTone) {
  if (tone === "high") return "bg-[#C62828]"
  if (tone === "mid") return "bg-rose-300"
  return "bg-[#EDDED6]"
}

export function DemoAiInsightsPanel() {
  const d = demoAiInsightsDashboard
  const maxBarPx = 104
  const riskProgress = (d.dealRisk.score / d.dealRisk.max) * 100

  return (
    <Card
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-0 overflow-hidden border-zinc-200/90 py-0 shadow-sm",
        insightCream
      )}
    >
      <ScrollArea className="min-h-0 flex-1 pr-1">
        <CardContent className="flex flex-col gap-4 px-4 py-4 md:gap-5 md:px-5 md:py-5">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
            {d.metrics.map((m) => (
              <Card
                key={m.id}
                size="sm"
                className={cn(
                  "gap-0 border-zinc-200/50 py-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
                  insightCreamCard
                )}
              >
                <CardContent className="px-3 py-2.5 md:py-3">
                  <p
                    className={cn(
                      "text-xl font-semibold tabular-nums md:text-2xl",
                      metricValueClass(m.tone)
                    )}
                  >
                    {m.value}
                  </p>
                  <p className="mt-1 text-[11px] font-medium leading-snug text-zinc-600 md:text-xs">
                    {m.label}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card size="sm" className="gap-0 border-zinc-200/60 bg-white/80 py-0 shadow-sm">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 border-0 px-4 pb-2 pt-3.5 md:px-5 md:pt-4">
              <CardTitle className="text-[10px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
                Deal risk score
              </CardTitle>
              <CardAction>
                <Badge
                  variant="destructive"
                  className="rounded-full border-rose-200/80 bg-rose-100 px-3 py-1 text-[11px] font-medium text-[#B71C1C] hover:bg-rose-100"
                >
                  {d.dealRisk.badge}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 md:space-y-4 md:px-5 md:pb-5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={cn(
                    "text-4xl font-semibold tabular-nums md:text-5xl",
                    scoreRed
                  )}
                >
                  {d.dealRisk.score}
                </span>
                <span className={cn("text-sm tabular-nums", inkMuted)}> / {d.dealRisk.max}</span>
              </div>
              <Progress
                value={riskProgress}
                className="h-3 bg-[#F0E8E0] [&_[data-slot=progress-indicator]]:bg-[#C62828]"
              />
              <div className="flex flex-wrap gap-1.5 md:gap-2">
                {d.dealRisk.deductions.map((x) => (
                  <Badge
                    key={x.label}
                    variant="outline"
                    className="rounded-md border-rose-100 bg-[#FFF5F5] px-2.5 py-1 text-[11px] font-medium text-[#B71C1C] hover:bg-[#FFF5F5]"
                  >
                    -{x.points}pts {x.label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
            <Card size="sm" className="gap-0 border-zinc-200/60 bg-white/80 py-0 shadow-sm">
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 border-0 px-4 pb-0 pt-3.5 md:px-5 md:pt-4">
                <CardTitle className="text-[10px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
                  What&apos;s missing
                </CardTitle>
                <CardAction>
                  <Badge
                    variant="secondary"
                    className="rounded-md border-amber-100/80 bg-amber-100/90 px-2 py-0.5 text-[11px] font-medium text-amber-950 hover:bg-amber-100/90"
                  >
                    {d.whatsMissing.badge}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3 px-4 pb-4 md:space-y-4 md:px-5 md:pb-5">
                <Alert className="border-zinc-200/60 bg-zinc-50/80 py-2.5 text-zinc-800">
                  <AlertDescription className="text-xs leading-relaxed text-zinc-600">
                    {d.whatsMissing.description}
                  </AlertDescription>
                </Alert>
                <ItemGroup className="gap-1.5 md:gap-2">
                  {d.whatsMissing.items.map((item) => (
                    <Item
                      key={item.label}
                      size="xs"
                      variant="default"
                      className="border-0 bg-transparent px-0 py-1 shadow-none hover:bg-transparent"
                    >
                      <ItemMedia>
                        <span
                          className={cn(
                            "mt-0.5 size-2 shrink-0 rounded-full",
                            missingDotClass(item.tone)
                          )}
                          aria-hidden
                        />
                      </ItemMedia>
                      <ItemContent className="min-w-0 gap-0">
                        <p
                          className={cn(
                            "text-sm leading-snug",
                            item.tone === "found" ? "text-zinc-700" : ink
                          )}
                        >
                          {item.label}
                        </p>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              </CardContent>
            </Card>

            <Card size="sm" className="gap-0 border-zinc-200/60 bg-white/80 py-0 shadow-sm">
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 border-0 px-4 pb-0 pt-3.5 md:px-5 md:pt-4">
                <CardTitle className="text-[10px] font-semibold tracking-[0.12em] text-zinc-500 uppercase">
                  Lease expiry concentration
                </CardTitle>
                <CardAction>
                  <Badge
                    variant="secondary"
                    className="rounded-md border-amber-100/80 bg-amber-100/90 px-2 py-0.5 text-[11px] font-medium text-amber-950 hover:bg-amber-100/90"
                  >
                    {d.leaseExpiry.badge}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3 px-4 pb-4 md:space-y-4 md:px-5 md:pb-5">
                <Alert className="border-amber-200/70 bg-amber-50/70 py-2.5 text-amber-950">
                  <AlertCircle
                    className="size-4 shrink-0 text-amber-700"
                    aria-hidden
                  />
                  <AlertDescription className="text-xs leading-relaxed text-zinc-700">
                    {d.leaseExpiry.description}
                  </AlertDescription>
                </Alert>
                <div className="flex h-36 min-h-0 w-full items-stretch gap-1.5 sm:gap-2">
                  {d.leaseExpiry.bars.map((bar) => (
                    <div
                      key={bar.id}
                      className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5 sm:gap-2"
                    >
                      <div className="flex w-full max-w-10 flex-1 flex-col justify-end">
                        <div
                          className={cn("w-full min-h-1 rounded-t", barToneClass(bar.tone))}
                          style={{ height: `${(maxBarPx / 100) * bar.heightPct}px` }}
                        />
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] font-medium tabular-nums text-zinc-600">
                          {bar.quarter}
                        </div>
                        <div className="text-[9px] tabular-nums text-zinc-400">{bar.year}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </ScrollArea>
    </Card>
  )
}

function categoryAccentDotClass(accent: DemoFileCategoryAccent) {
  const map: Record<DemoFileCategoryAccent, string> = {
    blue: "bg-blue-600",
    green: "bg-emerald-600",
    orange: "bg-orange-500",
    purple: "bg-violet-600",
    gray: "bg-zinc-400",
  }
  return map[accent]
}

function rowMatchesFilter(
  row: DemoFileStructureRow,
  filter: DemoFileStructureFilterId,
  categoryId: DemoTaxonomyCategoryId
) {
  if (filter === "all") return true
  if (filter === "unclassified") return categoryId === "other"
  if (filter === "duplicates") return row.tags?.includes("duplicate") ?? false
  if (filter === "orphaned") return row.tags?.includes("orphaned") ?? false
  return true
}

function fileStructureFilterChipClass(chipId: DemoFileStructureFilterId) {
  return cn(
    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors data-[state=on]:shadow-sm",
    chipId === "all" &&
      "border-transparent bg-zinc-100/80 text-zinc-600 hover:bg-zinc-200/80 data-[state=on]:border-slate-800 data-[state=on]:bg-slate-800 data-[state=on]:text-white",
    chipId === "duplicates" &&
      "border-transparent bg-amber-50/70 text-orange-800/80 hover:bg-amber-100/90 data-[state=on]:border-amber-200/80 data-[state=on]:bg-amber-50 data-[state=on]:text-orange-700",
    chipId === "orphaned" &&
      "border-transparent bg-rose-50/70 text-red-800/80 hover:bg-rose-100/90 data-[state=on]:border-rose-200/80 data-[state=on]:bg-rose-50 data-[state=on]:text-red-700",
    chipId === "unclassified" &&
      "border-transparent bg-zinc-100/80 text-zinc-600 hover:bg-zinc-200/80 data-[state=on]:border-zinc-200 data-[state=on]:bg-zinc-100 data-[state=on]:text-zinc-800"
  )
}

export function DemoFileStructurePanel() {
  const [query, setQuery] = React.useState("")
  const [activeFilter, setActiveFilter] = React.useState<DemoFileStructureFilterId>("all")
  const [hasInteractedWithFilter, setHasInteractedWithFilter] = React.useState(false)
  const summary = demoFileStructureSummary

  const filteredCategories = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return demoFileStructureCategories
      .map((cat) => ({
        ...cat,
        previewFiles: cat.previewFiles.filter((row) => {
          if (q && !row.name.toLowerCase().includes(q)) return false
          return rowMatchesFilter(row, activeFilter, cat.id)
        }),
      }))
      .filter((cat) => cat.previewFiles.length > 0)
  }, [query, activeFilter])

  const shouldAutoExpand = hasInteractedWithFilter && activeFilter !== "all"

  return (
    <Card
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-0 overflow-hidden border-zinc-200/90 py-0 shadow-sm",
        insightCream
      )}
    >
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:gap-4 md:px-5 md:py-5">
        <InputGroup className="h-10 shrink-0 rounded-xl border-zinc-200/90 bg-white shadow-sm has-[[data-slot=input-group-control]:focus-visible]:border-zinc-300">
          <InputGroupAddon align="inline-start" className="pl-3 text-zinc-400">
            <Search className="size-4" aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            className="h-10 text-sm placeholder:text-zinc-400"
            aria-label="Search files"
          />
        </InputGroup>

        <ToggleGroup
          type="single"
          value={activeFilter}
          onValueChange={(value) => {
            if (value) {
              setHasInteractedWithFilter(true)
              setActiveFilter(value as DemoFileStructureFilterId)
            }
          }}
          variant="default"
          size="sm"
          spacing={2}
          className="w-full min-w-0 flex-wrap justify-start gap-2 rounded-none border-0 bg-transparent p-0 shadow-none"
        >
          {summary.chips.map((chip) => (
            <ToggleGroupItem
              key={chip.id}
              value={chip.id}
              aria-label={`${chip.label} (${chip.count})`}
              className={cn(
                "shrink-0 shadow-none ring-0 focus-visible:ring-2 focus-visible:ring-zinc-900/15",
                fileStructureFilterChipClass(chip.id)
              )}
            >
              {chip.label}{" "}
              <span className="tabular-nums opacity-90">{chip.count}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <ScrollArea className="min-h-0 min-w-0 flex-1 pr-1">
          <div className="flex min-w-0 flex-col gap-2 px-0.5 pb-0.5 sm:px-1">
            {filteredCategories.length === 0 ? (
              <Empty className="border-zinc-200/60 bg-white/40 py-8 text-zinc-600">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderSearch className="size-4" aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>No matching files</EmptyTitle>
                  <EmptyDescription>
                    Try another filter or clear your search to see files in this vault.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              filteredCategories.map((cat) => (
                <FileStructureCategoryBlock
                  key={cat.id}
                  category={cat}
                  activeFilter={activeFilter}
                  forceOpen={shouldAutoExpand}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function fileTypeBadge(name: string) {
  const ext = (name.split(".").pop() ?? "").toLowerCase()
  if (ext === "pdf")
    return { label: "PDF", className: "border-red-200 bg-red-50 text-red-600" }
  if (ext === "xlsx" || ext === "xls")
    return { label: ext === "xlsx" ? "XLSX" : "XLS", className: "border-emerald-200 bg-emerald-50 text-emerald-700" }
  if (ext === "jpg" || ext === "jpeg" || ext === "png")
    return { label: "IMG", className: "border-violet-200 bg-violet-50 text-violet-700" }
  if (ext === "zip")
    return { label: "ZIP", className: "border-amber-200 bg-amber-50 text-amber-800" }
  if (ext === "docx" || ext === "doc")
    return { label: "DOC", className: "border-blue-200 bg-blue-50 text-blue-700" }
  return { label: ext.slice(0, 4).toUpperCase() || "FILE", className: "border-zinc-200 bg-zinc-50 text-zinc-600" }
}

function FileStructureCategoryBlock({
  category,
  activeFilter,
  forceOpen,
}: {
  category: (typeof demoFileStructureCategories)[number]
  activeFilter: DemoFileStructureFilterId
  forceOpen: boolean
}) {
  const orig = demoFileStructureCategories.find((c) => c.id === category.id)!
  const moreCount = Math.max(0, orig.totalFiles - orig.previewFiles.length)
  const [selectedRow, setSelectedRow] = React.useState<DemoFileStructureRow | null>(null)

  const rowIsHighlighted = React.useCallback(
    (row: DemoFileStructureRow) => {
      if (activeFilter === "all") return false
      if (activeFilter === "unclassified") return row.tags?.includes("unclassified") ?? false
      if (activeFilter === "duplicates") return row.tags?.includes("duplicate") ?? false
      if (activeFilter === "orphaned") return row.tags?.includes("orphaned") ?? false
      return false
    },
    [activeFilter]
  )

  return (
    <Card size="sm" className={demoWorkspaceExpandableCardClass}>
      <Collapsible
        defaultOpen={category.defaultOpen ?? false}
        open={forceOpen ? true : undefined}
        className={cn("group/fs", demoWorkspaceCollapsibleRootClass)}
      >
        <CollapsibleTrigger type="button" className={demoWorkspaceCollapsibleTriggerClass}>
          <ChevronRight className="size-4 shrink-0 text-zinc-400 transition-transform group-data-[state=open]/fs:rotate-90" />
          <span
            className={cn("size-2 shrink-0 rounded-full", categoryAccentDotClass(category.accent))}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">
            {category.label}
          </span>
          <Badge
            variant="outline"
            className="shrink-0 rounded-full border-zinc-200/80 bg-zinc-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-zinc-600 hover:bg-zinc-50"
          >
            {category.totalFiles} files
          </Badge>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className={demoWorkspaceCollapsibleContentClass}>
            <ItemGroup className="gap-0">
              {category.previewFiles.map((row) => {
                const badge = fileTypeBadge(row.name)
                const isHighlighted = rowIsHighlighted(row)
                return (
                  <Item
                    key={row.name}
                    role="listitem"
                    size="xs"
                    variant="default"
                    className={cn(
                      "border-0 bg-transparent px-2 py-2 shadow-none hover:bg-zinc-50/80",
                      isHighlighted &&
                        "bg-amber-50/80 ring-1 ring-amber-200/70 hover:bg-amber-50"
                    )}
                  >
                    <ItemMedia>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 px-1 py-px text-[9px] font-bold",
                          badge.className
                        )}
                      >
                        {badge.label}
                      </Badge>
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <span className="truncate text-sm text-zinc-800">{row.name}</span>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                      aria-label={`Open ${row.name} preview`}
                      onClick={() => setSelectedRow(row)}
                      >
                        <ChevronRight className="size-4" aria-hidden />
                      </Button>
                    </ItemActions>
                  </Item>
                )
              })}
              {moreCount > 0 ? (
                <p className="px-2 py-2 text-xs text-zinc-400" role="status">
                  + {moreCount} more files in this category
                </p>
              ) : null}
            </ItemGroup>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Dialog
        open={selectedRow !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedRow(null)
        }}
      >
        <DialogContent className="sm:max-w-[52rem]">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {selectedRow ? (
                <>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 px-1 py-px text-[9px] font-bold",
                      fileTypeBadge(selectedRow.name).className
                    )}
                  >
                    {fileTypeBadge(selectedRow.name).label}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate">{selectedRow.name}</span>
                </>
              ) : (
                "File preview"
              )}
            </DialogTitle>
            <DialogDescription>
              Preview for this demo is a placeholder. In production, this modal would render the PDF/image
              viewer and metadata for the selected file.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-zinc-200/70 bg-white p-4">
            <Empty className="border-zinc-200/60 bg-white py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search className="size-4" aria-hidden />
                </EmptyMedia>
                <EmptyTitle>Preview not available in demo</EmptyTitle>
                <EmptyDescription>
                  Hook this up to your document viewer to show the actual contents here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setSelectedRow(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function dupExtBadge(ext: "pdf" | "xlsx" | "docx") {
  const map = {
    pdf: { label: "PDF", className: "border-red-200 bg-red-50 text-red-600" },
    xlsx: { label: "XLSX", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    docx: { label: "DOCX", className: "border-blue-200 bg-blue-50 text-blue-700" },
  }
  return map[ext]
}

function duplicateFamilyLabel(stem: string) {
  const firstToken = stem.split(/[_\s-]+/).filter(Boolean)[0]
  return (firstToken ?? "duplicate").toUpperCase()
}

export function DemoDuplicatesPanel() {
  const [query, setQuery] = React.useState("")
  const [selectedRows, setSelectedRows] = React.useState<Record<string, boolean>>({})
  const [pendingApproval, setPendingApproval] = React.useState<{
    groupId: string
    rowKey: string
    fileName: string
    pressed: boolean
    selectedCount: number
    familyLabel: string
  } | null>(null)

  const rowKey = React.useCallback(
    (groupId: string, row: { fileName: string; originalPath: string }) =>
      `${groupId}:${row.fileName}:${row.originalPath}`,
    []
  )
  const visibleGroups = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = demoDuplicateGroupsView.filter((g) =>
      q ? g.stem.toLowerCase().includes(q) : true
    )
    list = [...list].sort((a, b) => b.copyCount - a.copyCount)
    return list
  }, [query])

  return (
    <Card
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-0 overflow-hidden border-zinc-200/90 py-0 shadow-sm",
        insightCream
      )}
    >
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:gap-4 md:px-5 md:py-5">
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <InputGroup className="h-10 min-w-0 flex-1 rounded-xl border-zinc-200/90 bg-white shadow-sm has-[[data-slot=input-group-control]:focus-visible]:border-zinc-300">
            <InputGroupAddon align="inline-start" className="pl-3 text-zinc-400">
              <Search className="size-4" aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search duplicate groups…"
              className="h-10 min-w-0 text-sm placeholder:text-zinc-400"
              aria-label="Search duplicate groups"
            />
          </InputGroup>
        </div>

        <ScrollArea className="min-h-0 min-w-0 flex-1 pr-1">
          <div className="flex min-w-0 flex-col gap-2 px-0.5 pb-0.5 sm:px-1">
            {visibleGroups.length === 0 ? (
              <Empty className="border-zinc-200/60 bg-white/40 py-8 text-zinc-600">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Copy className="size-4" aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>No duplicate groups</EmptyTitle>
                  <EmptyDescription>
                    Nothing matches your search. Try another name or clear the query.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              visibleGroups.map((group) => {
                const extBadge = dupExtBadge(group.ext)
                const familyLabel = duplicateFamilyLabel(group.stem)
                const selectedCount = group.rows.reduce((acc, row) => {
                  return acc + ((selectedRows[rowKey(group.id, row)] ?? row.isCanonical) ? 1 : 0)
                }, 0)
                return (
                  <Card key={group.id} size="sm" className={demoWorkspaceExpandableCardClass}>
                    <Collapsible
                      defaultOpen={false}
                      className={cn("group/dup", demoWorkspaceCollapsibleRootClass)}
                    >
                      <CollapsibleTrigger type="button" className={demoWorkspaceCollapsibleTriggerClass}>
                        <ChevronRight className="size-4 shrink-0 text-zinc-400 transition-transform group-data-[state=open]/dup:rotate-90" />
                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 px-1 py-px text-[9px] font-bold",
                            extBadge.className
                          )}
                        >
                          {extBadge.label}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">
                          {group.stem}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase",
                            group.kind === "version"
                              ? "border-violet-200 bg-violet-50 text-violet-800"
                              : "border-zinc-200 bg-zinc-100 text-zinc-700"
                          )}
                        >
                          {group.kind === "version" ? "Version" : "Exact"}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="shrink-0 rounded-full border-orange-200/80 bg-orange-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-orange-700 hover:bg-orange-50"
                        >
                          {group.copyCount} copies
                        </Badge>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className={demoWorkspaceCollapsibleContentClass}>
                          <Table className="min-w-[520px] border-collapse text-left text-xs">
                            <TableHeader>
                              <TableRow className="border-zinc-200/80 hover:bg-transparent">
                                <TableHead className="h-auto py-0 pb-2 pr-3 text-[10px] font-semibold tracking-wide whitespace-normal text-zinc-500 uppercase">
                                  File name
                                </TableHead>
                                <TableHead className="h-auto py-0 pb-2 pr-3 text-[10px] font-semibold tracking-wide whitespace-normal text-zinc-500 uppercase">
                                  Original path
                                </TableHead>
                                <TableHead className="h-auto py-0 pb-2 pr-3 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                                  Modified
                                </TableHead>
                                <TableHead className="h-auto w-20 py-0 pb-2 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                                  Selection
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {group.rows.map((row) => {
                                const isSelected = selectedRows[rowKey(group.id, row)] ?? row.isCanonical
                                return (
                                <TableRow
                                  key={row.fileName + row.originalPath}
                                  className={cn(
                                    "border-zinc-100/90 hover:bg-transparent",
                                    isSelected && "bg-emerald-50/80"
                                  )}
                                >
                                  <TableCell className="max-w-[220px] py-2 pr-3 whitespace-normal">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-medium text-zinc-900">
                                        {row.fileName}
                                      </span>
                                      {row.isCurrent ? (
                                        <Badge className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100">
                                          Current
                                        </Badge>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell className="max-w-[200px] py-2 pr-3 font-mono text-[11px] whitespace-normal text-zinc-600">
                                    <span className="break-all">{row.originalPath}</span>
                                  </TableCell>
                                  <TableCell className="py-2 pr-3 tabular-nums text-zinc-600">
                                    {row.modified}
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Toggle
                                      pressed={isSelected}
                                      onPressedChange={(pressed) => {
                                        const key = rowKey(group.id, row)
                                        const currentPressed = selectedRows[key] ?? row.isCanonical
                                        const nextSelectedCount =
                                          selectedCount + (pressed ? 1 : 0) - (currentPressed ? 1 : 0)

                                        if (nextSelectedCount > 1) {
                                          setPendingApproval({
                                            groupId: group.id,
                                            rowKey: key,
                                            fileName: row.fileName,
                                            pressed,
                                            selectedCount: nextSelectedCount,
                                            familyLabel,
                                          })
                                          return
                                        }

                                        setSelectedRows((prev) => ({
                                          ...prev,
                                          [key]: pressed,
                                        }))
                                      }}
                                      variant="outline"
                                      size="sm"
                                      className="h-6 min-w-[4.5rem] rounded-md px-2 text-[10px] font-semibold text-zinc-600 data-[state=on]:border-emerald-300 data-[state=on]:bg-emerald-50 data-[state=on]:text-emerald-700"
                                      aria-label={`Toggle selection for ${row.fileName}`}
                                    >
                                      {isSelected ? "Selected" : "Select"}
                                    </Toggle>
                                  </TableCell>
                                </TableRow>
                              )})}
                            </TableBody>
                          </Table>

                          {group.versionTrail && group.versionTrail.length > 0 ? (
                            <div className="mt-4 border-t border-zinc-100 pt-3">
                              <p className="mb-2 text-[10px] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
                                Version trail
                              </p>
                              <div className="flex flex-wrap items-center gap-3">
                                {group.versionTrail.map((node, i) => (
                                  <React.Fragment key={node.id}>
                                    {i > 0 ? (
                                      <span className="text-zinc-300" aria-hidden>
                                        —
                                      </span>
                                    ) : null}
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={cn(
                                          "size-2.5 rounded-full",
                                          node.current ? "bg-emerald-600" : "bg-zinc-300"
                                        )}
                                        aria-hidden
                                      />
                                      <span
                                        className={cn(
                                          "text-xs font-medium tabular-nums",
                                          node.current ? "text-emerald-800" : "text-zinc-500"
                                        )}
                                      >
                                        {node.label}
                                      </span>
                                    </div>
                                  </React.Fragment>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                )
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>

      <Dialog
        open={pendingApproval !== null}
        onOpenChange={(next) => {
          if (!next) setPendingApproval(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm multiple selection</DialogTitle>
            <DialogDescription>
              {pendingApproval ? (
                <>
                  This will result in {pendingApproval.selectedCount} {pendingApproval.familyLabel} files
                  in File Structure if you select{" "}
                  <span className="font-semibold text-foreground">{pendingApproval.fileName}</span>.
                  Do you want to continue?
                </>
              ) : (
                "This change creates multiple files in File Structure."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingApproval(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!pendingApproval) return
                setSelectedRows((prev) => ({
                  ...prev,
                  [pendingApproval.rowKey]: pendingApproval.pressed,
                }))
                setPendingApproval(null)
              }}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function leaseTimelineDot(kind: DemoLeaseTimelineKind) {
  if (kind === "lease") {
    return <span className="size-3.5 shrink-0 rounded-full border-2 border-white bg-blue-600 shadow-sm ring-2 ring-blue-100" />
  }
  if (kind === "orphaned") {
    return (
      <span className="size-3.5 shrink-0 rounded-full border-2 border-amber-500 bg-white shadow-sm" />
    )
  }
  if (kind === "sideLetter") {
    return (
      <span className="size-3.5 shrink-0 rounded-full border-2 border-pink-400 bg-white shadow-sm" />
    )
  }
  return <span className="size-3.5 shrink-0 rounded-full border-2 border-zinc-300 bg-white shadow-sm" />
}

function leaseDocBadgeClass(badge: DemoLeaseDocRow["badge"]) {
  if (badge === "Lease") return "bg-blue-100 text-blue-800"
  if (badge === "Amendment") return "bg-zinc-100 text-zinc-700"
  if (badge === "Side letter") return "bg-pink-100 text-pink-800"
  return "bg-orange-100 font-semibold text-amber-900"
}

function leaseRowShellClass(doc: DemoLeaseDocRow) {
  if (doc.timelineKind === "lease") return "border border-blue-100 bg-[#EBF2FF]"
  if (doc.timelineKind === "orphaned") {
    return "border-2 border-amber-400/80 bg-[#FDF7E1]"
  }
  if (doc.timelineKind === "sideLetter") return "border border-pink-100 bg-white"
  return "border border-zinc-200/90 bg-white"
}

function LeaseChainTimeline({ docs }: { docs: DemoLeaseDocRow[] }) {
  return (
    <ol className="relative m-0 list-none space-y-2.5 p-0">
      <span
        aria-hidden
        className="pointer-events-none absolute top-2 bottom-2 left-[0.6875rem] z-0 w-0.5 bg-zinc-200"
      />
      {docs.map((doc) => (
        <li key={doc.id} className="relative z-[1] flex min-w-0 gap-3">
          <div className="flex w-6 shrink-0 justify-center pt-2">
            <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-white/95 shadow-sm ring-2 ring-white/95">
              {leaseTimelineDot(doc.timelineKind)}
            </span>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div
              className={cn(
                "flex min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2.5 shadow-sm",
                leaseRowShellClass(doc)
              )}
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 border-0 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                    leaseDocBadgeClass(doc.badge)
                  )}
                >
                  {doc.badge}
                </Badge>
                <span className="min-w-0 truncate text-sm font-medium text-zinc-900">{doc.fileName}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs tabular-nums text-zinc-500">{doc.date}</span>
                <ChevronRight className="size-4 text-zinc-300" aria-hidden />
              </div>
            </div>
            {doc.timelineKind === "orphaned" && doc.orphanNote ? (
              <Alert className="border-amber-200/90 bg-amber-50/90 py-2.5 text-amber-950">
                <AlertDescription className="text-xs leading-relaxed text-amber-950">
                  {doc.orphanNote}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function DemoLeaseChainsPanel() {
  const [query, setQuery] = React.useState("")

  const cards = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return demoLeaseChainCards
    return demoLeaseChainCards.filter((c) => c.tenantName.toLowerCase().includes(q))
  }, [query])

  return (
    <Card
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-0 overflow-hidden border-zinc-200/90 py-0 shadow-sm",
        insightCream
      )}
    >
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 md:gap-4 md:px-5 md:py-5">
        <InputGroup className="h-10 shrink-0 rounded-xl border-zinc-200/90 bg-white shadow-sm has-[[data-slot=input-group-control]:focus-visible]:border-zinc-300">
          <InputGroupAddon align="inline-start" className="pl-3 text-zinc-400">
            <Search className="size-4" aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tenant chains…"
            className="h-10 text-sm placeholder:text-zinc-400"
            aria-label="Search tenant chains"
          />
        </InputGroup>

        <ScrollArea className="min-h-0 min-w-0 flex-1 pr-1">
          <div className="flex min-w-0 flex-col gap-3 px-0.5 pb-0.5 sm:px-1">
            {cards.length === 0 ? (
              <Empty className="border-zinc-200/60 bg-white/40 py-8 text-zinc-600">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <GitBranch className="size-4" aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>No tenant chains</EmptyTitle>
                  <EmptyDescription>
                    Nothing matches your search. Try another tenant name or clear the query.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              cards.map((card) => (
                <Card key={card.id} size="sm" className={demoWorkspaceExpandableCardClass}>
                  <Collapsible defaultOpen={false} className={cn("group/lease", demoWorkspaceCollapsibleRootClass)}>
                    <CollapsibleTrigger type="button" className={demoWorkspaceCollapsibleTriggerClass}>
                      <ChevronRight className="size-4 shrink-0 text-zinc-400 transition-transform group-data-[state=open]/lease:rotate-90" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">
                        {card.tenantName}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold",
                          card.orphanCount === 0
                            ? "border-emerald-200/80 bg-emerald-50 text-emerald-800"
                            : "border-orange-200/80 bg-orange-50 text-orange-800"
                        )}
                      >
                        {card.orphanCount === 0 ? "Clean chain" : `${card.orphanCount} orphaned`}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="shrink-0 rounded-full border-orange-200/80 bg-orange-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-orange-700 hover:bg-orange-50"
                      >
                        {card.docCount} docs
                      </Badge>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className={demoWorkspaceCollapsibleContentClass}>
                        <div className="space-y-4">
                          {card.chain.length > 0 ? <LeaseChainTimeline docs={card.chain} /> : null}

                          {card.orphans && card.orphans.length > 0 ? (
                            <div
                              className={cn(
                                card.chain.length > 0 &&
                                  "border-t border-dashed border-amber-300/90 pt-6"
                              )}
                            >
                              <p className="mb-3 text-[10px] font-bold tracking-[0.12em] text-orange-700 uppercase">
                                ● Orphaned — no matched base lease
                              </p>
                              <LeaseChainTimeline docs={card.orphans} />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
