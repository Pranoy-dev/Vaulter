<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## API Response Convention

All backend endpoints return a common `ApiResponse<T>` envelope:

```json
{
  "success": true | false,
  "data": T | null,
  "error": { "code": "ERROR_CODE", "message": "Human-readable message" } | null
}
```

- **On success**: `success: true`, `data` contains the payload, `error` is `null`.
- **On failure**: `success: false`, `data` is `null`, `error` contains a `code` (e.g. `NOT_FOUND`, `VALIDATION_ERROR`, `DB_UNAVAILABLE`) and a `message`.

### Frontend usage

Use `apiFetch<T>()` from `lib/api-client.ts` for all backend calls. It:
1. Attaches the Clerk JWT automatically.
2. Unwraps the `ApiResponse` envelope — returns `T | null`.
3. Shows contextual sonner toasts on errors (no manual toast handling needed).

```ts
const deal = await apiFetch<Deal>("/api/deals/123", getToken)
if (deal) {
  // deal is typed as Deal, envelope already unwrapped
}
```

Do **not** call `fetch()` directly for backend APIs. Always go through `apiFetch`.
