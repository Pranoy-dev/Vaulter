# DataRoom AI — Project Overview

## Purpose
DataRoom AI is a full-stack AI-powered document intelligence platform for due diligence / data rooms.
Users upload deal documents; the platform extracts text, classifies documents, deduplicates, links leases, runs AI summarisation/Q&A, and surfaces insights via a chat assistant.

## Tech Stack

### Frontend (d:\Project\DataRoomAI\frontend\)
- **Framework**: Next.js 16.2.1 (App Router, Turbopack) — APIs may differ from training data; read `node_modules/next/dist/docs/` before writing code.
- **Language**: TypeScript strict mode
- **Styling**: Tailwind CSS v4
- **UI**: Radix UI + shadcn/ui (`components/ui/`)
- **AI Chat**: `@assistant-ui/react`, `@ai-sdk/openai`, `ai` (streaming)
- **Auth**: Clerk (`@clerk/nextjs` v7)
- **State**: Zustand v5
- **Real-time**: Socket.IO client v4 (`socket.io-client`)
- **Toasts**: sonner
- **Validation**: zod v4
- **Package manager**: **pnpm** (pnpm-lock.yaml present; `npm` also works in a pinch)
- **Path alias**: `@/` → frontend root (`d:\Project\DataRoomAI\frontend\`)

### Backend (d:\Project\DataRoomAI\backend\)
- **Framework**: FastAPI 0.115+, Python 3.11+
- **DB**: Supabase Postgres (SQLAlchemy + Alembic migrations)
- **Storage**: Supabase Storage bucket `dataroom-files`
- **AI**: OpenAI (chat/embeddings), Google Gemini (`google-genai`) for document processing
- **Real-time**: Socket.IO (`socketio.ASGIApp`) — MUST use `combined_app`
- **Auth**: Clerk JWT verification (`app/auth.py`)
- **Schema migrations**: Alembic (`backend/migrations/versions/`)

## Frontend Structure
```
frontend/
  app/
    layout.tsx         # ClerkProvider + theme
    page.tsx           # root
    dashboard/page.tsx # main dashboard
    api/chat/          # streaming AI chat route
    sign-in/, sign-up/
  components/
    app-sidebar.tsx
    header-nav.tsx
    processing-status-panel.tsx
    theme-toggle.tsx
    assistant-ui/      # AI chat UI components
    ui/                # shadcn/ui components
  features/
    project-setup/     # deal creation wizard
  hooks/               # use-deal-data, use-processing-status, use-classifications, etc.
  lib/
    api-client.ts      # apiFetch() — all backend calls go through here
    chunked-upload.ts
    utils.ts           # cn() helper
  proxy.ts             # Clerk auth middleware (Next.js 16 uses proxy.ts NOT middleware.ts)
```

## Backend Structure
```
backend/
  app/
    main.py            # FastAPI app + combined_app (Socket.IO wrapper) + lifespan
    auth.py            # get_current_user_id / CurrentUserId dependency
    config.py          # pydantic-settings (reads .env)
    socketio_server.py # Socket.IO server instance
    db/
      client.py        # get_supabase()
      models.py        # SQLAlchemy models
    models/schemas.py  # ApiResponse, Pydantic schemas
    routers/           # deals, upload, processing, webhooks, classifications, chat, search
    services/          # chat_engine, document_classifier, duplicate_detection,
                       # embeddings, gemini_processor, lease_linker, storage, text_extractor
  migrations/versions/ # Alembic migration scripts
```

## API Response Convention
Every endpoint returns `ApiResponse<T>`:
```json
{ "success": true, "data": T, "error": null }
{ "success": false, "data": null, "error": { "code": "NOT_FOUND", "message": "..." } }
```
- Backend: use `ApiResponse.ok(data)` / `ApiResponse.fail(code, message)`
- Frontend: use `apiFetch<T>()` from `lib/api-client.ts` — handles JWT, unwraps envelope, shows toasts. Never call `fetch()` directly for backend APIs.

## Auth
- Clerk handles all auth; JWT verified in backend using `Depends(get_current_user_id)` / `CurrentUserId`
- `proxy.ts` protects all routes except `/sign-in` and `/sign-up`
- Server components: `auth()` / `currentUser()` from `@clerk/nextjs/server`
