import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import defineExtension from "../extensions/define.ts";

type DefineCommand = {
  handler: (args: string, context: unknown) => Promise<void>;
};

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
