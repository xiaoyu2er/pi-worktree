---
name: worktree-setup
description: Configure pi-worktree for your project — set up post-create hooks (install deps, create DB, etc.) and pre-remove hooks (drop DB, cleanup).
---

# Worktree Setup

Configure the `pi-worktree` extension for this project by creating `.pi/worktree.json`.

## Interview

Ask the user these questions (propose answers first by inspecting the project):

1. **Worktree directory** — Where to store worktrees? *(default: `.worktrees`)*
2. **Branch prefix** — Branch naming convention? *(default: `worktree/`)*
3. **Post-create steps** — What needs to happen after creating a worktree? Examples:
   - `bun install` / `npm install`
   - Create a database
   - Generate `.env.local`
   - Run migrations / schema push
   - Link env files
4. **Pre-remove steps** — What cleanup before destroying? Examples:
   - Drop database
   - Remove temp files
5. **Link env files?** — Auto-symlink gitignored `.env*` files (except `.env.local`) from main repo? *(default: yes)*

Before asking, inspect the project to propose smart defaults:
- Check for `package.json` (detect package manager)
- Check for `prisma/`, `drizzle/`, or migration directories
- Check for `.env.example` or `.env*` patterns
- Check for `docker-compose.yml`
- Check for `Makefile`, `Taskfile`, `mise.toml`

## Create Config

After collecting answers, create `$GIT_ROOT/.pi/worktree.json`:

```json
{
  "dir": ".worktrees",
  "branchPrefix": "worktree/",
  "linkEnvFiles": true,
  "postCreate": [
    "printf 'DATABASE_URL=postgres://localhost:5432/myapp_'$(basename $PWD) > .env.local",
    "createdb myapp_$(basename $PWD) 2>/dev/null || true",
    "npm install",
    "npx prisma db push"
  ],
  "preRemove": [
    "dropdb --if-exists myapp_$(basename $PWD) 2>/dev/null || true"
  ]
}
```

Adapt the commands to match the actual project setup.

## Add to .gitignore

Ensure the worktree directory is gitignored:

```bash
grep -qxF '.worktrees/' .gitignore || echo '.worktrees/' >> .gitignore
```

## Report

Tell the user:
- Which config file was created
- How to create a worktree: `/worktree create [name]` or `pi --worktree [name]`
- How to destroy: `/worktree destroy <name>`
- How to list: `/worktree list`
