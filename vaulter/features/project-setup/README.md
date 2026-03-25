# Project Setup

## What this module does

UI for the **Project Setup** step after creating a project: side assistant chat (Assistant-UI + AI SDK) and a workspace with toggles for **AI Insights**, **File Structure**, **Duplication**, and **Lease Amendment**.

## Public API

- `ProjectSetupScreen` — full layout (assistant + workspace toggles).
- `ProjectSetupAssistant` — chat panel only (`AssistantRuntimeProvider` + `Thread`).

## External dependencies

- `@assistant-ui/react`, `@assistant-ui/react-ai-sdk`
- Vercel AI SDK (`ai`, `@ai-sdk/openai`) and `POST /api/chat`
- `OPENAI_API_KEY` in `.env.local` (see `.env.example`)
