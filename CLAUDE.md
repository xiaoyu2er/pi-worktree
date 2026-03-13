# CLAUDE.md

## Project

pi-worktree — Git worktree management extension for Pi Coding Agent. Single source file `extensions/worktree.ts`.

## Commands

```bash
bun test              # Run tests (32 tests)
bun run lint          # Biome check + tsc --noEmit
bun run lint:fix      # Auto-fix formatting
```

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.) — release-please automates versioning
- **No `any`**: Biome enforces `noExplicitAny: error` on all files
- **No Chinese**: Source and test code in English only
- **Exports**: Pure functions are named exports for testability; extension factory is the default export
- **Types**: Use `ExtensionCommandContext` for command handlers, `ExtensionContext` for event handlers
