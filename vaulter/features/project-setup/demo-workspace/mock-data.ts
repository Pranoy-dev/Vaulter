/** Sidebar + dashboard must use this exact string when opening the demo workspace. */
export const DEMO_WORKSPACE_TITLE = "Demo workspace"

export type DemoAgentLogEntry = {
  id: string
  title: string
  summary: string
  /** Multi-line detail shown when expanded */
  detailLines: string[]
  /** When true, this row starts expanded (default: collapsed on first visit). */
  defaultOpen?: boolean
}

export const demoAgentLogEntries: DemoAgentLogEntry[] = [
  {
    id: "plan",
    title: "Planning ingestion",
    summary: "Scoping folder walk, hash dedupe, and taxonomy slots.",
    detailLines: [
      "· Target roots: /uploads, /legacy_scans",
      "· Exclude: thumbs.db, .DS_Store",
      "· Pipeline: extract → classify → link leases",
    ],
  },
  {
    id: "classify",
    title: "Classifying against deal taxonomy",
    summary: "Mapped 847 files; 155 flagged for manual review.",
    detailLines: [
      "· Rules engine v3 (leases, financials, corp)",
      "· Confidence < 0.72 → Other / review queue",
      "· 18% routed to Other or low-confidence bucket",
    ],
  },
  {
    id: "dupes",
    title: "Detecting duplicate clusters",
    summary: "12 files in 4 groups (content hash + normalized name stem).",
    detailLines: [
      "· MD5 match across Riverfront_Lease_v2.pdf copies",
      "· Near-duplicate: RentRoll_Q3 (Excel + PDF export)",
    ],
  },
  {
    id: "chains",
    title: "Linking lease / amendment chains",
    summary: "Resolved 9 tenant chains; 3 orphaned amendments isolated.",
    detailLines: [
      "· Cross-ref: exhibit A numbering, execution dates",
      "· Orphans: missing base lease path in upload set",
    ],
  },
  {
    id: "validate",
    title: "Validation pass",
    summary: "Ready for analyst review in workspace panels.",
    detailLines: [
      "· No blocking errors",
      "· 5 leases lack amendment links (see AI Insights)",
    ],
  },
]

export const demoAiInsights = [
  "12 duplicate files across 4 folders",
  "3 orphaned amendments",
  "18% of files unclassified",
  "5 leases without linked amendments",
] as const

export type DemoInsightMetricTone = "neutral" | "danger" | "warning"

export type DemoInsightMetric = {
  id: string
  label: string
  value: string
  tone: DemoInsightMetricTone
}

export type DemoDealDeduction = { points: number; label: string }

export type DemoMissingDocTone = "missing" | "warning" | "found"

export type DemoMissingDocItem = {
  label: string
  tone: DemoMissingDocTone
}

export type DemoLeaseExpiryBarTone = "high" | "mid" | "low"

export type DemoLeaseExpiryBar = {
  id: string
  quarter: string
  year: string
  heightPct: number
  tone: DemoLeaseExpiryBarTone
}

