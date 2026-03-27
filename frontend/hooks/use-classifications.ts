"use client"

import * as React from "react"
import { useAuth } from "@clerk/nextjs"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""

export interface Classification {
  id: string
  company_id: string
  key: string
  label: string
  description: string | null
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
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

export function useClassifications() {
  const { getToken } = useAuth()
  const [classifications, setClassifications] = React.useState<Classification[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    authedGet<{ classifications: Classification[] }>("/api/classifications", getToken).then(
      (res) => {
        if (cancelled) return
        setClassifications(res?.classifications ?? [])
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [getToken])

  return { classifications, loading }
}
