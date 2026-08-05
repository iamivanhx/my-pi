import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import buildExtension from "../extensions/build.ts";

type BuildCommand = {
  handler: (args: string, context: unknown) => Promise<void>;
};

type EventHandler = (event: any, context: any) => unknown;
type CommandResult = { code: number; stdout: string; stderr: string };

function buildHarness(exec: (command: string, args: string[]) => Promise<CommandResult>) {
  const commands = new Map<string, BuildCommand>();
  const handlers = new Map<string, EventHandler>();
  const sentMessages: string[] = [];
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const eventHandlers = new Map<string, (payload: unknown) => void>();

  buildExtension({
    exec: (command: string, args: string[]) => exec(command, args),
    sendUserMessage(message: string) {
      sentMessages.push(message);
    },
    registerCommand(name: string, command: BuildCommand) {
      commands.set(name, command);
    },
    on(name: string, handler: EventHandler) {
      handlers.set(name, handler);
    },
    events: {
      emit(event: string, payload: unknown) { emitted.push({ event, payload }); },
      on(event: string, handler: (payload: unknown) => void) { eventHandlers.set(event, handler); return () => eventHandlers.delete(event); },
    },
  } as never);

  const command = commands.get("build");
  assert.ok(command);
  return { command, handlers, sentMessages, emitted, eventHandlers };
}

test("registers the /build command", () => {
  const { command } = buildHarness(async () => ({ code: 0, stdout: "", stderr: "" }));
  assert.ok(command);
});