/** Layout + copy aligned with the portfolio AI insights reference UI. */
export const demoAiInsightsDashboard = {
  processedLabel: "Processed 4 min ago",
  metrics: [
    {
      id: "docs",
      label: "Documents processed",
      value: "423",
      tone: "neutral",
    },
    {
      id: "dups",
      label: "Duplicate groups",
      value: "16",
      tone: "danger",
    },
    {
      id: "orphans",
      label: "Orphaned amendments",
      value: "3",
      tone: "warning",
    },
    {
      id: "unclass",
      label: "Unclassified files",
      value: "28%",
      tone: "warning",
    },
  ] satisfies DemoInsightMetric[],
  dealRisk: {
    score: 34,
    max: 100,
    badge: "Below average readiness",
    deductions: [
      { points: 28, label: "Unclassified files" },
      { points: 16, label: "Missing documents" },
      { points: 12, label: "Orphaned amendments" },
      { points: 10, label: "Duplicate rate" },
    ] satisfies DemoDealDeduction[],
  },
  whatsMissing: {
    badge: "3 not found",
    description:
      "Standard CRE documents expected but not located in this upload.",
    items: [
      { label: "Rent roll", tone: "missing" },
      { label: "Technical inspection report", tone: "missing" },
      { label: "Environmental survey", tone: "warning" },
      { label: "SPA draft", tone: "found" },
    ] satisfies DemoMissingDocItem[],
  },
  leaseExpiry: {
    badge: "High risk",
    description:
      "4 of 7 leases expire in the same 18-month window.",
    bars: [
      { id: "25q1", quarter: "Q1", year: "2025", heightPct: 22, tone: "low" },
      { id: "25q2", quarter: "Q2", year: "2025", heightPct: 28, tone: "mid" },
      { id: "25q3", quarter: "Q3", year: "2025", heightPct: 35, tone: "mid" },
      { id: "25q4", quarter: "Q4", year: "2025", heightPct: 100, tone: "high" },
      { id: "26q1", quarter: "Q1", year: "2026", heightPct: 92, tone: "high" },
      { id: "26q2", quarter: "Q2", year: "2026", heightPct: 40, tone: "mid" },
      { id: "26q3", quarter: "Q3", year: "2026", heightPct: 25, tone: "low" },
      { id: "26q4", quarter: "Q4", year: "2026", heightPct: 18, tone: "low" },
    ] satisfies DemoLeaseExpiryBar[],
  },
}

export type DemoTaxonomyCategoryId =
  | "leases"
  | "financial"
  | "technical"
  | "corporate"
  | "other"

export type DemoTaxonomyCategory = {
  id: DemoTaxonomyCategoryId
  label: string
  files: string[]
}

export const demoTaxonomy: DemoTaxonomyCategory[] = [
  {
    id: "leases",
    label: "Leases & Amendments",
    files: [
      "Sunset_BlockA_MasterLease_Executed.pdf",
      "Sunset_BlockA_Amd1_RentReview.docx",
      "Riverfront_GroundFloor_Lease_2019.pdf",
      "Riverfront_Amd2_PermittedUse_Redline.docx",
      "Oakwood_Unit501_Lease_Schedule1.pdf",
      "Oakwood_Amd1_TermExtension_Executed.pdf",
      "Cityview_Tower3_Lease_Abstract.xlsx",
      "MapleGrove_PadSite_Lease_Final.pdf",
      "MapleGrove_Amd1_Parking_Addendum.pdf",
      "Sublease_Acme_Riverfront_Partial.pdf",
    ],
  },
  {
    id: "financial",
    label: "Financial Documents",
    files: [
      "RentRoll_Portfolio_Q4_2025.xlsx",
      "DCF_Model_DealRoom_v8.xlsx",
      "Historical_NOI_Schedule_2022-2025.pdf",
      "CapEx_Budget_2026_Forecast.xlsx",
      "Tenant_AR_Aging_Cityview.pdf",
      "Variance_Report_Q3_vs_Budget.pdf",
      "Refinance_UW_Memorandum_Draft.docx",
      "CashFlow_13Week_Oakwood.xls",
    ],
  },
  {
    id: "technical",
    label: "Technical & Environmental",
    files: [
      "PhaseI_ESA_Riverfront_2024.pdf",
      "Building_Condition_Survey_Oakwood.pdf",
      "ADA_Accessibility_Assessment_Cityview.pdf",
      "Roof_Warranty_MapleGrove.pdf",
      "Asbestos_ABA_Inventory_Sunset.pdf",
      "Flood_Cert_FEMA_Letter_MapleGrove.pdf",
      "MEP_CapitalNeedsAssessment_2025.pdf",
    ],
  },
  {
    id: "corporate",
    label: "Corporate & Legal",
    files: [
      "SPA_Buyer_Purchaser_Execution.pdf",
      "Shareholder_Res_LettingCorp.pdf",
      "GoodStanding_LettingCorp_DE.pdf",
      "OperatingAgreement_Holdco_v3.docx",
      "LiquorLicense_Transfer_App_City.pdf",
      "TitleCommitment_Amendment_ScheduleB.pdf",
    ],
  },
  {
    id: "other",
    label: "Other",
    files: [
      "Scan_00342_unlabeled.pdf",
      "Misc_Correspondence_2021.zip",
      "Photo_Facade_UnknownSite.jpg",
      "Notes_Meeting_Legal_Unsigned.docx",
    ],
  },
]

