import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import defineExtension from "../extensions/define.ts";

type DefineCommand = {
  handler: (args: string, context: unknown) => Promise<void>;
};

test("/define dispatches writer through pi-subagents when decisions are settled", async () => {
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
        agent: "writer",
        context: "fresh",
        cwd: "/project",
        task: "Draft a decision-complete specification from the settled decisions. Surface unresolved decisions instead of inventing them.\n\nIdea:\nAdd saved searches to the existing app.",
      },
    });
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
