import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, mkdirSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
import { resolve, basename, dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Name generator (adjective-noun)
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  "bright", "calm", "cool", "dark", "dry", "fast", "firm", "flat", "fresh", "gold",
  "green", "keen", "kind", "late", "lean", "live", "long", "loud", "neat", "new",
  "nice", "odd", "old", "pale", "pink", "pure", "rare", "raw", "red", "rich",
  "ripe", "safe", "shy", "slim", "slow", "soft", "sour", "tall", "thin", "warm",
  "weak", "wide", "wild", "wise", "bold", "cold", "deep", "fair", "free", "glad",
];

const NOUNS = [
  "ant", "ape", "bat", "bee", "bug", "cat", "cod", "cow", "cub", "doe",
  "dog", "eel", "elk", "emu", "ewe", "fly", "fox", "gnu", "hen", "hog",
  "jay", "kit", "koi", "lark", "lynx", "moth", "mule", "newt", "owl", "pike",
  "pony", "pug", "ram", "ray", "seal", "slug", "swan", "toad", "wasp", "wren",
  "yak", "bass", "bear", "boar", "buck", "bull", "carp", "clam", "colt", "crab",
];

function generateName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/** Get the real repo root (handles being inside a worktree). */
async function getRepoRoot(pi: ExtensionAPI): Promise<string> {
  // git rev-parse --git-common-dir gives .git for main, ../../.git/worktrees/<name> for worktree
  const r = await pi.exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { timeout: 5_000 });
  if (r.code !== 0) throw new Error("Not inside a git repository");
  // commonDir is e.g. /repo/.git — parent is repo root
  const commonDir = r.stdout.trim();
  return dirname(commonDir);
}

