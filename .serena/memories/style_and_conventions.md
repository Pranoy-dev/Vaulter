# Code Style & Conventions

## TypeScript (Frontend)
- Strict mode (`"strict": true` in tsconfig)
- Use `type` imports where possible: `import type { Deal } from "@/lib/types"`
- No `any` types
- Named exports for components

## File naming
- Components: kebab-case filename (e.g. `app-sidebar.tsx`, `header-nav.tsx`)
- Hooks: kebab-case with `use-` prefix (e.g. `use-deal-data.ts`)
- Path alias `@/` maps to `d:\Project\DataRoomAI\frontend\` root

## Component conventions
- `"use client"` directive for client components
- shadcn/ui components in `components/ui/`
- Feature-scoped code in `features/<feature-name>/`
- `cn()` from `lib/utils.ts` for conditional class merging (Tailwind v4)

## String quoting
- TypeScript: double quotes (existing code uses double quotes)
- Python: double quotes preferred; follow existing file style

## Python (Backend)
- FastAPI + Pydantic v2 schemas in `app/models/schemas.py`
- All routes return `ApiResponse` — no bare dicts or raw strings
- DB access via `get_supabase()` from `app.db.client`
  - Never use `.single()` or `.maybe_single()` — use `.execute()` and check `result.data`
  - Access first row as `result.data[0]` after checking `if result.data:`
- Auth: use `Depends(get_current_user_id)` or `CurrentUserId` alias
- Error codes: UPPER_SNAKE_CASE (e.g. `NOT_FOUND`, `VALIDATION_ERROR`, `DB_UNAVAILABLE`)
- Logging: use `logging.getLogger("dataroom")` for app logs (already at DEBUG level)

## Migrations
- Use Alembic for schema changes: `alembic revision --autogenerate -m "description"` then `alembic upgrade head`
- Run from `backend/` directory

## Task completion checklist
- **Frontend lint**: `pnpm lint` from `frontend/`
- **Frontend type-check**: `npx tsc --noEmit` from `frontend/`
- **Backend**: no automated tests; manually verify changed endpoints respond correctly