/** File structure tab (reference UI): filters + categorized tree */
export type DemoFileStructureFilterId = "all" | "duplicates" | "orphaned" | "unclassified"

export type DemoFileRowStatus = "ok" | "warning"

export type DemoFileStructureRowTag = "duplicate" | "orphaned" | "unclassified"

export type DemoFileStructureRow = {
  name: string
  /** Trailing status dot in file row */
  rowStatus: DemoFileRowStatus
  /** Which filter chips surface this row (when not "all") */
  tags?: DemoFileStructureRowTag[]
}

export type DemoFileCategoryAccent = "blue" | "green" | "orange" | "purple" | "gray"

export type DemoFileStructureCategory = {
  id: DemoTaxonomyCategoryId
  label: string
  accent: DemoFileCategoryAccent
  /** Total files in vault for this category (preview may be shorter) */
  totalFiles: number
  defaultOpen?: boolean
  previewFiles: DemoFileStructureRow[]
}

export const demoFileStructureSummary = {
  totalDocuments: 423,
  chips: [
    { id: "all" as const, label: "All", count: 423 },
    { id: "duplicates" as const, label: "Duplicates", count: 34 },
    { id: "orphaned" as const, label: "Orphaned", count: 3 },
    { id: "unclassified" as const, label: "Unclassified", count: 118 },
  ],
}

export const demoFileStructureCategories: DemoFileStructureCategory[] = [
  {
    id: "leases",
    label: "Leases & amendments",
    accent: "blue",
    totalFiles: 148,
    defaultOpen: false,
    previewFiles: [
      { name: "Tenant_A_Lease_v3.pdf", rowStatus: "ok", tags: ["duplicate"] },
      { name: "Riverfront_MasterLease_2019.pdf", rowStatus: "warning", tags: ["duplicate"] },
      { name: "Oakwood_Amd2_Term_NotLinked.pdf", rowStatus: "warning", tags: ["orphaned"] },
      { name: "Sunset_BlockA_Lease_Executed.pdf", rowStatus: "ok" },
      { name: "Sublease_Acme_Partial_Redline.pdf", rowStatus: "ok", tags: ["duplicate"] },
    ],
  },
  {
    id: "financial",
    label: "Financial documents",
    accent: "green",
    totalFiles: 87,
    defaultOpen: false,
    previewFiles: [
      { name: "RentRoll_Portfolio_Q4_2025.xlsx", rowStatus: "ok", tags: ["duplicate"] },
      { name: "DCF_Model_DealRoom_v8.xlsx", rowStatus: "ok" },
      { name: "Variance_Report_Q3_vs_Budget.pdf", rowStatus: "warning" },
    ],
  },
  {
    id: "technical",
    label: "Technical & environmental",
    accent: "orange",
    totalFiles: 34,
    defaultOpen: false,
    previewFiles: [
      { name: "PhaseI_ESA_Riverfront_2024.pdf", rowStatus: "ok", tags: ["duplicate"] },
      { name: "Building_Condition_Survey_Oakwood.pdf", rowStatus: "ok" },
    ],
  },
  {
    id: "corporate",
    label: "Corporate & legal",
    accent: "purple",
    totalFiles: 36,
    defaultOpen: false,
    previewFiles: [
      { name: "SPA_Buyer_Purchaser_Execution.pdf", rowStatus: "ok" },
      { name: "TitleCommitment_Amendment_ScheduleB.pdf", rowStatus: "warning" },
    ],
  },
  {
    id: "other",
    label: "Other",
    accent: "gray",
    totalFiles: 118,
    defaultOpen: false,
    previewFiles: [
      { name: "Scan_00342_unlabeled.pdf", rowStatus: "warning", tags: ["unclassified"] },
      { name: "Misc_Correspondence_2021.zip", rowStatus: "warning", tags: ["unclassified"] },
      { name: "Photo_Facade_UnknownSite.jpg", rowStatus: "ok", tags: ["unclassified"] },
    ],
  },
]

