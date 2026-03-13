import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
// Default export is the extension factory
import initExtension, {
  ADJECTIVES,
  detectWorktreeName,
  expandHome,
  generateName,
  getBranchPrefix,
  getWorktreeDir,
  loadConfig,
  NOUNS,
} from "./worktree.js";

// ---------------------------------------------------------------------------
// Helpers: mock ExtensionAPI
// ---------------------------------------------------------------------------

type EventHandler = (...args: unknown[]) => unknown;

interface CommandEntry {
  description: string;
  handler: (args: string, ctx: unknown) => Promise<void>;
}

interface FlagEntry {
  description?: string;
  type: "boolean" | "string";
  default?: boolean | string;
}

interface MockPi extends ExtensionAPI {
  _events: Record<string, EventHandler>;
  _commands: Record<string, CommandEntry>;
  _flagValues: Record<string, boolean | string | undefined>;
  _sessionName: string | undefined;
}

function createMockPi(): MockPi {
  const events: Record<string, EventHandler> = {};
  const commands: Record<string, CommandEntry> = {};
  const flags: Record<string, FlagEntry> = {};
  const flagValues: Record<string, boolean | string | undefined> = {};

  const execMock = mock(() =>
    Promise.resolve({ code: 0, killed: false, stdout: "", stderr: "" }),
  );

  const noop = mock(() => {});

  const pi: MockPi = {
    _events: events,
    _commands: commands,
    _flagValues: flagValues,
    _sessionName: undefined,

    on: mock((event: string, handler: EventHandler) => {
      events[event] = handler;
    }) as MockPi["on"],
    registerCommand: mock((name: string, opts: CommandEntry) => {
      commands[name] = opts;
    }) as MockPi["registerCommand"],
    registerFlag: mock((name: string, opts: FlagEntry) => {
      flags[name] = opts;
    }) as MockPi["registerFlag"],
    getFlag: mock((name: string) => flagValues[name]) as MockPi["getFlag"],
    setSessionName: mock((name: string) => {
      pi._sessionName = name;
    }),
    getSessionName: mock(() => pi._sessionName),
    exec: execMock,
    registerTool: noop as MockPi["registerTool"],
    registerShortcut: noop as MockPi["registerShortcut"],
    registerMessageRenderer: noop as MockPi["registerMessageRenderer"],
    sendMessage: noop as MockPi["sendMessage"],
    sendUserMessage: noop as MockPi["sendUserMessage"],
    appendEntry: noop as MockPi["appendEntry"],
    setLabel: noop,
    getActiveTools: mock(() => []),
    getAllTools: mock(() => []),
    setActiveTools: noop,
    getCommands: mock(() => []),
    setModel: mock(() => Promise.resolve(false)),
    getThinkingLevel: mock(() => "off" as const),
    setThinkingLevel: noop,
    registerProvider: noop,
    unregisterProvider: noop,
    events: {
      emit: noop,
      on: mock(() => noop),
    } as unknown as MockPi["events"],
  };

  return pi;
}

function createMockCtx(cwd = "/tmp/test-repo") {
  return {
    cwd,
    ui: {
      setStatus: mock(() => {}),
      notify: mock((_msg: string, _type?: string) => {}),
      confirm: mock(() => Promise.resolve(false)),
    },
    shutdown: mock(() => {}),
  };
}

// ===================================================================
// Unit tests — pure functions
// ===================================================================

describe("generateName", () => {
  test("returns adjective-noun format", () => {
    const name = generateName();
    const parts = name.split("-");
    expect(parts).toHaveLength(2);
    expect(ADJECTIVES).toContain(parts[0]);
    expect(NOUNS).toContain(parts[1]);
  });

  test("generates different names (probabilistic)", () => {
    const names = new Set(Array.from({ length: 50 }, () => generateName()));
    expect(names.size).toBeGreaterThan(1);
  });
});

