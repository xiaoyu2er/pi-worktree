# pi-worktree

Git worktree management for [Pi Coding Agent](https://github.com/badlogic/pi-mono). Create isolated dev environments with one command — each with its own branch, database, dependencies, and ports.

Inspired by `claude --worktree` from Claude Code.

## Why?

When working on multiple features in parallel (or running multiple AI coding agents), you need full isolation — not just a git branch, but separate `node_modules`, databases, env files, and dev server ports. Git worktrees provide the branch isolation; **pi-worktree** automates everything else via project-level hooks.

**One command** gets you:
- A fresh git worktree on its own branch
- A dedicated database (via `createdb` or any command you configure)
- A generated `.env.local` with worktree-specific config
- Installed dependencies (`npm install` / `bun install`)
- Applied migrations or schema pushes
- Pi running in the worktree directory, ready to code

## Install

```bash
pi install pi-worktree
```

If Pi is already running, use `/reload` to pick up the new extension.

## Usage

```bash
# Create a worktree and start Pi in it
pi --worktree my-feature

# Auto-generated name (e.g. "calm-fox")
pi --worktree

# From within a Pi session
/worktree my-feature
/worktree destroy my-feature
/worktree list
```

When cmux or tmux is detected, Pi relaunches itself in the worktree directory within the same terminal. Without a multiplexer, it prints the path for manual `cd && pi`.

## Project configuration

Create `.pi/worktree.json` in your repo root (commit it so all contributors share the same setup). Run `/skill:worktree-setup` for interactive setup, or create it manually:

```json
{
  "dir": ".worktrees",
  "branchPrefix": "worktree/",
  "linkEnvFiles": true,
  "postCreate": [
    "npm install",
    "npx prisma db push"
  ],
  "preRemove": [
    "dropdb --if-exists myapp_$(basename $PWD) 2>/dev/null || true"
  ]
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `dir` | `.worktrees` | Directory for worktrees (relative to repo root) |
| `branchPrefix` | `worktree/` | Branch name prefix |
| `linkEnvFiles` | `true` | Symlink gitignored `.env*` files (except `.env.local`) from main repo |
| `postCreate` | `[]` | Shell commands run after creation (cwd = worktree) |
| `preRemove` | `[]` | Shell commands run before removal (cwd = worktree) |

Don't forget to add the worktree directory to `.gitignore`:

```
.worktrees/
```

## How it works

**Create** (`pi --worktree my-feature` or `/worktree my-feature`):

1. `git worktree add -b worktree/my-feature .worktrees/my-feature HEAD`
2. Symlinks gitignored `.env*` files (except `.env.local`) from the main repo
3. Runs each `postCreate` command in order
4. Relaunches Pi in the worktree directory

**Destroy** (`/worktree destroy my-feature`):

1. Runs each `preRemove` command
2. `git worktree remove --force .worktrees/my-feature`
3. `git branch -D worktree/my-feature`

**Relaunch strategy:** Pi's tools (bash, read, edit, etc.) bind to the working directory at startup via closure — there is no way to change it mid-session. When a worktree is created from the main repo, Pi shuts down and injects `cd <worktree> && pi` into the terminal via `cmux send` or `tmux send-keys`, so Pi restarts with the correct cwd.

## Examples

### Node.js + PostgreSQL + Prisma

Each worktree gets its own database and `.env.local`:

```json
{
  "postCreate": [
    "printf 'DATABASE_URL=postgres://localhost:5432/myapp_%s\\n' $(basename $PWD) > .env.local",
    "createdb myapp_$(basename $PWD) 2>/dev/null || true",
    "npm install",
    "npx prisma db push"
  ],
  "preRemove": [
    "dropdb --if-exists myapp_$(basename $PWD) 2>/dev/null || true"
  ]
}
```

### Bun monorepo with per-worktree staging

For monorepos where each worktree needs a unique stage name (for isolated dev server ports), database, and environment:

```json
{
  "postCreate": [
    "WT=$(basename $PWD); DB=myapp_$(echo $WT | tr '-' '_'); printf 'STAGE=%s\\nDATABASE_URL=postgres://localhost:5432/%s\\n' \"$WT\" \"$DB\" > .env.local",
    "DB=$(grep DATABASE_URL .env.local | sed 's|.*/||'); createdb \"$DB\" 2>/dev/null || true",
    "bun install",
    "bun run prisma:generate",
    "bun run prisma:push"
  ],
  "preRemove": [
    "DB=$(grep DATABASE_URL .env.local 2>/dev/null | sed 's|.*/||'); [ -n \"$DB\" ] && dropdb --if-exists \"$DB\" 2>/dev/null || true"
  ]
}
```

This pattern works well for projects that derive dev server ports from the stage name, giving each worktree fully isolated services.

## Update

```bash
pi update pi-worktree
```

## License

MIT
