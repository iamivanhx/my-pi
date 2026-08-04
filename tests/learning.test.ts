import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import learningExtension from "../extensions/learning.ts";

const domainModelingSkillPath = fileURLToPath(new URL("./fixtures/domain-modeling.md", import.meta.url));

type LearningCommand = {
  handler: (args: string, context: unknown) => Promise<void>;
};

function registerLearningCommand({
  exec = async () => ({ code: 0, stdout: "", stderr: "" }),
  sendUserMessage = () => {},
}: {
  exec?: (...args: never[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  sendUserMessage?: (message: string) => void;
} = {}): LearningCommand {
  const commands = new Map<string, LearningCommand>();

  learningExtension({
    exec,
    sendUserMessage,
    registerCommand(name: string, command: LearningCommand) {
      commands.set(name, command);
    },
  } as never);

  assert.equal(commands.size, 1);
  const command = commands.get("learning");
  assert.ok(command);
  return command;
}

test("registers the /learning command", () => {
  registerLearningCommand();
});

test("files a product learning with gh in the current project", async () => {
  const execCalls: unknown[][] = [];
  const command = registerLearningCommand({
    exec: async (...args: never[]) => {
      execCalls.push(args);
      return { code: 0, stdout: "https://github.com/acme/product/issues/1\n", stderr: "" };
    },
  });

  await command.handler("A release needs a smoke test.", {
    cwd: "/project",
    hasUI: true,
    isIdle: () => true,
    ui: {
      select: async () => "Product Issue",
      notify: () => {},
    },
    getSystemPromptOptions: () => ({}),
  });

  assert.deepEqual(execCalls, [[
    "gh",
    [
      "issue",
      "create",
      "--title",
      "Learning: A release needs a smoke test.",
      "--body",
      "## Learning\n\nA release needs a smoke test.\n\nFiled by `/learning`.",
    ],
    { cwd: "/project", timeout: 10_000 },
  ]]);
});

test("files workflow defects in the my-pi tracker", async () => {
  const execCalls: unknown[][] = [];
  const command = registerLearningCommand({
    exec: async (...args: never[]) => {
      execCalls.push(args);
      return { code: 0, stdout: "https://github.com/iamivanhx/my-pi/issues/24\n", stderr: "" };
    },
  });

  await command.handler("The learning route did not explain its choices.", {
    cwd: "/product",
    hasUI: true,
    isIdle: () => true,
    ui: {
      select: async () => "my-pi workflow defect",
      notify: () => {},
    },
    getSystemPromptOptions: () => ({}),
  });

  assert.deepEqual(execCalls, [[
    "gh",
    [
      "issue",
      "create",
      "--repo",
      "iamivanhx/my-pi",
      "--title",
      "Workflow learning: The learning route did not explain its choices.",
      "--body",
      "## Workflow learning\n\nThe learning route did not explain its choices.\n\nFiled by `/learning`.",
    ],
    { cwd: "/product", timeout: 10_000 },
  ]]);
});

test("injects the loaded domain-modeling skill for a glossary or ADR learning", async () => {
  const sentMessages: string[] = [];
  const command = registerLearningCommand({
    sendUserMessage(message: string) {
      sentMessages.push(message);
    },
  });

  await command.handler("Call it a release check, not a launch test.", {
    cwd: "/product",
    hasUI: true,
    isIdle: () => true,
    ui: {
      select: async () => "Glossary or ADR",
      notify: () => {},
    },
    getSystemPromptOptions: () => ({
      skills: [{ name: "domain-modeling", filePath: domainModelingSkillPath }],
    }),
  });

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /<skill name="domain-modeling" location=/);
  assert.match(sentMessages[0], /# Domain Modeling/);
  assert.match(sentMessages[0], /Call it a release check, not a launch test\./);
  assert.doesNotMatch(sentMessages[0], /description: Build and sharpen/);
});
