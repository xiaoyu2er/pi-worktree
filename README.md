# pi-worktree

Git worktree management for [Pi Coding Agent](https://github.com/badlogic/pi-mono). Create isolated workspaces with one command, optionally launch in [cmux](https://cmux.dev) or tmux.

Inspired by `claude --worktree` from Claude Code.

## What it does

- **`pi --worktree [name]`** — Create (or reuse) a git worktree and start working in it
- **`/worktree create [name]`** — Create a worktree from within Pi, relaunch Pi in the worktree directory
- **`/worktree destroy <name>`** — Remove a worktree, delete the branch
- **`/worktree list`** — List all worktrees
- **Auto-detection** — If Pi starts inside a `.worktrees/<name>/` directory, it sets the session name and status automatically
- **Project hooks** — Configure post-create and pre-remove commands via `.pi/worktree.json`

## Install

```bash
# Global (all projects)
pi install npm:pi-worktree

# Project-local (shared via .pi/settings.json)
pi install -l npm:pi-worktree

# Try without installing
pi -e npm:pi-worktree
```

If Pi is already running, use `/reload` to load newly installed extensions.

## Quick start

```bash
# Create a worktree and start Pi in it
pi --worktree my-feature

# Or from within Pi
/worktree create my-feature

# Auto-generated name if omitted
pi --worktree
/worktree create
```

When cmux or tmux is detected, Pi shuts down and relaunches itself in the worktree directory within the same terminal. The session is named `wt:<name>` for easy identification.

## Project configuration

Run `/skill:worktree-setup` to interactively create `.pi/worktree.json`, or create it manually:

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

### Config options

| Key | Default | Description |
|-----|---------|-------------|
| `dir` | `.worktrees` | Directory for worktrees (relative to repo root) |
| `branchPrefix` | `worktree/` | Branch name prefix |
| `linkEnvFiles` | `true` | Symlink gitignored `.env*` files (except `.env.local`) from main repo |
| `postCreate` | `[]` | Shell commands to run after worktree creation (cwd = worktree) |
| `preRemove` | `[]` | Shell commands to run before worktree removal (cwd = worktree) |

### How it works

When you run `pi --worktree my-feature` or `/worktree create my-feature`:

1. Creates `git worktree add -b worktree/my-feature .worktrees/my-feature HEAD`
2. Symlinks gitignored `.env*` files from the main repo
3. Runs each `postCreate` command in order
4. Relaunches Pi in the worktree directory (via cmux send / tmux send-keys)

When you run `/worktree destroy my-feature`:

1. Runs each `preRemove` command
2. Removes the git worktree (`git worktree remove --force`)
3. Deletes the branch (`git branch -D worktree/my-feature`)

### Multiplexer support

When Pi needs to relaunch in a worktree directory (because tools are bound to cwd at startup), it injects `cd <worktree> && pi` into the terminal after shutting down:

| Multiplexer | Behavior |
|-------------|----------|
| **cmux** | Uses `cmux send` to inject the command into the current terminal |
| **tmux** | Uses `tmux send-keys` to inject the command (only if inside tmux) |
| **Neither** | Prints the path for manual `cd && pi` |

## Update

```bash
pi update pi-worktree
```

## Example: Node.js + Prisma project

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

## Example: Bun monorepo (like Postflare)

```json
{
  "postCreate": [
    "STAGE=$(basename $PWD | tr '/_' '-'); DB=postflare_$(basename $PWD | tr '/-' '_'); printf 'ALCHEMY_STAGE=%s\\nDATABASE_URL=postgres://postgres:postgres@localhost:5432/%s\\n' $STAGE $DB > .env.local",
    "DB=$(grep DATABASE_URL .env.local | sed 's|.*/||'); createdb $DB 2>/dev/null || true",
    "set -a && source .env.local && set +a && bun install",
    "set -a && source .env.local && set +a && bun prisma:push 2>/dev/null || true"
  ],
  "preRemove": [
    "DB=$(grep DATABASE_URL .env.local 2>/dev/null | sed 's|.*/||'); [ -n \"$DB\" ] && dropdb --if-exists $DB 2>/dev/null || true"
  ]
}
```

## License

MIT
