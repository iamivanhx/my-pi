import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import defineExtension from "../extensions/define.ts";

type DefineCommand = {
  handler: (args: string, context: unknown) => Promise<void>;
};

test("/define forces greenfield ideas through the wayfinder chart before any writer dispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "my-pi-define-test-"));
  const skillPath = join(directory, "wayfinder.md");
  await writeFile(skillPath, "# Wayfinder instructions\n");

  try {
    const commands = new Map<string, DefineCommand>();
    const messages: string[] = [];
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const selections: string[][] = [];

    defineExtension({
      registerCommand(name: string, command: DefineCommand) {
        commands.set(name, command);
      },
      sendUserMessage(message: string) {
        messages.push(message);
      },
      events: {
        emit(event: string, payload: unknown) {
          emitted.push({ event, payload });
        },
      },
    } as never);

    const command = commands.get("define");
    assert.ok(command);

    await command.handler("Create a new reading-list app.", {
      hasUI: true,
      isIdle: () => true,
      cwd: "/project",
      ui: {
        select: async (_prompt: string, options: string[]) => {
          selections.push(options);
          return options.includes("Greenfield") ? "Greenfield" : "Draft a settled spec";
        },
        notify() {},
      },
      getSystemPromptOptions: () => ({
        skills: [{ name: "wayfinder", filePath: skillPath }],
      }),
    });

    assert.deepEqual(selections, [["Existing project", "Greenfield"]]);
    assert.equal(emitted.length, 0);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /greenfield/i);
    assert.match(messages[0], /chart/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("/define dispatches writer then both reviewer lanes through pi-subagents when decisions are settled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "my-pi-define-test-"));
  const skillPath = join(directory, "wayfinder.md");
  await writeFile(skillPath, "# Wayfinder instructions\n");

  try {
    const commands = new Map<string, DefineCommand>();
    const emitted: Array<{ event: string; payload: unknown }> = [];

    defineExtension({
      registerCommand(name: string, command: DefineCommand) {
        commands.set(name, command);
      },
      sendUserMessage() {},
      events: {
        emit(event: string, payload: unknown) {
          emitted.push({ event, payload });
        },
        on() {},
      },
    } as never);

    const command = commands.get("define");
    assert.ok(command);

    await command.handler("Add saved searches to the existing app.", {
      hasUI: true,
      isIdle: () => true,
      cwd: "/project",
      ui: {
        select: async (_prompt: string, options: string[]) => (
          options.includes("Draft a settled spec") ? "Draft a settled spec" : "Existing project"
        ),
        notify() {},
      },
      getSystemPromptOptions: () => ({
        skills: [{ name: "wayfinder", filePath: skillPath }],
      }),
    });

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, "subagents:rpc:v1:request");
    assert.deepEqual(emitted[0].payload, {
      version: 1,
      requestId: (emitted[0].payload as { requestId: string }).requestId,
      method: "spawn",
      params: {
        context: "fresh",
        cwd: "/project",
        chain: [
          {
            agent: "writer",
            task: "Draft a decision-complete specification from the settled decisions. Surface unresolved decisions instead of inventing them.\n\nIdea:\nAdd saved searches to the existing app.",
          },
          {
            parallel: [
              {
                agent: "pr-reviewer-claude",
                task: "Review this specification against the settled decisions. Report actionable gaps using the findings contract.\n\n{previous}",
              },
              {
                agent: "pr-reviewer-gpt",
                task: "Review this specification against the settled decisions. Report actionable gaps using the findings contract.\n\n{previous}",
              },
            ],
          },
        ],
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("/define reports pi-subagents launch failures", async () => {
  const commands = new Map<string, DefineCommand>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const replies = new Map<string, (payload: unknown) => void>();
  const notifications: Array<{ message: string; level: string }> = [];

  defineExtension({
    registerCommand(name: string, command: DefineCommand) {
      commands.set(name, command);
    },
    sendUserMessage() {},
    events: {
      emit(event: string, payload: unknown) {
        emitted.push({ event, payload });
      },
      on(event: string, handler: (payload: unknown) => void) {
        replies.set(event, handler);
      },
    },
  } as never);

  const command = commands.get("define");
  assert.ok(command);

  await command.handler("Draft this settled decision.", {
    hasUI: true,
    isIdle: () => true,
    cwd: "/project",
    ui: {
      select: async (_prompt: string, options: string[]) => (
        options.includes("Draft a settled spec") ? "Draft a settled spec" : "Existing project"
      ),
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
    getSystemPromptOptions: () => ({ skills: [] }),
  });

  const requestId = (emitted[0]?.payload as { requestId?: string } | undefined)?.requestId;
  assert.ok(requestId);
  const reply = replies.get(`subagents:rpc:v1:reply:${requestId}`);
  assert.ok(reply);
  reply({ success: false, error: { message: "writer is unavailable" } });

  assert.deepEqual(notifications, [{
    message: "Could not dispatch the define workflow: writer is unavailable",
    level: "error",
  }]);
});

test("/define acknowledges dispatched work that pi-subagents will surface on completion", async () => {
  const commands = new Map<string, DefineCommand>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const replies = new Map<string, (payload: unknown) => void>();
  const notifications: Array<{ message: string; level: string }> = [];

  defineExtension({
    registerCommand(name: string, command: DefineCommand) {
      commands.set(name, command);
    },
    sendUserMessage() {},
    events: {
      emit(event: string, payload: unknown) {
        emitted.push({ event, payload });
      },
      on(event: string, handler: (payload: unknown) => void) {
        replies.set(event, handler);
      },
    },
  } as never);

  const command = commands.get("define");
  assert.ok(command);

  await command.handler("Draft this settled decision.", {
    hasUI: true,
    isIdle: () => true,
    cwd: "/project",
    ui: {
      select: async (_prompt: string, options: string[]) => (
        options.includes("Draft a settled spec") ? "Draft a settled spec" : "Existing project"
      ),
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
    getSystemPromptOptions: () => ({ skills: [] }),
  });

  const requestId = (emitted[0]?.payload as { requestId?: string } | undefined)?.requestId;
  assert.ok(requestId);
  replies.get(`subagents:rpc:v1:reply:${requestId}`)?.({ success: true, data: {} });

  assert.deepEqual(notifications, [{
    message: "Define workflow dispatched; pi-subagents will surface the completed result.",
    level: "info",
  }]);
});

test("/define removes its RPC reply listener after the dispatch reply", async () => {
  const commands = new Map<string, DefineCommand>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const replies = new Map<string, (payload: unknown) => void>();
  let unsubscribeCount = 0;

  defineExtension({
    registerCommand(name: string, command: DefineCommand) {
      commands.set(name, command);
    },
    sendUserMessage() {},
    events: {
      emit(event: string, payload: unknown) {
        emitted.push({ event, payload });
      },
      on(event: string, handler: (payload: unknown) => void) {
        replies.set(event, handler);
        return () => { unsubscribeCount++; };
      },
    },
  } as never);

  const command = commands.get("define");
  assert.ok(command);

  await command.handler("Draft this settled decision.", {
    hasUI: true,
    isIdle: () => true,
    cwd: "/project",
    ui: {
      select: async (_prompt: string, options: string[]) => (
        options.includes("Draft a settled spec") ? "Draft a settled spec" : "Existing project"
      ),
      notify() {},
    },
    getSystemPromptOptions: () => ({ skills: [] }),
  });

  const requestId = (emitted[0]?.payload as { requestId?: string } | undefined)?.requestId;
  assert.ok(requestId);
  replies.get(`subagents:rpc:v1:reply:${requestId}`)?.({ success: true, data: {} });

  assert.equal(unsubscribeCount, 1);
});

test("/define dispatches researcher without requiring the wayfinder skill for a research ticket", async () => {
  const commands = new Map<string, DefineCommand>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const notifications: Array<{ message: string; level: string }> = [];

  defineExtension({
    registerCommand(name: string, command: DefineCommand) {
      commands.set(name, command);
    },
    sendUserMessage() {},
    events: {
      emit(event: string, payload: unknown) {
        emitted.push({ event, payload });
      },
      on() {},
    },
  } as never);

  const command = commands.get("define");
  assert.ok(command);

  await command.handler("Which provider supports signed webhooks?", {
    hasUI: true,
    isIdle: () => true,
    cwd: "/project",
    ui: {
      select: async (_prompt: string, options: string[]) => (
        options.includes("Resolve a research ticket") ? "Resolve a research ticket" : "Existing project"
      ),
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
    getSystemPromptOptions: () => ({ skills: [] }),
  });

  assert.deepEqual(notifications, []);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "subagents:rpc:v1:request");
  assert.deepEqual(emitted[0].payload, {
    version: 1,
    requestId: (emitted[0].payload as { requestId: string }).requestId,
    method: "spawn",
    params: {
      agent: "researcher",
      context: "fresh",
      cwd: "/project",
      task: "Resolve this research ticket with primary sources where available. Distinguish verified facts from inferences and cite supporting sources.\n\nResearch question:\nWhich provider supports signed webhooks?",
    },
  });
});

test("/define offers a prototype detour for a look-or-behavior unknown and injects its skill", async () => {
  const directory = await mkdtemp(join(tmpdir(), "my-pi-define-test-"));
  const prototypePath = join(directory, "prototype.md");
  await writeFile(prototypePath, "# Prototype instructions\n");

  try {
    const commands = new Map<string, DefineCommand>();
    const messages: string[] = [];
    const selections: string[][] = [];

    defineExtension({
      registerCommand(name: string, command: DefineCommand) {
        commands.set(name, command);
      },
      sendUserMessage(message: string) {
        messages.push(message);
      },
      events: { emit() {}, on() {} },
    } as never);

    const command = commands.get("define");
    assert.ok(command);

    await command.handler("Should the saved-search builder be a modal or a page?", {
      hasUI: true,
      isIdle: () => true,
      cwd: "/project",
      ui: {
        select: async (_prompt: string, options: string[]) => {
          selections.push(options);
          return options.includes("Prototype look or behavior") ? "Prototype look or behavior" : "Existing project";
        },
        notify() {},
      },
      getSystemPromptOptions: () => ({
        skills: [{ name: "prototype", filePath: prototypePath }],
      }),
    });

    assert.ok(selections[1]?.includes("Prototype look or behavior"));
    assert.equal(messages.length, 1);
    assert.match(messages[0], /look or behavior/i);
    assert.match(messages[0], new RegExp(`<skill name="prototype" location="${prototypePath}">`));
    assert.match(messages[0], /# Prototype instructions/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("/define injects conditional lenses only to produce Issue acceptance criteria", async () => {
  const directory = await mkdtemp(join(tmpdir(), "my-pi-define-test-"));
  const threatModelPath = join(directory, "threat-model.md");
  const observabilityPath = join(directory, "observability.md");
  await Promise.all([
    writeFile(threatModelPath, "# Threat model instructions\n"),
    writeFile(observabilityPath, "# Observability instructions\n"),
  ]);

  try {
    const commands = new Map<string, DefineCommand>();
    const messages: string[] = [];
    const lenses = ["Apply threat-model lens", "Apply observability lens"];
    let nextLens = 0;

    defineExtension({
      registerCommand(name: string, command: DefineCommand) {
        commands.set(name, command);
      },
      sendUserMessage(message: string) {
        messages.push(message);
      },
      events: { emit() {}, on() {} },
    } as never);

    const command = commands.get("define");
    assert.ok(command);
    const context = {
      hasUI: true,
      isIdle: () => true,
      cwd: "/project",
      ui: {
        select: async (_prompt: string, options: string[]) => (
          options.includes(lenses[nextLens] ?? "") ? lenses[nextLens++]! : "Existing project"
        ),
        notify() {},
      },
      getSystemPromptOptions: () => ({
        skills: [
          { name: "threat-model", filePath: threatModelPath },
          { name: "observability", filePath: observabilityPath },
        ],
      }),
    };

    await command.handler("Add saved searches.", context);
    await command.handler("Add saved searches.", context);

    assert.equal(messages.length, 2);
    assert.match(messages[0], new RegExp(`<skill name="threat-model" location="${threatModelPath}">`));
    assert.match(messages[0], /# Threat model instructions/);
    assert.match(messages[1], new RegExp(`<skill name="observability" location="${observabilityPath}">`));
    assert.match(messages[1], /# Observability instructions/);
    for (const message of messages) {
      assert.match(message, /acceptance criteria/i);
      assert.match(message, /never create a separate lens document/i);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("/define always begins a greenfield idea with an explicitly injected wayfinder chart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "my-pi-define-test-"));
  const skillPath = join(directory, "wayfinder.md");
  await writeFile(skillPath, "# Wayfinder instructions\n");

  try {
    const commands = new Map<string, DefineCommand>();
    const messages: string[] = [];

    defineExtension({
      registerCommand(name: string, command: DefineCommand) {
        commands.set(name, command);
      },
      sendUserMessage(message: string) {
        messages.push(message);
      },
    } as never);

    const command = commands.get("define");
    assert.ok(command);

    await command.handler("Create a new CLI for managing reading lists.", {
      hasUI: true,
      isIdle: () => true,
      cwd: "/project",
      ui: {
        select: async () => "Greenfield",
        notify() {},
      },
      getSystemPromptOptions: () => ({
        skills: [{ name: "wayfinder", filePath: skillPath }],
      }),
    });

    assert.equal(messages.length, 1);
    assert.match(messages[0], /greenfield/i);
    assert.match(messages[0], new RegExp(`<skill name="wayfinder" location="${skillPath}">`));
    assert.match(messages[0], /# Wayfinder instructions/);
    assert.match(messages[0], /chart/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
