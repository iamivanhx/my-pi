import assert from "node:assert/strict";
import test from "node:test";

import preflightExtension from "../extensions/preflight.ts";

type PreflightCommand = {
  handler: (args: string, context: unknown) => Promise<void>;
};

type CommandResult = { code: number; stdout: string; stderr: string };

test("/preflight dispatches writer for a single-Issue PR with no description", async () => {
  const commands = new Map<string, PreflightCommand>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const notifications: Array<{ message: string; level: string }> = [];

  preflightExtension({
    exec: async (_program: string, args: string[]): Promise<CommandResult> => {
      if (args.join(" ") === "pr view --json number,title,body,closingIssuesReferences,headRefName,baseRefName") {
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 52,
            title: "Implement slim preflight",
            body: "",
            headRefName: "build/32-preflight-slim-gate",
            baseRefName: "main",
            closingIssuesReferences: [{ number: 32 }],
          }),
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    registerCommand(name: string, command: PreflightCommand) {
      commands.set(name, command);
    },
    events: {
      emit(event: string, payload: unknown) {
        emitted.push({ event, payload });
      },
      on() {},
    },
  } as never);

  const command = commands.get("preflight");
  assert.ok(command);

  await command.handler("", {
    cwd: "/project",
    hasUI: true,
    isIdle: () => true,
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  });

  assert.deepEqual(notifications, []);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.event, "subagents:rpc:v1:request");
  assert.deepEqual(emitted[0]?.payload, {
    version: 1,
    requestId: (emitted[0]?.payload as { requestId: string }).requestId,
    method: "spawn",
    params: {
      agent: "writer",
      context: "fresh",
      cwd: "/project",
      task: "Draft a concise pull-request description for PR #52 from its linked Issue. Do not invent decisions.\n\nIssue #32",
    },
  });
});
