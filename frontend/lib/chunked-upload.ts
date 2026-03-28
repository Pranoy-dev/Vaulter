/**
 * Chunked / resumable file upload client.
 *
 * Splits each file into chunks, sends them to the backend one-by-one,
 * queries progress on resume, and calls /complete when every chunk is in.
 */

import type { useAuth } from "@clerk/nextjs"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? ""
const CONCURRENT_CHUNKS = 3

type GetToken = ReturnType<typeof useAuth>["getToken"]

// ── Types ────────────────────────────────────────────────────────────────────

export const ACCEPTED_EXTENSIONS = new Set([
  ".pdf", ".docx", ".xlsx", ".pptx", ".msg", ".eml",
  ".png", ".jpg", ".jpeg", ".gif", ".tiff", ".bmp", ".webp", ".heic", ".heif",
  ".txt", ".csv", ".html", ".htm", ".xml", ".rtf", ".md", ".json",
])

export function isSupported(relativePath: string): boolean {
  const ext = relativePath.slice(relativePath.lastIndexOf(".")).toLowerCase()
  return ACCEPTED_EXTENSIONS.has(ext)
}

export interface FileEntry {
  file: File
  /** Relative path preserving folder structure (e.g. "Leases/Tenant A/doc.pdf") */
  relativePath: string
}

export interface UploadProgress {
  /** 0-1 overall progress */
  overall: number
  /** Per-file progress keyed by relativePath */
  files: Record<string, FileUploadProgress>
  /** Current state */
  state: "idle" | "initializing" | "uploading" | "completing" | "done" | "error"
  error?: string
}

export interface FileUploadProgress {
  relativePath: string
  totalChunks: number
  uploadedChunks: number
  fileSize: number
  /** 0-1 */
  progress: number
}

interface InitResponse {
  session_id: string
  deal_id: string
  chunk_size: number
}

interface ChunkResponse {
  relative_path: string
  chunk_index: number
  chunks_received: number
  total_chunks: number
}

interface ProgressResponse {
  deal_id: string
  session_id: string
  files: {
    relative_path: string
    file_size: number
    total_chunks: number
    uploaded_chunks: number[]
  }[]
}

interface CompleteResponse {
  deal_id: string
  files_uploaded: number
  total_size: number
}

export interface UploadResult {
  filesUploaded: number
  totalSize: number
  /** Relative paths of files that were skipped due to unsupported extension */
  skippedFiles: string[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function authedFetch(
  path: string,
  getToken: GetToken,
  init?: RequestInit,
): Promise<Response> {
  const token = await getToken()
  if (!token) throw new Error("Not authenticated")
  return fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  })
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const msg = body?.error?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }
  const body = await res.json()
  if (!body.success) throw new Error(body.error?.message || "Request failed")
  return body.data as T
}

// ── Core upload function ─────────────────────────────────────────────────────

