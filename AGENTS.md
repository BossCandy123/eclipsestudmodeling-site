# Repository Guidelines

## Project Structure & Module Organization
This repository is a small ESM Node prototype for a GPT rewards crediting dashboard. Keep code organized by runtime role:
- `src/` contains application logic and browser code such as `crediting-engine.js`, `postback-security.js`, and `app.js`.
- `test/` contains Node test files such as `crediting-engine.test.mjs`.
- Root files hold the static shell: `index.html`, `styles.css`, `server.js`, and `package.json`.

Prefer adding new domain logic under `src/` and keeping the root limited to entrypoints and static assets.

## Build, Test, and Development Commands
Use the scripts already defined in [package.json](</C:/Users/bossc/OneDrive/Documents/GPT WEBSITE PLAN/package.json>):
- `npm run dev` starts the local static server on `http://127.0.0.1:4173/`.
- `npm test` runs the full test suite with Node’s built-in test runner.
- `npm run check` performs syntax checks on the main JavaScript modules.

Run `npm test` and `npm run check` before opening a pull request.

## Coding Style & Naming Conventions
Use 2-space indentation in JavaScript, JSON, HTML, CSS, and Markdown. This project uses native ESM, so prefer `import`/`export` and keep modules focused.

Naming patterns:
- `camelCase` for functions and variables
- `UPPER_CASE` only for shared constants
- `kebab-case` for filenames where practical

Keep UI text honest and evidence-based; this project intentionally avoids vague reward states and hype-driven copy.

## Testing Guidelines
Tests use `node:test` and `node:assert/strict`. Place new coverage in `test/*.test.mjs` and name tests after the behavior they prove, for example `duplicate postbacks do not double-credit`.

Prioritize tests around:
- ledger transitions
- postback validation and idempotency
- dispute and manual review behavior
- balance visibility (`available`, `pending`, `rejected`)

## Commit & Pull Request Guidelines
This repository does not have commit history yet, so no local convention exists to mirror. Use clear Conventional Commit style messages such as `feat: add payout hold checks` or `fix: prevent duplicate provider credits`.

Pull requests should include a short summary, verification commands run, screenshots for UI changes, and any known limits or follow-up work.

## Security & Configuration Tips
Do not commit provider secrets, API keys, or payout credentials. Keep signature secrets and future provider configuration in environment variables rather than hardcoding them in `src/`.
