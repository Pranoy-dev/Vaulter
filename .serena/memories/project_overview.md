# Vaulter — Project Overview

## Purpose
Vaulter is a Next.js-based AI-assisted project management / workspace tool.
It uses an AI chat assistant (OpenAI GPT-4o via assistant-ui) to help users set up and manage projects.
Auth is handled by Clerk.

## Tech Stack
- **Framework**: Next.js 16.2.1 (App Router, Turbopack) — NOTE: this has breaking changes vs older Next.js, read `node_modules/next/dist/docs/` before writing code
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4
- **UI Components**: Radix UI primitives + shadcn/ui components
- **AI**: OpenAI GPT-4o via `@ai-sdk/openai`, `@assistant-ui/react`
- **Auth**: Clerk (`@clerk/nextjs` v7)
- **State**: Zustand
- **Package manager**: npm (pnpm is NOT available in this environment)

## Project Structure
```
d:\Project\Vaulter\
  package.json          # root — just scripts that delegate to vaulter/
  vaulter/              # actual Next.js app
    app/
      layout.tsx        # ClerkProvider + auth header (SignIn/SignUp/UserButton)
      page.tsx          # re-exports dashboard page
      dashboard/page.tsx
      api/chat/route.ts # streaming OpenAI API route
      sign-in/[[...sign-in]]/page.tsx
      sign-up/[[...sign-up]]/page.tsx
    components/
      app-sidebar.tsx
      assistant-ui/     # AI chat components
      ui/               # shadcn/ui components
    features/
      project-setup/    # project setup flow with AI assistant
    hooks/
    lib/utils.ts
    proxy.ts            # Clerk auth protection (Next.js 16 uses proxy.ts NOT middleware.ts)
    .env.local          # Clerk keys + OpenAI key (committed to git)
```

## Auth
- Clerk handles all auth; user data stored on Clerk servers
- `proxy.ts` protects all routes except `/sign-in` and `/sign-up`
- Use `auth()` / `currentUser()` from `@clerk/nextjs/server` in server components