export type DemoDuplicateGroup = {
  id: string
  stem: string
  copies: string[]
}

const _demoDuplicateGroupsRaw: DemoDuplicateGroup[] = [
  {
    id: "g1",
    stem: "Riverfront_GroundFloor_Lease_2019",
    copies: [
      "Legal/Riverfront_GroundFloor_Lease_2019.pdf",
      "Archive/Riverfront_GroundFloor_Lease_2019_copy.pdf",
      "Email_Attach/Riverfront_GroundFloor_Lease_2019.pdf",
      "Uploads/old/Riverfront_GroundFloor_Lease_2019_FINAL.pdf",
    ],
  },
  {
    id: "g2",
    stem: "RentRoll_Portfolio_Q4_2025",
    copies: [
      "Finance/RentRoll_Portfolio_Q4_2025.xlsx",
      "Finance/exports/RentRoll_Portfolio_Q4_2025.xlsx",
      "Dropbox/RentRoll_Portfolio_Q4_2025.xlsx",
    ],
  },
  {
    id: "g3",
    stem: "PhaseI_ESA_Riverfront_2024",
    copies: [
      "Env/PhaseI_ESA_Riverfront_2024.pdf",
      "Due_Diligence/PhaseI_ESA_Riverfront_2024_signed.pdf",
    ],
  },
  {
    id: "g4",
    stem: "SPA_Buyer_Purchaser_Execution",
    copies: [
      "Corp/SPA_Buyer_Purchaser_Execution.pdf",
      "DataRoom/SPA_Buyer_Purchaser_Execution.pdf",
    ],
  },
]

export const demoDuplicateGroups: DemoDuplicateGroup[] = [..._demoDuplicateGroupsRaw].sort(
  (a, b) => b.copies.length - a.copies.length
)

/** Duplication tab — summary strip + expandable groups (reference UI) */
export const demoDuplicatesSummary = {
  duplicateGroups: 16,
  redundantFiles: 34,
  exactMatches: 11,
  versionGroups: 5,
} as const

export type DemoDuplicateGroupKind = "exact" | "version"

export type DemoDuplicateDetailRow = {
  fileName: string
  originalPath: string
  modified: string
  isCurrent: boolean
  /** Canonical / master file for this group */
  isCanonical: boolean
}

export type DemoDuplicateVersionNode = {
  id: string
  label: string
  current: boolean
}

export type DemoDuplicateGroupView = {
  id: string
  /** Short label in row (no extension) */
  stem: string
  kind: DemoDuplicateGroupKind
  ext: "pdf" | "xlsx" | "docx"
  copyCount: number
  rows: DemoDuplicateDetailRow[]
  versionTrail?: DemoDuplicateVersionNode[]
}

function pathParts(fullPath: string) {
  const parts = fullPath.split("/")
  const fileName = parts.pop() ?? fullPath
  const originalPath = parts.length ? `/${parts.join("/")}/` : "/"
  return { fileName, originalPath }
}

function rowsFromPaths(paths: string[], kind: DemoDuplicateGroupKind): DemoDuplicateDetailRow[] {
  const dates = ["18 Nov 2024", "3 Dec 2024", "7 Jan 2025", "20 Jan 2025"]
  return paths.map((p, i) => {
    const { fileName, originalPath } = pathParts(p)
    const isLast = i === paths.length - 1
    return {
      fileName,
      originalPath,
      modified: dates[i % dates.length] ?? "—",
      isCurrent: kind === "version" ? isLast : false,
      isCanonical: i === 0,
    }
  })
}

