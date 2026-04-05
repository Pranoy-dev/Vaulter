"use client"

import * as React from "react"
import { useAuth } from "@clerk/nextjs"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""

// ── Types for deal insights ──────────────────────────────────────────────────

export interface RiskBand {
  key: "low" | "medium" | "high" | "critical"
  label: string
  color: string
}

export interface DimensionScore {
  score: number
  weight: number
  label: string
}

export interface CircuitBreaker {
  severity: string
  message: string
  cap: number | null
}

export interface RiskDriver {
  severity: "critical" | "warning" | "info" | "positive"
  message: string
  impact: number
}

export interface MissingItem {
  tier: number
  weight: number
  message: string
  category: string
  details?: { filename: string; reasons: string[] }[]
}

export interface ExpiryBucket {
  label: string
  period: string
  rent: number
  count: number
  pct: number
  leases: { filename: string; date: string; rent: number }[]
}

export interface CategoryBreakdown {
  category: string
  count: number
}

export interface KeyMetric {
  label: string
  value: string
  icon: string
  status?: "green" | "amber" | "red"
}

export interface DocumentInsight {
  id: string
  filename: string
  category: string
  confidence: number
  summary: string | null
  parties?: string[]
  key_terms?: Record<string, string>
  expiry_date?: string
  has_signature?: boolean
  has_seal?: boolean
  is_incomplete?: boolean
  incompleteness_reasons?: string[]
}

export interface AiRationale {
  summary: string
  verdict: "risky" | "good" | "mixed"
  positives: string[]
  concerns: string[]
  actions: string[]
}

export interface DealInsights {
  risk_score: number
  risk_band: RiskBand
  dimensions: {
    completeness: DimensionScore
    lease_risk: DimensionScore
    financial_risk: DimensionScore
  }
  circuit_breakers: CircuitBreaker[]
  risk_drivers: RiskDriver[]
  missing_items: MissingItem[]
  key_metrics: KeyMetric[]
  wault: number | null
  expiry_timeline: ExpiryBucket[]
  category_breakdown: CategoryBreakdown[]
  document_insights: DocumentInsight[]
  total_documents: number
  processed_documents: number
  /** Generated during processing by OpenAI and stored permanently. */
  ai_rationale?: AiRationale | null
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDealInsights(dealId: string | null): {
  insights: DealInsights | null
  loading: boolean
  refresh: () => void
} {
  const { getToken } = useAuth()
  const [insights, setInsights] = React.useState<DealInsights | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [tick, setTick] = React.useState(0)
  const getTokenRef = React.useRef(getToken)
  React.useEffect(() => { getTokenRef.current = getToken }, [getToken])

  React.useEffect(() => {
    if (!dealId) return
    let cancelled = false
    setLoading(true)

    async function fetchInsights() {
      try {
        const token = await getTokenRef.current()
        if (!token || cancelled) return
        const res = await fetch(`${BACKEND_URL}/api/deals/${dealId}/insights`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok || cancelled) return
        const body = await res.json()
        if (!cancelled) {
          setInsights(body.data ?? null)
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchInsights()
    return () => { cancelled = true }
  }, [dealId, tick])

  const refresh = React.useCallback(() => setTick((t) => t + 1), [])

  return { insights, loading, refresh }
}