test("allows /build in a new session that only contains Pi startup metadata", async () => {
  const calls: Array<[string, string[]]> = [];
  const { command, sentMessages } = buildHarness(async (program, args) => {
    calls.push([program, args]);
    if (args.join(" ") === "branch --show-current") return { code: 0, stdout: "main\n", stderr: "" };
    if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n", stderr: "" };
    return {
      code: 0,
      stdout: JSON.stringify({ number: 29, title: "the nine gates", body: "Build it." }),
      stderr: "",
    };
  });
  const notifications: Array<{ message: string; level: string }> = [];
  const context = {
    cwd: "/project",
    hasUI: true,
    isIdle: () => true,
    sessionManager: {
      getBranch: () => [
        { type: "model_change" },
        { type: "thinking_level_change" },
      ],
    },
    ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
  };

  await command.handler("29", context);

  assert.deepEqual(calls, [
    ["gh", ["issue", "view", "29", "--json", "number,title,body"]],
    ["git", ["branch", "--show-current"]],
    ["git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]],
    ["git", ["switch", "-c", "build/29-the-nine-gates"]],
  ]);
  assert.equal(notifications.length, 0);
  assert.equal(sentMessages.length, 1);
});

test("rejects /build after prior conversation work", async () => {
  const { command } = buildHarness(async () => ({ code: 0, stdout: "", stderr: "" }));
  const notifications: Array<{ message: string; level: string }> = [];
  const context = {
    hasUI: true,
    isIdle: () => true,
    sessionManager: {
      getBranch: () => [
        { type: "model_change" },
        { type: "thinking_level_change" },
        { type: "message", message: { role: "user", content: "prior work" } },
      ],
    },
    ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
  };

  await command.handler("29", context);

  assert.deepEqual(notifications, [{
    message: "/build must start in a fresh session window.",
    level: "warning",
  }]);
});

test("opens one Issue, injects the nine gates, and blocks tests before program design", async () => {
  const calls: Array<[string, string[]]> = [];
  const { command, handlers, sentMessages } = buildHarness(async (program, args) => {
    calls.push([program, args]);
    if (args.join(" ") === "branch --show-current") return { code: 0, stdout: "main\n", stderr: "" };
    if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n", stderr: "" };
    return {
      code: 0,
      stdout: JSON.stringify({ number: 29, title: "the nine gates", body: "Build it." }),
      stderr: "",
    };
  });
  const notifications: Array<{ message: string; level: string }> = [];
  const context = {
    cwd: "/project",
    hasUI: true,
    isIdle: () => true,
    sessionManager: { getBranch: () => [] },
    ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
  };

  await command.handler("#29", context);

  assert.deepEqual(calls, [
    ["gh", ["issue", "view", "29", "--json", "number,title,body"]],
    ["git", ["branch", "--show-current"]],
    ["git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]],
    ["git", ["switch", "-c", "build/29-the-nine-gates"]],
  ]);
  assert.equal(notifications.length, 0);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /manage_todo_list/);
  assert.match(sentMessages[0], /1\. Open Issue/);
  assert.match(sentMessages[0], /2\. Clarify requirements and post program design/);
  assert.match(sentMessages[0], /9\. Close Issue/);
  assert.match(sentMessages[0], /Issue #29/);
  assert.match(sentMessages[0], /before writing or running any test/i);

  const blocked = handlers.get("tool_call")?.({
    toolName: "bash",
    toolCallId: "premature-test",
    input: { command: "pnpm test -- tests/build.test.ts" },
  }, context) as { block?: boolean; reason?: string };
  assert.equal(blocked?.block, true);
  assert.match(blocked?.reason ?? "", /program-design note/i);

  const blockedWrite = handlers.get("tool_call")?.({
    toolName: "write",
    toolCallId: "premature-test-file",
    input: { path: "tests/build.test.ts" },
  }, context) as { block?: boolean; reason?: string };
  assert.equal(blockedWrite?.block, true);
  assert.match(blockedWrite?.reason ?? "", /program-design note/i);
});

test("injects TDD only after the program-design Issue comment succeeds", async () => {
  const skillDirectory = await mkdtemp(join(tmpdir(), "my-pi-build-test-"));
  const skillPath = join(skillDirectory, "SKILL.md");
  await writeFile(skillPath, "---\nname: tdd\n---\n\n# TDD instructions\n");

  try {
    const { command, handlers, sentMessages } = buildHarness(async () => ({
      code: 0,
      stdout: JSON.stringify({ number: 29, title: "the nine gates", body: "Build it." }),
      stderr: "",
    }));
    const context = {
      cwd: "/project",
      hasUI: true,
      isIdle: () => true,
      sessionManager: { getBranch: () => [] },
      getSystemPromptOptions: () => ({ skills: [{ name: "tdd", filePath: skillPath }] }),
      ui: { notify() {} },
    };

    await command.handler("29", context);
    handlers.get("tool_call")?.({
      toolName: "bash",
      toolCallId: "design-comment",
      input: { command: "gh issue comment 29 --body '## Program design'" },
    }, context);
    handlers.get("tool_result")?.({
      toolName: "bash",
      toolCallId: "design-comment",
      isError: false,
    }, context);
    await handlers.get("agent_end")?.({}, context);

    assert.equal(sentMessages.length, 2);
    assert.match(sentMessages[1], /<skill name="tdd" location=/);
    assert.match(sentMessages[1], /# TDD instructions/);
    assert.match(sentMessages[1], /focused failing test/i);
  } finally {
    await rm(skillDirectory, { recursive: true, force: true });
  }
});

test("injects code review and dispatches issue-reviewer in fresh context after green", async () => {
  const skillDirectory = await mkdtemp(join(tmpdir(), "my-pi-build-test-"));
  const tddPath = join(skillDirectory, "tdd.md");
  const reviewPath = join(skillDirectory, "code-review.md");
  await Promise.all([writeFile(tddPath, "# TDD\n"), writeFile(reviewPath, "# Code review\n")]);

  try {
    const { command, handlers, sentMessages, emitted } = buildHarness(async () => ({
      code: 0,
      stdout: JSON.stringify({ number: 29, title: "the nine gates", body: "Build it." }),
      stderr: "",
    }));
    const context = {
      cwd: "/project",
      hasUI: true,
      isIdle: () => true,
      sessionManager: { getBranch: () => [] },
      getSystemPromptOptions: () => ({ skills: [
        { name: "tdd", filePath: tddPath },
        { name: "code-review", filePath: reviewPath },
      ] }),
      ui: { notify() {} },
    };
    const toolCall = handlers.get("tool_call")!;
    const toolResult = handlers.get("tool_result")!;
    const agentEnd = handlers.get("agent_end")!;

    await command.handler("29", context);
    toolCall({ toolName: "bash", toolCallId: "design", input: { command: "gh issue comment 29 --body design" } }, context);
    toolResult({ toolName: "bash", toolCallId: "design", isError: false }, context);
    await agentEnd({}, context);
    toolCall({ toolName: "bash", toolCallId: "red", input: { command: "pnpm test -- tests/build.test.ts" } }, context);
    toolResult({ toolName: "bash", toolCallId: "red", isError: true }, context);
    await agentEnd({}, context);
    toolCall({ toolName: "bash", toolCallId: "green", input: { command: "pnpm test -- tests/build.test.ts" } }, context);
    toolResult({ toolName: "bash", toolCallId: "green", isError: false }, context);
    await agentEnd({}, context);

    assert.match(sentMessages.at(-1) ?? "", /<skill name="code-review" location=/);
    assert.deepEqual(emitted.map(({ event }) => event), ["prompt-template:subagent:request"]);
    assert.deepEqual(emitted[0].payload, {
      version: 1,
      requestId: (emitted[0].payload as { requestId: string }).requestId,
      agent: "issue-reviewer",
      context: "fresh",
      cwd: "/project",
      task: "Review the implementation for Issue #29: the nine gates. Inspect git diff against the issue base and report only findings in the issue-reviewer findings contract.",
      timeoutMs: 600_000,
      artifacts: true,
    });
  } finally {
    await rm(skillDirectory, { recursive: true, force: true });
  }
});

test("creates a grouped draft PR and closes the Issue after push", async () => {
  const skillDirectory = await mkdtemp(join(tmpdir(), "my-pi-build-test-"));
  const tddPath = join(skillDirectory, "tdd.md");
  const reviewPath = join(skillDirectory, "code-review.md");
  await Promise.all([writeFile(tddPath, "# TDD\n"), writeFile(reviewPath, "# Code review\n")]);
  const calls: Array<[string, string[]]> = [];

  try {
    const { command, handlers, emitted, eventHandlers } = buildHarness(async (program, args) => {
      calls.push([program, args]);
      if (program === "gh" && args[0] === "issue" && args[1] === "view") {
        return { code: 0, stdout: JSON.stringify({ number: 29, title: "the nine gates", body: "PR group: #29, #30" }), stderr: "" };
      }
      if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n", stderr: "" };
      if (program === "git") return { code: 0, stdout: "build/nine-gates\n", stderr: "" };
      if (program === "gh" && args[0] === "pr" && args[1] === "list") return { code: 0, stdout: "[]", stderr: "" };
      return { code: 0, stdout: "https://github.com/iamivanhx/my-pi/pull/40\n", stderr: "" };
    });
    const context = {
      cwd: "/project",
      hasUI: true,
      isIdle: () => true,
      sessionManager: { getBranch: () => [] },
      getSystemPromptOptions: () => ({ skills: [
        { name: "tdd", filePath: tddPath },
        { name: "code-review", filePath: reviewPath },
      ] }),
      ui: { notify() {} },
    };
    const toolCall = handlers.get("tool_call")!;
    const toolResult = handlers.get("tool_result")!;
    const agentEnd = handlers.get("agent_end")!;
    const succeed = async (id: string, commandText: string, isError = false) => {
      await toolCall({ toolName: "bash", toolCallId: id, input: { command: commandText } }, context);
      toolResult({ toolName: "bash", toolCallId: id, isError }, context);
      await agentEnd({}, context);
    };

    await command.handler("29", context);
    await succeed("design", "gh issue comment 29 --body design");
    await succeed("red", "pnpm test -- tests/build.test.ts", true);
    await succeed("green", "pnpm test -- tests/build.test.ts");
    eventHandlers.get("prompt-template:subagent:response")?.({
      requestId: (emitted[0].payload as { requestId: string }).requestId,
      status: "completed",
    });
    await succeed("suite", "pnpm test");
    await succeed("commit", "git commit -m 'feat: build gates'");
    await succeed("push", "git push");

    assert.ok(calls.some(([program, args]) => program === "gh" && args[0] === "pr" && args[1] === "create" && args.at(-1) === "Closes #29\nCloses #30"));
    assert.ok(calls.some(([program, args]) => program === "gh" && args.join(" ") === "issue close 29"));
  } finally {
    await rm(skillDirectory, { recursive: true, force: true });
  }
});

test("reuses a grouped draft PR whose closing references already contain the Issue", async () => {
  const skillDirectory = await mkdtemp(join(tmpdir(), "my-pi-build-test-"));
  const tddPath = join(skillDirectory, "tdd.md");
  const reviewPath = join(skillDirectory, "code-review.md");
  await Promise.all([writeFile(tddPath, "# TDD\n"), writeFile(reviewPath, "# Code review\n")]);
  const calls: Array<[string, string[]]> = [];

  try {
    const { command, handlers, emitted, eventHandlers } = buildHarness(async (program, args) => {
      calls.push([program, args]);
      if (program === "gh" && args[0] === "issue" && args[1] === "view") {
        return { code: 0, stdout: JSON.stringify({ number: 30, title: "second gate run", body: "PR group: #29, #30" }), stderr: "" };
      }
      if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n", stderr: "" };
      if (program === "git") return { code: 0, stdout: "build/nine-gates\n", stderr: "" };
      if (program === "gh" && args[0] === "pr" && args[1] === "list") {
        return { code: 0, stdout: JSON.stringify([{ number: 40, body: "Closes #29\nCloses #30", headRefName: "build/nine-gates", closingIssuesReferences: [{ number: 29 }, { number: 30 }] }]), stderr: "" };
      }
      return { code: 0, stdout: "ok\n", stderr: "" };
    });
    const context = {
      cwd: "/project", hasUI: true, isIdle: () => true, sessionManager: { getBranch: () => [] },
      getSystemPromptOptions: () => ({ skills: [{ name: "tdd", filePath: tddPath }, { name: "code-review", filePath: reviewPath }] }),
      ui: { notify() {} },
    };
    const toolCall = handlers.get("tool_call")!;
    const toolResult = handlers.get("tool_result")!;
    const agentEnd = handlers.get("agent_end")!;
    const succeed = async (id: string, commandText: string, isError = false) => {
      await toolCall({ toolName: "bash", toolCallId: id, input: { command: commandText } }, context);
      toolResult({ toolName: "bash", toolCallId: id, isError }, context);
      await agentEnd({}, context);
    };

    await command.handler("30", context);
    await succeed("design", "gh issue comment 30 --body design");
    await succeed("red", "pnpm test -- tests/build.test.ts", true);
    await succeed("green", "pnpm test -- tests/build.test.ts");
    eventHandlers.get("prompt-template:subagent:response")?.({ requestId: (emitted[0].payload as { requestId: string }).requestId, status: "completed" });
    await succeed("suite", "pnpm test");
    await succeed("commit", "git commit -m second");
    await succeed("push", "git push");

    assert.equal(calls.some(([program, args]) => program === "gh" && args[0] === "pr" && args[1] === "create"), false);
    assert.equal(calls.some(([program, args]) => program === "gh" && args[0] === "pr" && args[1] === "edit"), false);
    assert.ok(calls.some(([program, args]) => program === "gh" && args.join(" ") === "issue close 30"));
  } finally {
    await rm(skillDirectory, { recursive: true, force: true });
  }
});

test("creates an issue branch before entering the clarify gate from the default branch", async () => {
  const calls: Array<[string, string[]]> = [];
  const { command, sentMessages } = buildHarness(async (program, args) => {
    calls.push([program, args]);
    if (program === "gh") {
      return { code: 0, stdout: JSON.stringify({ number: 42, title: "Fix /build branch gate: never commit directly to main", body: "Build it." }), stderr: "" };
    }
    if (args.join(" ") === "branch --show-current") return { code: 0, stdout: "main\n", stderr: "" };
    if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  });
  const context = {
    cwd: "/project",
    hasUI: true,
    isIdle: () => true,
    sessionManager: { getBranch: () => [] },
    ui: { notify() {} },
  };

  await command.handler("42", context);

  assert.deepEqual(calls, [
    ["gh", ["issue", "view", "42", "--json", "number,title,body"]],
    ["git", ["branch", "--show-current"]],
    ["git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]],
    ["git", ["switch", "-c", "build/42-fix-build-branch-gate-never-commit-directly-to-main"]],
  ]);
  assert.equal(sentMessages.length, 1);
});

test("blocks commits and pushes when the active branch is the repository default branch", async () => {
  let branchName = "main";
  const { command, handlers } = buildHarness(async (program, args) => {
    if (program === "gh") return { code: 0, stdout: JSON.stringify({ number: 42, title: "branch safety", body: "Build it." }), stderr: "" };
    if (args.join(" ") === "branch --show-current") return { code: 0, stdout: `${branchName}\n`, stderr: "" };
    if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n", stderr: "" };
    if (args[0] === "switch") branchName = args.at(-1)!;
    return { code: 0, stdout: "", stderr: "" };
  });
  const context = {
    cwd: "/project",
    hasUI: true,
    isIdle: () => true,
    sessionManager: { getBranch: () => [] },
    ui: { notify() {} },
  };

  await command.handler("42", context);
  branchName = "main";

  for (const commandText of ["git commit -m unsafe", "git push origin main"]) {
    const blocked = await handlers.get("tool_call")?.({
      toolName: "bash",
      toolCallId: commandText,
      input: { command: commandText },
    }, context) as { block?: boolean; reason?: string };
    assert.equal(blocked?.block, true);
    assert.match(blocked?.reason ?? "", /default branch/i);
  }
});

test("refuses the PR action when the pushed branch becomes the default branch", async () => {
  const skillDirectory = await mkdtemp(join(tmpdir(), "my-pi-build-test-"));
  const tddPath = join(skillDirectory, "tdd.md");
  const reviewPath = join(skillDirectory, "code-review.md");
  await Promise.all([writeFile(tddPath, "# TDD\n"), writeFile(reviewPath, "# Code review\n")]);
  let branchName = "build/42-branch-safety";
  const calls: Array<[string, string[]]> = [];

  try {
    const { command, handlers, emitted, eventHandlers } = buildHarness(async (program, args) => {
      calls.push([program, args]);
      if (program === "gh" && args[0] === "issue" && args[1] === "view") {
        return { code: 0, stdout: JSON.stringify({ number: 42, title: "branch safety", body: "Build it." }), stderr: "" };
      }
      if (args.join(" ") === "branch --show-current") return { code: 0, stdout: `${branchName}\n`, stderr: "" };
      if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n", stderr: "" };
      return { code: 0, stdout: "ok\n", stderr: "" };
    });
    const notifications: Array<{ message: string; level: string }> = [];
    const context = {
      cwd: "/project", hasUI: true, isIdle: () => true, sessionManager: { getBranch: () => [] },
      getSystemPromptOptions: () => ({ skills: [{ name: "tdd", filePath: tddPath }, { name: "code-review", filePath: reviewPath }] }),
      ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
    };
    const toolCall = handlers.get("tool_call")!;
    const toolResult = handlers.get("tool_result")!;
    const agentEnd = handlers.get("agent_end")!;
    const succeed = async (id: string, commandText: string, isError = false) => {
      await toolCall({ toolName: "bash", toolCallId: id, input: { command: commandText } }, context);
      toolResult({ toolName: "bash", toolCallId: id, isError }, context);
      await agentEnd({}, context);
    };

    await command.handler("42", context);
    await succeed("design", "gh issue comment 42 --body design");
    await succeed("red", "pnpm test -- tests/build.test.ts", true);
    await succeed("green", "pnpm test -- tests/build.test.ts");
    eventHandlers.get("prompt-template:subagent:response")?.({ requestId: (emitted[0].payload as { requestId: string }).requestId, status: "completed" });
    await succeed("suite", "pnpm test");
    await succeed("commit", "git commit -m branch-safety");
    await toolCall({ toolName: "bash", toolCallId: "push", input: { command: "git push" } }, context);
    branchName = "main";
    toolResult({ toolName: "bash", toolCallId: "push", isError: false }, context);
    await agentEnd({}, context);

    assert.equal(calls.some(([program, args]) => program === "gh" && args[0] === "pr" && args[1] === "create"), false);
    assert.deepEqual(notifications, [{ message: "Refusing to create a PR from the repository default branch.", level: "error" }]);
  } finally {
    await rm(skillDirectory, { recursive: true, force: true });
  }
});

test("blocks a push that explicitly targets the repository default branch", async () => {
  const { command, handlers } = buildHarness(async (program, args) => {
    if (program === "gh") return { code: 0, stdout: JSON.stringify({ number: 42, title: "branch safety", body: "Build it." }), stderr: "" };
    if (args.join(" ") === "branch --show-current") return { code: 0, stdout: "build/42-branch-safety\n", stderr: "" };
    if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  });
  const context = {
    cwd: "/project", hasUI: true, isIdle: () => true, sessionManager: { getBranch: () => [] }, ui: { notify() {} },
  };

  await command.handler("42", context);
  const blocked = await handlers.get("tool_call")?.({
    toolName: "bash",
    toolCallId: "push-default",
    input: { command: "git push origin HEAD:main" },
  }, context) as { block?: boolean; reason?: string };

  assert.equal(blocked?.block, true);
  assert.match(blocked?.reason ?? "", /default branch/i);
});

test("uses GitHub's default branch when origin HEAD is unavailable", async () => {
  const calls: Array<[string, string[]]> = [];
  const { command, sentMessages } = buildHarness(async (program, args) => {
    calls.push([program, args]);
    if (program === "gh" && args[0] === "issue") {
      return { code: 0, stdout: JSON.stringify({ number: 42, title: "branch safety", body: "Build it." }), stderr: "" };
    }
    if (program === "gh" && args[0] === "repo") return { code: 0, stdout: "main\n", stderr: "" };
    if (args.join(" ") === "branch --show-current") return { code: 0, stdout: "main\n", stderr: "" };
    if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 1, stdout: "", stderr: "origin/HEAD is not set" };
    return { code: 0, stdout: "", stderr: "" };
  });
  const context = {
    cwd: "/project", hasUI: true, isIdle: () => true, sessionManager: { getBranch: () => [] }, ui: { notify() {} },
  };

  await command.handler("42", context);

  assert.ok(calls.some(([program, args]) => program === "gh" && args.join(" ") === "repo view --json defaultBranchRef --jq .defaultBranchRef.name"));
  assert.ok(calls.some(([program, args]) => program === "git" && args.join(" ") === "switch -c build/42-branch-safety"));
  assert.equal(sentMessages.length, 1);
});

test("checks out an existing issue branch after an interrupted build", async () => {
  const calls: Array<[string, string[]]> = [];
  const { command, sentMessages } = buildHarness(async (program, args) => {
    calls.push([program, args]);
    if (program === "gh") return { code: 0, stdout: JSON.stringify({ number: 42, title: "branch safety", body: "Build it." }), stderr: "" };
    if (args.join(" ") === "branch --show-current") return { code: 0, stdout: "main\n", stderr: "" };
    if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n", stderr: "" };
    if (args.join(" ") === "switch -c build/42-branch-safety") return { code: 1, stdout: "", stderr: "already exists" };
    return { code: 0, stdout: "", stderr: "" };
  });
  const context = {
    cwd: "/project", hasUI: true, isIdle: () => true, sessionManager: { getBranch: () => [] }, ui: { notify() {} },
  };

  await command.handler("42", context);

  assert.ok(calls.some(([program, args]) => program === "git" && args.join(" ") === "switch build/42-branch-safety"));
  assert.equal(sentMessages.length, 1);
});

test("blocks a chained commit and push that targets the default branch", async () => {
  const { command, handlers } = buildHarness(async (program, args) => {
    if (program === "gh") return { code: 0, stdout: JSON.stringify({ number: 42, title: "branch safety", body: "Build it." }), stderr: "" };
    if (args.join(" ") === "branch --show-current") return { code: 0, stdout: "build/42-branch-safety\n", stderr: "" };
    if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  });
  const context = {
    cwd: "/project", hasUI: true, isIdle: () => true, sessionManager: { getBranch: () => [] }, ui: { notify() {} },
  };

  await command.handler("42", context);
  const blocked = await handlers.get("tool_call")?.({
    toolName: "bash",
    toolCallId: "chain",
    input: { command: "git commit -m branch-safety && git push origin HEAD:main" },
  }, context) as { block?: boolean; reason?: string };

  assert.equal(blocked?.block, true);
  assert.match(blocked?.reason ?? "", /default branch/i);
});

test("does not mistake a feature branch ending in the default branch name for the default branch", async () => {
  const { command, handlers } = buildHarness(async (program, args) => {
    if (program === "gh") return { code: 0, stdout: JSON.stringify({ number: 42, title: "branch safety", body: "Build it." }), stderr: "" };
    if (args.join(" ") === "branch --show-current") return { code: 0, stdout: "build/42-branch-safety\n", stderr: "" };
    if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") return { code: 0, stdout: "origin/main\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  });
  const context = {
    cwd: "/project", hasUI: true, isIdle: () => true, sessionManager: { getBranch: () => [] }, ui: { notify() {} },
  };

  await command.handler("42", context);
  const blocked = await handlers.get("tool_call")?.({
    toolName: "bash",
    toolCallId: "feature-main",
    input: { command: "git push origin feature/main" },
  }, context) as { block?: boolean; reason?: string };

  assert.equal(blocked?.block, true);
  assert.doesNotMatch(blocked?.reason ?? "", /default branch/i);
  assert.match(blocked?.reason ?? "", /before commit/i);
});