export async function uploadFiles(
  dealId: string,
  files: FileEntry[],
  getToken: GetToken,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  if (files.length === 0) throw new Error("No files to upload")

  const skippedFiles = files.filter((f) => !isSupported(f.relativePath)).map((f) => f.relativePath)
  const supportedFiles = files.filter((f) => isSupported(f.relativePath))

  if (supportedFiles.length === 0) {
    // Nothing uploadable — immediately resolve with skipped list
    onProgress({ overall: 1, files: {}, state: "done" })
    return { filesUploaded: 0, totalSize: 0, skippedFiles }
  }

  // Work only with supported files from here on
  files = supportedFiles

  const progress: UploadProgress = {
    overall: 0,
    files: {},
    state: "initializing",
  }
  const notify = () => onProgress({ ...progress, files: { ...progress.files } })
  notify()

  // 1. Init session
  const initRes = await authedFetch(`/api/deals/${dealId}/upload/init`, getToken, { method: "POST" })
  const { session_id, chunk_size } = await unwrap<InitResponse>(initRes)

  // 2. Check for existing progress (resume)
  let existingChunks: Record<string, Set<number>> = {}
  try {
    const progRes = await authedFetch(
      `/api/deals/${dealId}/upload/progress?session_id=${encodeURIComponent(session_id)}`,
      getToken,
    )
    const progData = await unwrap<ProgressResponse>(progRes)
    for (const f of progData.files) {
      existingChunks[f.relative_path] = new Set(f.uploaded_chunks)
    }
  } catch {
    // No prior progress — fresh session
  }

  // 3. Build per-file chunk plan
  interface ChunkTask {
    fileEntry: FileEntry
    chunkIndex: number
    start: number
    end: number
    totalChunks: number
  }

  const tasks: ChunkTask[] = []

  for (const entry of files) {
    const totalChunks = Math.max(1, Math.ceil(entry.file.size / chunk_size))
    const alreadyDone = existingChunks[entry.relativePath] ?? new Set<number>()

    progress.files[entry.relativePath] = {
      relativePath: entry.relativePath,
      totalChunks,
      uploadedChunks: alreadyDone.size,
      fileSize: entry.file.size,
      progress: totalChunks > 0 ? alreadyDone.size / totalChunks : 0,
    }

    for (let i = 0; i < totalChunks; i++) {
      if (alreadyDone.has(i)) continue // skip already-uploaded chunks
      tasks.push({
        fileEntry: entry,
        chunkIndex: i,
        start: i * chunk_size,
        end: Math.min((i + 1) * chunk_size, entry.file.size),
        totalChunks,
      })
    }
  }

  // If everything was already uploaded (pure resume of complete data)
  const totalChunksAll = Object.values(progress.files).reduce((s, f) => s + f.totalChunks, 0)
  const doneChunksAll = Object.values(progress.files).reduce((s, f) => s + f.uploadedChunks, 0)
  progress.overall = totalChunksAll > 0 ? doneChunksAll / totalChunksAll : 0
  progress.state = "uploading"
  notify()

  // 4. Upload chunks with limited concurrency
  let completedChunks = doneChunksAll

  const uploadOneChunk = async (task: ChunkTask) => {
    if (signal?.aborted) throw new Error("Upload cancelled")

    const blob = task.fileEntry.file.slice(task.start, task.end)
    const form = new FormData()
    form.append("session_id", session_id)
    form.append("relative_path", task.fileEntry.relativePath)
    form.append("chunk_index", String(task.chunkIndex))
    form.append("total_chunks", String(task.totalChunks))
    form.append("file_size", String(task.fileEntry.file.size))
    form.append("chunk", blob, `chunk_${task.chunkIndex}`)

    const res = await authedFetch(`/api/deals/${dealId}/upload/chunk`, getToken, {
      method: "POST",
      body: form,
      signal,
    })
    await unwrap<ChunkResponse>(res)

    // Update progress
    completedChunks++
    const fp = progress.files[task.fileEntry.relativePath]
    fp.uploadedChunks++
    fp.progress = fp.totalChunks > 0 ? fp.uploadedChunks / fp.totalChunks : 1
    progress.overall = totalChunksAll > 0 ? completedChunks / totalChunksAll : 1
    notify()
  }

  // Simple pool: run up to CONCURRENT_CHUNKS at a time
  let idx = 0
  const runNext = async (): Promise<void> => {
    while (idx < tasks.length) {
      const task = tasks[idx++]
      await uploadOneChunk(task)
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENT_CHUNKS, tasks.length) }, () => runNext())
  await Promise.all(workers)

  // 5. Complete
  progress.state = "completing"
  notify()

  const completeForm = new FormData()
  completeForm.append("session_id", session_id)
  completeForm.append("skipped_files", JSON.stringify(skippedFiles))

  const completeRes = await authedFetch(`/api/deals/${dealId}/upload/complete`, getToken, {
    method: "POST",
    body: completeForm,
    signal,
  })
  const result = await unwrap<CompleteResponse>(completeRes)

  progress.state = "done"
  progress.overall = 1
  notify()

  return {
    filesUploaded: result.files_uploaded,
    totalSize: result.total_size,
    skippedFiles,
  }
}
