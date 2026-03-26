"use client"

import { useAuth } from "@clerk/nextjs"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { apiFetch } from "@/lib/api-client"

interface MeResponse {
  synced: boolean
  created: boolean
  name?: string | null
}

/**
 * Calls /api/me on the backend after Clerk sign-in to ensure the user
 * row exists in the database. Runs once per session.
 */
export function useUserSync() {
  const { getToken, isSignedIn } = useAuth()
  const hasSynced = useRef(false)

  useEffect(() => {
    if (!isSignedIn || hasSynced.current) return

    const sync = async () => {
      const result = await apiFetch<MeResponse>("/api/me", getToken)
      if (result) {
        hasSynced.current = true
        if (result.created) {
          toast.success("Account created", {
            description: "Welcome to DataRoom AI!",
          })
        }
      }
    }

    sync()
  }, [isSignedIn, getToken])
}