export const demoDuplicateGroupsView: DemoDuplicateGroupView[] = [
  {
    id: "spa-draft",
    stem: "SPA_Draft",
    kind: "version",
    ext: "docx",
    copyCount: 4,
    rows: [
      {
        fileName: "SPA_Draft_v1.docx",
        originalPath: "/04_Legal/SPA/",
        modified: "18 Nov 2024",
        isCurrent: false,
        isCanonical: false,
      },
      {
        fileName: "SPA_Draft_v2.docx",
        originalPath: "/04_Legal/SPA/",
        modified: "3 Dec 2024",
        isCurrent: false,
        isCanonical: false,
      },
      {
        fileName: "SPA_Draft_v3.docx",
        originalPath: "/04_Legal/SPA/archived/",
        modified: "7 Jan 2025",
        isCurrent: false,
        isCanonical: false,
      },
      {
        fileName: "SPA_Draft_v4.docx",
        originalPath: "/04_Legal/SPA/",
        modified: "20 Jan 2025",
        isCurrent: true,
        isCanonical: true,
      },
    ],
    versionTrail: [
      { id: "v1", label: "v1", current: false },
      { id: "v2", label: "v2", current: false },
      { id: "v3", label: "v3", current: false },
      { id: "v4", label: "v4", current: true },
    ],
  },
  {
    id: "g1",
    stem: "Riverfront_GroundFloor_Lease_2019",
    kind: "exact",
    ext: "pdf",
    copyCount: 4,
    rows: rowsFromPaths(
      [
        "Legal/Riverfront_GroundFloor_Lease_2019.pdf",
        "Archive/Riverfront_GroundFloor_Lease_2019_copy.pdf",
        "Email_Attach/Riverfront_GroundFloor_Lease_2019.pdf",
        "Uploads/old/Riverfront_GroundFloor_Lease_2019_FINAL.pdf",
      ],
      "exact"
    ),
  },
  {
    id: "g2",
    stem: "RentRoll_Portfolio_Q4_2025",
    kind: "exact",
    ext: "xlsx",
    copyCount: 3,
    rows: rowsFromPaths(
      [
        "Finance/RentRoll_Portfolio_Q4_2025.xlsx",
        "Finance/exports/RentRoll_Portfolio_Q4_2025.xlsx",
        "Dropbox/RentRoll_Portfolio_Q4_2025.xlsx",
      ],
      "exact"
    ),
  },
  {
    id: "g3",
    stem: "PhaseI_ESA_Riverfront_2024",
    kind: "exact",
    ext: "pdf",
    copyCount: 2,
    rows: rowsFromPaths(
      ["Env/PhaseI_ESA_Riverfront_2024.pdf", "Due_Diligence/PhaseI_ESA_Riverfront_2024_signed.pdf"],
      "exact"
    ),
  },
  {
    id: "g4",
    stem: "SPA_Buyer_Purchaser_Execution",
    kind: "exact",
    ext: "pdf",
    copyCount: 2,
    rows: rowsFromPaths(
      ["Corp/SPA_Buyer_Purchaser_Execution.pdf", "DataRoom/SPA_Buyer_Purchaser_Execution.pdf"],
      "exact"
    ),
  },
]

/** Lease Flags / amendment tab — summary + tenant cards (reference UI) */
export const demoLeaseFlagsSummary = {
  tenantChains: 7,
  documentsLinked: 18,
  orphanedAmendments: 3,
  cleanChains: 4,
} as const

export type DemoLeaseTimelineKind = "lease" | "amendment" | "sideLetter" | "orphaned"

export type DemoLeaseDocRow = {
  id: string
  fileName: string
  /** Shown on the right, e.g. "Aug 2021" */
  date: string
  badge: "Lease" | "Amendment" | "Side letter" | "Orphaned"
  timelineKind: DemoLeaseTimelineKind
  /** Yellow info box under an orphaned row */
  orphanNote?: string
}

export type DemoLeaseTenantCard = {
  id: string
  tenantName: string
  initials: string
  avatarClass: string
  docCount: number
  orphanCount: number
  /** Main linked chain (timeline above orphan section) */
  chain: DemoLeaseDocRow[]
  /** Separated with dashed rule — “no matched base lease” */
  orphans?: DemoLeaseDocRow[]
}