/** Detect if cwd is a worktree under .worktrees/<name>. */
function detectWorktreeName(cwd: string): string | null {
  const m = cwd.match(/\/\.worktrees\/([^/]+)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Config: project-level hooks
// ---------------------------------------------------------------------------

interface WorktreeConfig {
  /** Directory to create worktrees in, relative to repo root. Default: ".worktrees" */
  dir?: string;
  /** Branch prefix. Default: "worktree/" */
  branchPrefix?: string;
  /** Shell commands to run after worktree creation (cwd = worktree). Each string is a separate step. */
  postCreate?: string[];
  /** Shell commands to run before worktree removal (cwd = worktree). */
  preRemove?: string[];
  /** Env files to symlink from main repo (glob-like basenames). Default: all gitignored .env* except .env.local */
  linkEnvFiles?: boolean;
}

function loadConfig(repoRoot: string): WorktreeConfig {
  const configPath = join(repoRoot, ".pi", "worktree.json");
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function getWorktreeDir(repoRoot: string, config: WorktreeConfig): string {
  return resolve(repoRoot, config.dir ?? ".worktrees");
}

function getBranchPrefix(config: WorktreeConfig): string {
  return config.branchPrefix ?? "worktree/";
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  let worktreeName: string | null = null;

  // --- Register --worktree flag ---
  pi.registerFlag("worktree", {
    description: "Create or reuse a git worktree and work inside it. Optionally specify a name.",
    type: "string",
  });

  // --- Auto-detect worktree from cwd, or handle --worktree flag ---
  pi.on("session_start", async (_event, ctx) => {
    // Check --worktree flag first
    const flagValue = pi.getFlag("worktree") as string | boolean | undefined;

    if (flagValue !== undefined && flagValue !== false) {
      // --worktree was passed (with or without a name)
      const name = typeof flagValue === "string" && flagValue.length > 0 ? flagValue : generateName();

      try {
        const repoRoot = await getRepoRoot(pi);
        const config = loadConfig(repoRoot);
        const wtDir = getWorktreeDir(repoRoot, config);
        const worktreePath = join(wtDir, name);
        const branch = `${getBranchPrefix(config)}${name}`;

        // Check if worktree already exists
        const exists = existsSync(worktreePath);
        if (!exists) {
          // Create the worktree
          ctx.ui.setStatus("worktree", `⏳ Creating worktree "${name}"...`);
          await createWorktree(pi, ctx, repoRoot, config, name);
          ctx.ui.setStatus("worktree", `🌿 ${name}`);
        } else {
          ctx.ui.setStatus("worktree", `🌿 ${name} (existing)`);
        }

        // If we're NOT already inside the worktree, we need to tell user to restart
        const detected = detectWorktreeName(ctx.cwd);
        if (detected === name) {
          // Already in the right worktree
          worktreeName = name;
          pi.setSessionName(`wt:${name}`);
        } else {
          // Need to launch pi in the worktree directory
          const launched = await launchInWorktree(pi, ctx, worktreePath, name);
          if (launched) {
            ctx.ui.notify(
              `✅ Worktree "${name}" ready — PI launched in new workspace.\n` +
                `   Path: ${worktreePath}\n` +
                `   Branch: ${branch}`,
              "success",
            );
          } else {
            ctx.ui.notify(
              `✅ Worktree "${name}" ready.\n` +
                `   Path: ${worktreePath}\n` +
                `   Branch: ${branch}\n` +
                `   Start PI there: cd ${worktreePath} && pi`,
              "success",
            );
          }
          ctx.ui.setStatus("worktree", undefined);
          return;
        }
      } catch (err) {
        ctx.ui.setStatus("worktree", undefined);
        ctx.ui.notify(`Failed to set up worktree: ${(err as Error).message}`, "error");
        return;
      }
    } else {
      // Auto-detect from cwd
      worktreeName = detectWorktreeName(ctx.cwd);
    }

    if (worktreeName) {
      pi.setSessionName(`wt:${worktreeName}`);
      ctx.ui.setStatus("worktree", `🌿 ${worktreeName}`);
    }
  });

  // --- Inject worktree context into system prompt ---
  pi.on("before_agent_start", async (event) => {
    if (!worktreeName) return;

    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n## Active Worktree\n` +
        `You are working in git worktree "${worktreeName}".\n` +
        `The current directory is the worktree root. All tools resolve paths relative to it.\n` +
        `Branch: worktree/${worktreeName}\n` +
        `Commit your work to this branch when done.`,
    };
  });

  // --- Commands ---
  // Main command with subcommands
  pi.registerCommand("worktree", {
    description:
      "Git worktree management. Usage: /worktree [name], /worktree create [name], /worktree destroy <name>, /worktree list",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/);
      const sub = parts[0] || "";
      const subArg = parts.slice(1).join(" ").trim();

      switch (sub) {
        case "create":
        case "new":
          return handleCreate(subArg, ctx);
        case "destroy":
        case "remove":
        case "rm":
          return handleDestroy(subArg, ctx);
        case "list":
        case "ls":
          return handleList(ctx);
        case "help":
          ctx.ui.notify(
            "Usage:\n" +
              "  /worktree [name]         — Create a new worktree (auto-generates name if omitted)\n" +
              "  /worktree create [name]  — Same as above\n" +
              "  /worktree destroy <name> — Destroy a worktree\n" +
              "  /worktree list           — List all worktrees\n" +
              "  /worktree help           — Show this help\n" +
              "\n" +
              "Shortcuts: /worktree-create, /worktree-destroy, /worktree-list",
            "info",
          );
          return;
        default:
          // No subcommand or unrecognized word → treat as name for create
          return handleCreate(args?.trim() || "", ctx);
      }
    },
  });

  // Shortcut commands
  pi.registerCommand("worktree-create", {
    description: "Create a new git worktree (shortcut for /worktree create)",
    handler: async (args, ctx) => handleCreate(args?.trim() || "", ctx),
  });

  pi.registerCommand("worktree-destroy", {
    description: "Destroy a git worktree (shortcut for /worktree destroy)",
    handler: async (args, ctx) => handleDestroy(args?.trim() || "", ctx),
  });

  pi.registerCommand("worktree-list", {
    description: "List all git worktrees (shortcut for /worktree list)",
    handler: async (_args, ctx) => handleList(ctx),
  });

  // --- Create handler ---
  async function handleCreate(nameArg: string, ctx: any) {
    const name = nameArg || generateName();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      ctx.ui.notify("Name must be alphanumeric with hyphens/underscores only", "error");
      return;
    }

    try {
      const repoRoot = await getRepoRoot(pi);
      const config = loadConfig(repoRoot);
      const wtDir = getWorktreeDir(repoRoot, config);
      const worktreePath = join(wtDir, name);
      const branch = `${getBranchPrefix(config)}${name}`;

      await createWorktree(pi, ctx, repoRoot, config, name);

      // Launch in new workspace
      const launched = await launchInWorktree(pi, ctx, worktreePath, name);

      ctx.ui.notify(
        `✅ Worktree "${name}" ready\n` +
          `   Path:   ${worktreePath}\n` +
          `   Branch: ${branch}\n` +
          (launched
            ? `   PI launched in new workspace`
            : `   Start PI: cd ${worktreePath} && pi`),
        "success",
      );
    } catch (err) {
      ctx.ui.setStatus("worktree", undefined);
      ctx.ui.notify(`Failed to create worktree: ${(err as Error).message}`, "error");
    }
  }

  // --- Destroy handler ---
  async function handleDestroy(name: string, ctx: any) {
    if (!name) {
      ctx.ui.notify("Usage: /worktree destroy <name>", "error");
      return;
    }

    try {
      const repoRoot = await getRepoRoot(pi);
      const config = loadConfig(repoRoot);
      const wtDir = getWorktreeDir(repoRoot, config);
      const worktreePath = join(wtDir, name);
      const branch = `${getBranchPrefix(config)}${name}`;

      if (!existsSync(worktreePath)) {
        ctx.ui.notify(`Worktree "${name}" does not exist at ${worktreePath}`, "error");
        return;
      }

      const ok = await ctx.ui.confirm(
        "Destroy worktree?",
        `This will remove ${worktreePath} and delete branch ${branch}.`,
      );
      if (!ok) return;

      const step = (msg: string) => ctx.ui.setStatus("worktree", msg);

      // Pre-remove hooks
      if (config.preRemove?.length) {
        step("⏳ Running pre-remove hooks...");
        for (const cmd of config.preRemove) {
          await pi.exec("bash", ["-c", cmd], { timeout: 30_000 });
        }
      }

      // Remove worktree
      step("⏳ Removing git worktree...");
      const rmResult = await pi.exec("bash", ["-c", `
        cd "${repoRoot}"
        git worktree remove --force "${worktreePath}" 2>&1 || {
          rm -rf "${worktreePath}" 2>&1 || true
          git worktree prune 2>&1 || true
        }
      `], { timeout: 10_000 });

      // Delete branch
      step("⏳ Deleting branch...");
      await pi.exec("bash", ["-c",
        `cd "${repoRoot}" && git branch -D "${branch}" 2>/dev/null || true`
      ], { timeout: 5_000 });

      step("");
      ctx.ui.notify(
        `✅ Worktree "${name}" destroyed\n` +
          `   Path:   ${worktreePath} (removed)\n` +
          `   Branch: ${branch} (deleted)`,
        "success",
      );
    } catch (err) {
      ctx.ui.setStatus("worktree", undefined);
      ctx.ui.notify(`Failed to destroy worktree: ${(err as Error).message}`, "error");
    }
  }

  // --- List handler ---
  async function handleList(ctx: any) {
    const result = await pi.exec("git", ["worktree", "list"], { timeout: 5_000 });
    if (result.code !== 0) {
      ctx.ui.notify("Failed to list worktrees", "error");
      return;
    }
    ctx.ui.notify(result.stdout.trim() || "No worktrees", "info");
  }
}

