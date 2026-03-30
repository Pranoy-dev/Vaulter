# Suggested Commands

## Start the full stack

```powershell
# Kill anything already running
Get-Process -Name "node","python","uvicorn" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Start backend (combined_app — required for Socket.IO)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location 'd:\Project\DataRoomAI\backend'; uvicorn app.main:combined_app --reload --host 0.0.0.0 --port 8000"

# Start frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location 'd:\Project\DataRoomAI\frontend'; pnpm dev"

# Verify (after a few seconds)
Invoke-WebRequest http://localhost:8000/api/health -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://localhost:3000 -UseBasicParsing | Select-Object StatusCode
```

Frontend: http://localhost:3000  
Backend API: http://localhost:8000

## Backend only (quick restart)
```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location 'd:\Project\DataRoomAI\backend'; uvicorn app.main:combined_app --reload --host 0.0.0.0 --port 8000"
```
**CRITICAL**: always use `combined_app`, never `app` — otherwise Socket.IO returns 404.

## Frontend only
```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location 'd:\Project\DataRoomAI\frontend'; pnpm dev"
```

## Install packages
```powershell
# Frontend (pnpm is available and preferred)
cd d:\Project\DataRoomAI\frontend
pnpm add <package>

# Backend
cd d:\Project\DataRoomAI\backend
pip install <package>
# Then add to pyproject.toml dependencies manually
```

## Lint & type-check (Frontend)
```powershell
cd d:\Project\DataRoomAI\frontend
pnpm lint
npx tsc --noEmit
```

## Build frontend
```powershell
cd d:\Project\DataRoomAI\frontend
pnpm build
```

## Database migrations (Alembic)
```powershell
# Run from backend/ — use a separate process because of Windows cwd issue
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location 'd:\Project\DataRoomAI\backend'; alembic revision --autogenerate -m 'description'"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location 'd:\Project\DataRoomAI\backend'; alembic upgrade head"
```

## Git utilities (PowerShell — rg may be unavailable)
- File search: `grep_search` tool or `Select-String` in PowerShell
- Directory listing: `Get-ChildItem` or `dir`
- Check current state: `git status`, `git diff`

## Important notes
- **Windows cwd bug**: terminal tool resets cwd to workspace root. Always use `Start-Process` with `Set-Location` inside the spawned shell for backend/frontend commands.
- **Next.js 16**: uses `proxy.ts` not `middleware.ts` for Clerk auth middleware
- **pnpm-lock.yaml** is present — prefer `pnpm` over `npm` for frontend
- Read `node_modules/next/dist/docs/` before writing any Next.js-specific code (breaking changes vs older versions)