export const demoLeaseChainCards: DemoLeaseTenantCard[] = [
  {
    id: "c1",
    tenantName: "Tenant A — Oakwood Medical LLP",
    initials: "OM",
    avatarClass: "bg-emerald-200 text-emerald-900",
    docCount: 3,
    orphanCount: 0,
    chain: [
      {
        id: "c1a",
        fileName: "Oakwood_Unit501_Lease_Schedule1.pdf",
        date: "Aug 2021",
        badge: "Lease",
        timelineKind: "lease",
      },
      {
        id: "c1b",
        fileName: "Oakwood_Amd1_TermExtension_Executed.pdf",
        date: "Mar 2023",
        badge: "Amendment",
        timelineKind: "amendment",
      },
      {
        id: "c1c",
        fileName: "Oakwood_SideLetter_Parking.docx",
        date: "Jun 2023",
        badge: "Side letter",
        timelineKind: "sideLetter",
      },
    ],
  },
  {
    id: "c2",
    tenantName: "Tenant B — Riverfront Retail LLC",
    initials: "RR",
    avatarClass: "bg-sky-200 text-sky-900",
    docCount: 2,
    orphanCount: 0,
    chain: [
      {
        id: "c2a",
        fileName: "Riverfront_GroundFloor_Lease_2019.pdf",
        date: "Jan 2019",
        badge: "Lease",
        timelineKind: "lease",
      },
      {
        id: "c2b",
        fileName: "Riverfront_Amd2_PermittedUse_Redline.docx",
        date: "Sep 2022",
        badge: "Amendment",
        timelineKind: "amendment",
      },
    ],
  },
  {
    id: "c3",
    tenantName: "Tenant C — Letting Corp. (Sunset Block A)",
    initials: "LC",
    avatarClass: "bg-violet-200 text-violet-900",
    docCount: 3,
    orphanCount: 1,
    chain: [
      {
        id: "c3a",
        fileName: "Sunset_BlockA_MasterLease_Executed.pdf",
        date: "Nov 2020",
        badge: "Lease",
        timelineKind: "lease",
      },
      {
        id: "c3b",
        fileName: "Sunset_BlockA_Amd1_RentReview.docx",
        date: "Apr 2022",
        badge: "Amendment",
        timelineKind: "amendment",
      },
    ],
    orphans: [
      {
        id: "c3o",
        fileName: "Sunset_BlockA_Amd2_Option_Not_Found.pdf",
        date: "Jul 2023",
        badge: "Orphaned",
        timelineKind: "orphaned",
        orphanNote:
          "v1 note — Gap detection: amendment references Option Schedule B; no matching base lease clause in upload set.",
      },
    ],
  },
  {
    id: "c4",
    tenantName: "Tenant D — Cityview mystery chain",
    initials: "CM",
    avatarClass: "bg-rose-200 text-rose-900",
    docCount: 1,
    orphanCount: 1,
    chain: [],
    orphans: [
      {
        id: "c4o",
        fileName: "Mystery_Amd_Cityview_2018.pdf",
        date: "May 2018",
        badge: "Orphaned",
        timelineKind: "orphaned",
        orphanNote: "No tenant folder match; filename suggests Cityview tower — flag for analyst.",
      },
    ],
  },
  {
    id: "c5",
    tenantName: "Maple Grove Pad Site LLC",
    initials: "MG",
    avatarClass: "bg-amber-200 text-amber-900",
    docCount: 3,
    orphanCount: 0,
    chain: [
      {
        id: "c5a",
        fileName: "MapleGrove_PadSite_Lease_Final.pdf",
        date: "Feb 2018",
        badge: "Lease",
        timelineKind: "lease",
      },
      {
        id: "c5b",
        fileName: "MapleGrove_Amd1_Parking_Addendum.pdf",
        date: "Aug 2020",
        badge: "Amendment",
        timelineKind: "amendment",
      },
      {
        id: "c5c",
        fileName: "MapleGrove_RoofAccess_SideLetter.pdf",
        date: "Dec 2021",
        badge: "Side letter",
        timelineKind: "sideLetter",
      },
    ],
  },
  {
    id: "c6",
    tenantName: "Sublease — Acme @ Riverfront",
    initials: "SA",
    avatarClass: "bg-cyan-200 text-cyan-900",
    docCount: 3,
    orphanCount: 0,
    chain: [
      {
        id: "c6a",
        fileName: "Sublease_Acme_Riverfront_Partial.pdf",
        date: "Jun 2021",
        badge: "Lease",
        timelineKind: "lease",
      },
      {
        id: "c6b",
        fileName: "Sublease_Acme_Amd1_Rent.pdf",
        date: "Jan 2023",
        badge: "Amendment",
        timelineKind: "amendment",
      },
      {
        id: "c6c",
        fileName: "Sublease_Consent_Landlord.docx",
        date: "Jan 2023",
        badge: "Side letter",
        timelineKind: "sideLetter",
      },
    ],
  },
  {
    id: "c7",
    tenantName: "Letting Corp. — Cityview Tower 3",
    initials: "CT",
    avatarClass: "bg-indigo-200 text-indigo-900",
    docCount: 3,
    orphanCount: 1,
    chain: [
      {
        id: "c7a",
        fileName: "Cityview_Tower3_Lease_Abstract.xlsx",
        date: "Sep 2019",
        badge: "Lease",
        timelineKind: "lease",
      },
      {
        id: "c7b",
        fileName: "Cityview_Amd1_CAM_TrueUp.pdf",
        date: "Nov 2022",
        badge: "Amendment",
        timelineKind: "amendment",
      },
    ],
    orphans: [
      {
        id: "c7o",
        fileName: "Cityview_Floating_Amd_Draft.pdf",
        date: "Feb 2024",
        badge: "Orphaned",
        timelineKind: "orphaned",
        orphanNote: "Executed date precedes master lease on file — possible superseded version not uploaded.",
      },
    ],
  },
]

