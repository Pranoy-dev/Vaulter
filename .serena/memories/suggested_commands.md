# Suggested Commands

## Dev server
```powershell
npm run dev --prefix d:\Project\Vaulter\vaulter
# or from within vaulter/:
cd d:\Project\Vaulter\vaulter
npx next dev   # if npm scripts fail
```
Access at http://localhost:3000

## Install packages
```powershell
cd d:\Project\Vaulter\vaulter
npm install <package>
```
Note: pnpm is NOT available. Use npm.

## Lint
```powershell
cd d:\Project\Vaulter\vaulter
npx eslint .
```

## Build
```powershell
npm run build --prefix d:\Project\Vaulter\vaulter
```

## Git utilities (PowerShell — no `rg` available)
- File search: use `grep_search` tool or `Select-String` in PowerShell
- Directory listing: `Get-ChildItem` or `dir`

## Important notes
- Next.js 16 uses `proxy.ts` instead of `middleware.ts` — always create proxy.ts for middleware
- AGENTS.md says to read `node_modules/next/dist/docs/` before writing Next.js code