// ---------------------------------------------------------------------------
// Core: create worktree
// ---------------------------------------------------------------------------

async function createWorktree(
  pi: ExtensionAPI,
  ctx: any,
  repoRoot: string,
  config: WorktreeConfig,
  name: string,
) {
  const wtDir = getWorktreeDir(repoRoot, config);
  const worktreePath = join(wtDir, name);
  const branch = `${getBranchPrefix(config)}${name}`;

  const step = (msg: string) => ctx.ui.setStatus("worktree", msg);
  const run = async (cmd: string, timeout = 30_000) => {
    const r = await pi.exec("bash", ["-c", cmd], { timeout });
    if (r.code !== 0) throw new Error(r.stderr || `Command failed: ${cmd}`);
    return r;
  };

  // 1. Git worktree
  step(`⏳ Creating git worktree (${branch})...`);
  await run(`
    cd "${repoRoot}"
    [ -d "${worktreePath}" ] && git worktree remove --force "${worktreePath}" 2>/dev/null || true
    git show-ref --verify --quiet "refs/heads/${branch}" 2>/dev/null && git branch -D "${branch}" 2>/dev/null || true
    git worktree add -b "${branch}" "${worktreePath}" HEAD
  `);

  // 2. Link env files
  if (config.linkEnvFiles !== false) {
    step("⏳ Linking env files...");
    await run(`
      cd "${repoRoot}"
      for f in .env*; do
        [ -f "$f" ] || continue
        [ "$f" = ".env.local" ] && continue
        git check-ignore -q "$f" 2>/dev/null || continue
        ln -sf "${repoRoot}/$f" "${worktreePath}/$f"
      done
    `);
  }

  // 3. Post-create hooks
  if (config.postCreate?.length) {
    for (let i = 0; i < config.postCreate.length; i++) {
      const cmd = config.postCreate[i];
      step(`⏳ Post-create [${i + 1}/${config.postCreate.length}]: ${cmd.slice(0, 60)}...`);
      await pi.exec("bash", ["-c", `cd "${worktreePath}" && ${cmd}`], { timeout: 120_000 });
    }
  }

  step("");
}

// ---------------------------------------------------------------------------
// Launch PI in worktree via cmux or tmux
// ---------------------------------------------------------------------------

async function launchInWorktree(
  pi: ExtensionAPI,
  ctx: any,
  worktreePath: string,
  name: string,
): Promise<boolean> {
  // Try cmux first
  const hasCmux = (await pi.exec("bash", ["-c", "command -v cmux"], { timeout: 3_000 })).code === 0;
  if (hasCmux) {
    const result = await pi.exec("bash", ["-c",
      `cmux new-workspace --command "cd '${worktreePath}' && exec pi"`
    ], { timeout: 5_000 });
    if (result.code === 0) {
      await pi.exec("bash", ["-c", `cmux rename-workspace "wt:${name}"`], { timeout: 3_000 });
      return true;
    }
  }

  // Try tmux
  const hasTmux = (await pi.exec("bash", ["-c", "command -v tmux"], { timeout: 3_000 })).code === 0;
  if (hasTmux) {
    // Check if we're inside tmux
    const inTmux = (await pi.exec("bash", ["-c", 'echo "$TMUX"'], { timeout: 3_000 }));
    if (inTmux.code === 0 && inTmux.stdout.trim()) {
      const result = await pi.exec("bash", ["-c",
        `tmux new-window -n "wt:${name}" "cd '${worktreePath}' && exec pi"`
      ], { timeout: 5_000 });
      return result.code === 0;
    }
  }

  return false;
}