describe("detectWorktreeName", () => {
  test("extracts name from .worktrees path", () => {
    expect(detectWorktreeName("/repo/.worktrees/my-feature")).toBe(
      "my-feature",
    );
  });

  test("extracts name from nested path inside worktree", () => {
    expect(detectWorktreeName("/repo/.worktrees/my-feature/src/lib")).toBe(
      "my-feature",
    );
  });

  test("returns null for non-worktree path", () => {
    expect(detectWorktreeName("/repo/src")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(detectWorktreeName("")).toBeNull();
  });

  test("returns null for path with .worktrees but no name", () => {
    expect(detectWorktreeName("/repo/.worktrees/")).toBeNull();
  });
});

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-wt-test-"));
  });

  test("returns {} when config file does not exist", () => {
    expect(loadConfig(tmpDir)).toEqual({});
  });

  test("parses valid config", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    const config = {
      dir: "my-worktrees",
      branchPrefix: "wt/",
      postCreate: ["npm install"],
    };
    writeFileSync(join(piDir, "worktree.json"), JSON.stringify(config));
    expect(loadConfig(tmpDir)).toEqual(config);
  });

  test("returns {} for invalid JSON", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "worktree.json"), "{invalid json}");
    expect(loadConfig(tmpDir)).toEqual({});
  });
});

describe("expandHome", () => {
  const home = require("node:os").homedir();

  test("expands lone ~", () => {
    expect(expandHome("~")).toBe(home);
  });

  test("expands ~/ prefix", () => {
    expect(expandHome("~/.worktrees/proj")).toBe(join(home, ".worktrees/proj"));
  });

  test("expands ~\\ prefix (Windows)", () => {
    expect(expandHome("~\\.worktrees\\proj")).toBe(
      join(home, ".worktrees\\proj"),
    );
  });

  test("leaves absolute paths unchanged", () => {
    expect(expandHome("/absolute/path")).toBe("/absolute/path");
  });

  test("leaves relative paths unchanged", () => {
    expect(expandHome("relative/path")).toBe("relative/path");
  });

  test("does not expand ~ in the middle", () => {
    expect(expandHome("foo/~/bar")).toBe("foo/~/bar");
  });
});

describe("getWorktreeDir", () => {
  const home = require("node:os").homedir();

  test("returns default .worktrees", () => {
    expect(getWorktreeDir("/repo", {})).toBe(resolve("/repo", ".worktrees"));
  });

  test("uses custom dir from config", () => {
    expect(getWorktreeDir("/repo", { dir: "my-wt" })).toBe(
      resolve("/repo", "my-wt"),
    );
  });

  test("expands ~ in dir config", () => {
    expect(getWorktreeDir("/repo", { dir: "~/.worktrees/proj" })).toBe(
      join(home, ".worktrees/proj"),
    );
  });

  test("uses absolute dir as-is", () => {
    expect(getWorktreeDir("/repo", { dir: "/tmp/worktrees" })).toBe(
      "/tmp/worktrees",
    );
  });
});

describe("getBranchPrefix", () => {
  test("returns default worktree/", () => {
    expect(getBranchPrefix({})).toBe("worktree/");
  });

  test("uses custom prefix from config", () => {
    expect(getBranchPrefix({ branchPrefix: "wt/" })).toBe("wt/");
  });
});

// ===================================================================
// Integration tests — extension registration
// ===================================================================

describe("extension registration", () => {
  let pi: MockPi;

  beforeEach(() => {
    pi = createMockPi();
    initExtension(pi);
  });

  test("registers worktree flag", () => {
    expect(pi.registerFlag).toHaveBeenCalledWith("worktree", {
      description: expect.stringContaining("worktree"),
      type: "string",
    });
  });

  test("registers session_start event handler", () => {
    expect(pi._events.session_start).toBeDefined();
  });

  test("registers before_agent_start event handler", () => {
    expect(pi._events.before_agent_start).toBeDefined();
  });

  test("registers 4 commands", () => {
    expect(pi._commands.worktree).toBeDefined();
    expect(pi._commands["worktree-create"]).toBeDefined();
    expect(pi._commands["worktree-destroy"]).toBeDefined();
    expect(pi._commands["worktree-list"]).toBeDefined();
  });

  test("worktree command has description", () => {
    expect(pi._commands.worktree.description).toContain("worktree");
  });
});

// ===================================================================
// Integration tests — command handlers
// ===================================================================

