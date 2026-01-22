# Agentic Coding Guide for claude-mem

This document provides instructions for AI agents (Claude, ChatGPT, etc.) working on this codebase.

## Project Overview
`claude-mem` is a memory compression system for Claude Code that persists context across sessions. It uses a worker service architecture with a plugin system.

## Build & Development Commands

*   **Runtime:** Node.js (>=18) and Bun (>=1.0.0).
*   **Build:** `npm run build` (Builds hooks)
*   **Build & Sync:** `npm run build-and-sync` (Builds, syncs to marketplace, restarts worker)
*   **Start Worker:** `npm run worker:start` (via Bun)
*   **Type Check:** The project uses TypeScript with `"strict": true`. Ensure no type errors are introduced.

### Testing
The project uses `bun test` for testing.

*   **Run all tests:** `npm run test` (or `bun test`)
*   **Run specific suites:**
    *   `npm run test:sqlite`
    *   `npm run test:agents`
*   **Run a single test file:**
    ```bash
    bun test tests/path/to/test-file.test.ts
    ```
*   **Run a specific test case:**
    ```bash
    bun test -t "test name pattern"
    ```

## Code Style & Conventions

### TypeScript & Imports
*   **Strict Mode:** TypeScript strict mode is enabled. Avoid `any` where possible.
*   **ESM Imports:** You **MUST** use the `.js` extension for local relative imports.
    *   **Correct:** `import { logger } from '../utils/logger.js';`
    *   **Incorrect:** `import { logger } from '../utils/logger';`
*   **Module Resolution:** NodeNext/ESNext.

### Formatting
*   **Indentation:** 2 spaces.
*   **Semicolons:** Always use semicolons.
*   **Quotes:** Single quotes preferred for strings.

### Naming Conventions
*   **Classes:** PascalCase (e.g., `WorkerService`, `DatabaseManager`).
*   **Files:** Kebab-case for general files (`worker-service.ts`) or PascalCase for Class files (`WorkerService.ts`) depending on directory convention. Follow existing patterns in the specific directory.
*   **Variables/Functions:** camelCase (e.g., `initializationComplete`, `startSessionProcessor`).
*   **Constants:** SCREAMING_SNAKE_CASE (e.g., `USER_SETTINGS_PATH`).

### Error Handling & Logging
*   **Logger:** Use the centralized logger, do not use `console.log` for production code.
    ```typescript
    import { logger } from '../utils/logger.js';
    logger.info('SYSTEM', 'Message', { metadata });
    logger.error('SYSTEM', 'Error message', {}, error);
    ```
*   **Try/Catch:** Wrap async operations in try/catch blocks where failures are expected, specifically in the worker service loop.

## Architecture Notes
*   **Worker Service:** The core logic resides in `src/services/worker-service.ts`. It orchestrates specialized modules.
*   **Infrastructure:** Process management and health checks are in `src/services/infrastructure/`.
*   **Persistence:** SQLite is used, managed via `DatabaseManager`.

## Prohibited Patterns
*   Do not remove the `.js` extension from imports.
*   Do not introduce circular dependencies.
*   Do not use `console.log` in the worker service (use `logger`).
