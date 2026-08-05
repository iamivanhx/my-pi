import assert from "node:assert/strict";
import test from "node:test";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import setupExtension from "../extensions/setup.ts";

type SetupCommand = {
  handler: (args: string, context: unknown) => Promise<void>;
};

function registerSetupCommand(sendUserMessage: (message: string) => void = () => {}): SetupCommand {
  const commands = new Map<string, SetupCommand>();

  setupExtension({
    sendUserMessage,
    registerCommand(name: string, command: SetupCommand) {
      commands.set(name, command);
    },
  } as never);

  assert.equal(commands.size, 1);
  const command = commands.get("setup");
  assert.ok(command);
  return command;
}

test("registers the /setup command", () => {
  registerSetupCommand();
});

test("injects the pinned setup skill and starts the slim shipping interview", async () => {
  const skillDirectory = await mkdtemp(join(tmpdir(), "my-pi-setup-test-"));
  const skillPath = join(skillDirectory, "SKILL.md");
  const sentMessages: string[] = [];
  await writeFile(skillPath, "---\nname: setup-matt-pocock-skills\n---\n\n# Pinned setup skill\n");

  try {
    const command = registerSetupCommand((message: string) => {
      sentMessages.push(message);
    });

    await command.handler("", {
      hasUI: true,
      isIdle: () => true,
      ui: { notify: () => {} },
      getSystemPromptOptions: () => ({
        skills: [{ name: "setup-matt-pocock-skills", filePath: skillPath }],
      }),
    });

    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0], new RegExp(`<skill name="setup-matt-pocock-skills" location="${skillPath}">`));
    assert.match(sentMessages[0], /name: setup-matt-pocock-skills/);
    assert.match(sentMessages[0], /# Pinned setup skill/);
    assert.match(sentMessages[0], /deploy command per environment/i);
    assert.match(sentMessages[0], /health-check\/verify command/i);
    assert.match(sentMessages[0], /rollback move/i);
    assert.match(sentMessages[0], /CI check name/i);
    assert.match(sentMessages[0], /monitoring URL optional/i);
    assert.doesNotMatch(sentMessages[0], /flag-system/i);
    assert.doesNotMatch(sentMessages[0], /external-PR-bot/i);
    assert.doesNotMatch(sentMessages[0], /rollout-mode/i);
  } finally {
    await rm(skillDirectory, { recursive: true, force: true });
  }
});