describe("command handlers", () => {
  let pi: MockPi;

  beforeEach(() => {
    pi = createMockPi();
    initExtension(pi);
  });

  describe("/worktree help", () => {
    test("shows help text", async () => {
      const ctx = createMockCtx();
      await pi._commands.worktree.handler("help", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
      const msg = ctx.ui.notify.mock.calls[0][0];
      expect(msg).toContain("Usage:");
      expect(msg).toContain("/worktree");
    });
  });

  describe("/worktree list", () => {
    test("calls git worktree list and shows output", async () => {
      const ctx = createMockCtx();
      pi.exec = mock(() =>
        Promise.resolve({
          code: 0,
          killed: false,
          stdout:
            "/repo  abc1234 [main]\n/repo/.worktrees/foo  def5678 [worktree/foo]\n",
          stderr: "",
        }),
      ) as MockPi["exec"];
      await pi._commands.worktree.handler("list", ctx);
      expect(pi.exec).toHaveBeenCalledWith("git", ["worktree", "list"], {
        timeout: 5000,
      });
      expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    });

    test("shows error when git fails", async () => {
      const ctx = createMockCtx();
      pi.exec = mock(() =>
        Promise.resolve({
          code: 1,
          killed: false,
          stdout: "",
          stderr: "error",
        }),
      ) as MockPi["exec"];
      await pi._commands.worktree.handler("list", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Failed to list worktrees",
        "error",
      );
    });
  });

  describe("/worktree create - name validation", () => {
    test("rejects names with special characters", async () => {
      const ctx = createMockCtx();
      await pi._commands.worktree.handler("create foo/bar", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("alphanumeric"),
        "error",
      );
    });

    test("rejects names with spaces", async () => {
      const ctx = createMockCtx();
      await pi._commands["worktree-create"].handler("foo bar", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("alphanumeric"),
        "error",
      );
    });
  });

  describe("/worktree destroy", () => {
    test("shows usage error when no name provided", async () => {
      const ctx = createMockCtx();
      await pi._commands.worktree.handler("destroy", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Usage"),
        "error",
      );
    });

    test("shows error when worktree does not exist", async () => {
      const ctx = createMockCtx();
      pi.exec = mock(() =>
        Promise.resolve({
          code: 0,
          killed: false,
          stdout: "/tmp/test-repo/.git\n",
          stderr: "",
        }),
      ) as MockPi["exec"];
      await pi._commands.worktree.handler("destroy nonexistent", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("does not exist"),
        "error",
      );
    });
  });

  describe("/worktree shortcut commands", () => {
    test("/worktree-list delegates to list", async () => {
      const ctx = createMockCtx();
      pi.exec = mock(() =>
        Promise.resolve({
          code: 0,
          killed: false,
          stdout: "test output",
          stderr: "",
        }),
      ) as MockPi["exec"];
      await pi._commands["worktree-list"].handler("", ctx);
      expect(pi.exec).toHaveBeenCalledWith("git", ["worktree", "list"], {
        timeout: 5000,
      });
    });

    test("/worktree-destroy with no name shows error", async () => {
      const ctx = createMockCtx();
      await pi._commands["worktree-destroy"].handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Usage"),
        "error",
      );
    });
  });
});

// ===================================================================
// Integration tests — session_start event
// ===================================================================

describe("session_start event", () => {
  test("auto-detects worktree from cwd and sets session name", async () => {
    const pi = createMockPi();
    pi._flagValues.worktree = undefined;
    initExtension(pi);

    const ctx = createMockCtx("/repo/.worktrees/cool-fox/src");
    await pi._events.session_start({}, ctx);

    expect(pi.setSessionName).toHaveBeenCalledWith("wt:cool-fox");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("worktree", "🌿 cool-fox");
  });

  test("does nothing when not in a worktree and no flag", async () => {
    const pi = createMockPi();
    pi._flagValues.worktree = undefined;
    initExtension(pi);

    const ctx = createMockCtx("/repo/src");
    await pi._events.session_start({}, ctx);

    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });
});

// ===================================================================
// Integration tests — before_agent_start event
// ===================================================================

describe("before_agent_start event", () => {
  test("injects system prompt when worktree is active", async () => {
    const pi = createMockPi();
    pi._flagValues.worktree = undefined;
    initExtension(pi);

    const ctx = createMockCtx("/repo/.worktrees/test-wt");
    await pi._events.session_start({}, ctx);

    const event = { systemPrompt: "base prompt" };
    const result = (await pi._events.before_agent_start(event, ctx)) as {
      systemPrompt: string;
    };

    expect(result).toBeDefined();
    expect(result.systemPrompt).toContain("base prompt");
    expect(result.systemPrompt).toContain("Active Worktree");
    expect(result.systemPrompt).toContain("test-wt");
  });

  test("does not modify system prompt when no worktree", async () => {
    const pi = createMockPi();
    pi._flagValues.worktree = undefined;
    initExtension(pi);

    const ctx = createMockCtx("/repo/src");
    await pi._events.session_start({}, ctx);

    const event = { systemPrompt: "base prompt" };
    const result = await pi._events.before_agent_start(event, ctx);

    expect(result).toBeUndefined();
  });
});