export type DemoChainDoc = {
  id: string
  label: string
  fileName: string
  kind: "lease" | "amendment"
  isOrphaned?: boolean
}

export type DemoTenantChain = {
  tenantId: string
  tenantName: string
  documents: DemoChainDoc[]
}

export const demoTenantChains: DemoTenantChain[] = [
  {
    tenantId: "t1",
    tenantName: "Letting Corp. (Sunset Block A)",
    documents: [
      {
        id: "d1",
        label: "Base lease",
        fileName: "Sunset_BlockA_MasterLease_Executed.pdf",
        kind: "lease",
      },
      {
        id: "d2",
        label: "Amendment 1",
        fileName: "Sunset_BlockA_Amd1_RentReview.docx",
        kind: "amendment",
      },
      {
        id: "d3",
        label: "Amendment 2",
        fileName: "Sunset_BlockA_Amd2_Option_Not_Found.pdf",
        kind: "amendment",
        isOrphaned: true,
      },
    ],
  },
  {
    tenantId: "t2",
    tenantName: "Riverfront Retail LLC",
    documents: [
      {
        id: "d4",
        label: "Base lease",
        fileName: "Riverfront_GroundFloor_Lease_2019.pdf",
        kind: "lease",
      },
      {
        id: "d5",
        label: "Amendment 1",
        fileName: "Riverfront_Amd2_PermittedUse_Redline.docx",
        kind: "amendment",
      },
    ],
  },
  {
    tenantId: "t3",
    tenantName: "Oakwood Medical LLP",
    documents: [
      {
        id: "d6",
        label: "Base lease",
        fileName: "Oakwood_Unit501_Lease_Schedule1.pdf",
        kind: "lease",
      },
      {
        id: "d7",
        label: "Amendment 1",
        fileName: "Oakwood_Amd1_TermExtension_Executed.pdf",
        kind: "amendment",
      },
    ],
  },
  {
    tenantId: "t4",
    tenantName: "Unlinked amendment (orphan)",
    documents: [
      {
        id: "d8",
        label: "Orphaned amendment",
        fileName: "Mystery_Amd_Cityview_2018.pdf",
        kind: "amendment",
        isOrphaned: true,
      },
    ],
  },
]
