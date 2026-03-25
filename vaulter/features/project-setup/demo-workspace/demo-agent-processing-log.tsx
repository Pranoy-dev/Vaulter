"use client"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { ChevronRight } from "lucide-react"
import { demoAgentLogEntries } from "./mock-data"

export function DemoAgentProcessingLog() {
  return (
    <div className="space-y-1 px-1">
      <p className="mb-1.5 px-0.5 pt-0.5 text-[10px] font-medium leading-normal tracking-wider text-white/45 uppercase">
        Processing
      </p>
      {demoAgentLogEntries.map((entry) => (
        <Collapsible
          key={entry.id}
          defaultOpen={entry.defaultOpen === true}
          className="group/coll rounded-lg border border-white/[0.08] bg-white/[0.04]"
        >
          <CollapsibleTrigger
            type="button"
            className={cn(
              "flex w-full items-start gap-1.5 px-2 py-1.5 text-left transition-colors",
              "group-data-[state=open]/coll:bg-white/[0.05] hover:bg-white/[0.06]"
            )}
          >
            <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-white/50 transition-transform group-data-[state=open]/coll:rotate-90" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-white/90">{entry.title}</div>
              <div className="text-[11px] leading-snug text-white/50">{entry.summary}</div>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="data-[state=closed]:animate-none">
            <div className="border-t border-white/[0.06] px-2 py-1.5 pl-8">
              <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-white/55">
                {entry.detailLines.join("\n")}
              </pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  )
}
