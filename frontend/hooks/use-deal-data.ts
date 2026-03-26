"use client"

import * as React from "react"
import { useAuth } from "@clerk/nextjs"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""

// ── Types matching backend responses ─────────────────────────────────────────

export interface DealDocument {
  id: string
  deal_id: string
  original_path: string
  filename: string
  file_extension: string | null
  file_type: string | null
  file_size: number
  assigned_category: string
  classification_confidence: number
  rag_indexed: boolean
  rag_indexed_at: string | null
  classified_at: string | null
  created_at: string
}

export interface DuplicateMember {
  id: string
  document_id: string
  is_canonical: boolean
  filename: string | null
  original_path: string | null
}

export interface DuplicateGroup {
  id: string
  group_name: string
  match_type: "exact" | "near"
  members: DuplicateMember[]
}

export interface LeaseChainDocument {
  id: string
  document_id: string
  doc_type: string
  amendment_number: number | null
  is_orphaned: boolean
  filename: string | null
  original_path: string | null
}

export interface LeaseChain {
  id: string
  tenant_name: string
  tenant_identifier: string | null
  documents: LeaseChainDocument[]
}

export interface DealData {
  documents: DealDocument[]
  duplicates: DuplicateGroup[]
  leaseChains: LeaseChain[]
  skippedFiles: string[]
  loading: boolean
  /** refetch all data */
  refresh: () => void
}

async function authedGet<T>(
  path: string,
  getToken: () => Promise<string | null>,
): Promise<T | null> {
  const token = await getToken()
  if (!token) return null
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const body = await res.json()
  return (body.data ?? null) as T
}

export function useDealData(dealId: string | null): DealData {
  const { getToken } = useAuth()
  const [documents, setDocuments] = React.useState<DealDocument[]>([])
  const [duplicates, setDuplicates] = React.useState<DuplicateGroup[]>([])
  const [leaseChains, setLeaseChains] = React.useState<LeaseChain[]>([])
  const [skippedFiles, setSkippedFiles] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(false)
  const [tick, setTick] = React.useState(0)

  React.useEffect(() => {
    if (!dealId) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      authedGet<{ documents: DealDocument[]; total: number }>(
        `/api/deals/${dealId}/documents`,
        getToken,
      ),
      authedGet<{ groups: DuplicateGroup[] }>(
        `/api/deals/${dealId}/duplicates`,
        getToken,
      ),
      authedGet<{ chains: LeaseChain[] }>(
        `/api/deals/${dealId}/lease-chains`,
        getToken,
      ),
      authedGet<{ id: string; skipped_files: string[] | null }>(
        `/api/deals/${dealId}`,
        getToken,
      ),
    ]).then(([docsRes, dupsRes, chainsRes, dealRes]) => {
      if (cancelled) return
      setDocuments(docsRes?.documents ?? [])
      setDuplicates(dupsRes?.groups ?? [])
      setLeaseChains(chainsRes?.chains ?? [])
      setSkippedFiles(dealRes?.skipped_files ?? [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [dealId, getToken, tick])

  const refresh = React.useCallback(() => setTick((t) => t + 1), [])

  return { documents, duplicates, leaseChains, skippedFiles, loading, refresh }
}
