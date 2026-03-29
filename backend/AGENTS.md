# Backend Agent Instructions

## API Response Convention

All endpoints must return the common `ApiResponse<T>` wrapper from `app.models.schemas`.

```json
{
  "success": true | false,
  "data": T | null,
  "error": { "code": "ERROR_CODE", "message": "Human-readable message" } | null
}
```

### How to use

```python
from app.models.schemas import ApiResponse

# Success
return ApiResponse.ok({"id": "abc", "name": "My Deal"})

# Failure
return ApiResponse.fail("NOT_FOUND", "Deal not found")
```

### Rules

- **Every endpoint** returns `ApiResponse`. No bare dicts, no raw strings.
- For success, use `ApiResponse.ok(data)`.
- For expected errors, use `ApiResponse.fail(code, message)`.
- For unexpected errors, global exception handlers in `main.py` catch them and wrap automatically.
- Raise `HTTPException` for 4xx errors — the global handler converts them to `ApiResponse.fail()`.
- **Error codes** are UPPER_SNAKE_CASE (e.g. `NOT_FOUND`, `VALIDATION_ERROR`, `DB_UNAVAILABLE`, `UNAUTHORIZED`).
- Do **not** return `JSONResponse` or plain dicts from route handlers.

## Database Access

- Use `get_supabase()` from `app.db.client` for Supabase client queries.
- When querying for a single row, use `.execute()` and check `result.data` (a list). Do **not** use `.maybe_single()` or `.single()` — both throw or return `None` instead of a safe empty result.
- Access the first row as `result.data[0]`, after checking `if result.data:`.

## Auth

- Use `Depends(get_current_user_id)` (or the alias `CurrentUserId`) from `app.auth` for protected endpoints.
- The dependency verifies the Clerk JWT and ensures the user row exists in the DB.

## Running the Backend

### Critical: use `combined_app`, not `app`

The FastAPI `app` is wrapped in `socketio.ASGIApp` as `combined_app` (bottom of `main.py`).
You **must** point uvicorn at `app.main:combined_app` — using `app.main:app` causes all Socket.IO
`/socket.io/` requests to return 404.

### Critical: Windows cwd issue

On Windows the integrated terminal tool resets `cwd` to the workspace root even after `Set-Location` / `Push-Location`. The only reliable fix is to launch a **separate PowerShell process** with the correct working directory:

```powershell
# Start API (run from anywhere — cwd is forced inside the new process)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location 'd:\Project\DataRoomAI\backend'; uvicorn app.main:combined_app --reload --host 0.0.0.0 --port 8000"
```

### Full clean-restart sequence

```powershell
# 1. Kill everything
Get-Process -Name "node","python","uvicorn" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 2. Start API
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location 'd:\Project\DataRoomAI\backend'; uvicorn app.main:combined_app --reload --host 0.0.0.0 --port 8000"

# 3. Start UI
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location 'd:\Project\DataRoomAI\frontend'; pnpm dev"

# 4. Verify (after a few seconds)
Invoke-WebRequest http://localhost:8000/api/health -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://localhost:3000 -UseBasicParsing | Select-Object StatusCode
```

**Why `combined_app`?** `uvicorn --reload` spawns a reloader parent + worker child. The worker
imports the module and serves requests. If you point it at the bare `app`, the `socketio.ASGIApp`
wrapper that mounts `/socket.io/` is never activated.

**Why kill all processes?** `uvicorn --reload` spawns a reloader parent + a worker child.
Killing just the worker causes the reloader to immediately spawn a new one. Kill the full tree with `Stop-Process`.
