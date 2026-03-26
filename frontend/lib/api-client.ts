import { toast } from "sonner"
import type { useAuth } from "@clerk/nextjs"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

type GetToken = ReturnType<typeof useAuth>["getToken"]

/** Standard backend response shape */
interface ApiResponse<T> {
  success: boolean
  data: T | null
  error: { code: string; message: string } | null
}

/**
 * Centralized API client for backend calls.
 * Automatically attaches Clerk JWT, unwraps ApiResponse, and shows toast on errors.
 */
export async function apiFetch<T = unknown>(
  path: string,
  getToken: GetToken,
  options?: RequestInit,
): Promise<T | null> {
  try {
    const token = await getToken()
    if (!token) {
      toast.error("Authentication required", {
        description: "Please sign in to continue.",
      })
      return null
    }

    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options?.headers,
      },
    })

    const body: ApiResponse<T> = await res.json().catch(() => ({
      success: false,
      data: null,
      error: { code: "PARSE_ERROR", message: "Invalid response from server" },
    }))

    if (!res.ok || !body.success) {
      const code = body.error?.code || "ERROR"
      const message = body.error?.message || `Request failed (${res.status})`

      switch (res.status) {
        case 401:
          toast.error("Session expired", { description: "Please sign in again." })
          break
        case 403:
          toast.error("Access denied", { description: message })
          break
        case 404:
          toast.error("Not found", { description: message })
          break
        case 413:
          toast.error("Upload too large", { description: message })
          break
        case 422:
          toast.error("Validation error", { description: message })
          break
        case 429:
          toast.error("Too many requests", { description: "Please wait a moment and try again." })
          break
        case 500:
        case 502:
        case 503:
          toast.error("Server error", { description: "Something went wrong. Please try again later." })
          break
        default:
          toast.error("Request failed", { description: message })
      }
      return null
    }

    return body.data
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[apiFetch] Network error:", message)
    toast.error("Connection error", {
      description: `Unable to reach the server: ${message}`,
    })
    return null
  }
}
