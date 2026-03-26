# Code Style & Conventions

## TypeScript
- Strict mode enabled (`"strict": true` in tsconfig)
- Use `type` imports where possible
- No `any` types

## File naming
- React components: PascalCase filename (e.g. `AppSidebar.tsx`) but the project uses kebab-case for files (e.g. `app-sidebar.tsx`)
- Utilities: kebab-case (e.g. `use-mobile.ts`)
- Path alias: `@/` maps to `vaulter/` root

## Component conventions
- Use `"use client"` directive for client components
- shadcn/ui components live in `components/ui/`
- Feature code lives in `features/<feature-name>/`

## Imports
- Use double quotes for strings (existing code uses double quotes predominantly)
- Use named exports for components

## CSS
- Tailwind CSS v4 utility classes
- `cn()` helper from `lib/utils.ts` for conditional class merging

## Task completion checklist
- Run lint: `npx eslint .` from `vaulter/`
- Verify no TypeScript errors with `npx tsc --noEmit`
- Check dev server starts without errors
