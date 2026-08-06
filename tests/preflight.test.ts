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
  const responses = new Map<string, (payload: unknown) => unknown>();
  const calls: Array<[string, string[]]> = [];
  const notifications: Array<{ message: string; level: string }> = [];

  preflightExtension({
    exec: async (program: string, args: string[]): Promise<CommandResult> => {
      calls.push([program, args]);
      if (args[0] === "pr" && args[1] === "view") {
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 52,
            title: "Implement slim preflight",
            body: "",
            headRefName: "build/32-preflight-slim-gate",
            baseRefName: "main",
            closingIssuesReferences: [{ number: 32 }],
            statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
          }),
          stderr: "",
        };
      }
      if (args.join(" ") === "issue view 32 --json body,comments") return { code: 0, stdout: JSON.stringify({ body: "- [ ] Draft description", comments: [{ body: "pr-reviewer-gpt: prior cross-family look" }] }), stderr: "" };
      if (args.join(" ") === "pr diff 52") return { code: 0, stdout: "diff --git a/a.ts b/a.ts", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    sendUserMessage() {},
    registerCommand(name: string, command: PreflightCommand) {
      commands.set(name, command);
    },
    events: {
      emit(event: string, payload: unknown) {
        emitted.push({ event, payload });
      },
      on(event: string, handler: (payload: unknown) => unknown) { responses.set(event, handler); },
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
      confirm: async () => true,
    },
  });

  assert.deepEqual(notifications, []);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.event, "prompt-template:subagent:request");
  assert.deepEqual(emitted[0]?.payload, {
    version: 1,
    requestId: (emitted[0]?.payload as { requestId: string }).requestId,
    agent: "writer",
    context: "fresh",
    cwd: "/project",
    task: "Draft a concise pull-request description for PR #52 from its linked Issue. Do not invent decisions.\n\nIssue #32",
  });

  await responses.get("prompt-template:subagent:response")?.({
    requestId: (emitted[0]?.payload as { requestId: string }).requestId,
    status: "completed",
    output: "## Summary\n\nWriter draft.",
  });
  assert.ok(calls.some(([program, args]) => program === "gh" && args.join(" ") === "pr edit 52 --body ## Summary\n\nWriter draft."));
});

test("/preflight runs slim checks and records a human GO after presenting the diff and acceptance criteria", async () => {
  const commands = new Map<string, PreflightCommand>();
  const calls: Array<[string, string[]]> = [];
  const messages: string[] = [];

  preflightExtension({
    exec: async (program: string, args: string[]): Promise<CommandResult> => {
      calls.push([program, args]);
      if (args[0] === "pr" && args[1] === "view") return { code: 0, stdout: JSON.stringify({ number: 52, body: "Ready for review.", closingIssuesReferences: [{ number: 32 }], statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }] }), stderr: "" };
      if (args.join(" ") === "issue view 32 --json body,comments") return { code: 0, stdout: JSON.stringify({ body: "## Acceptance criteria\n- [ ] CI is green\n- [ ] Human sees the diff", comments: [{ body: "pr-reviewer-claude: No actionable findings." }] }), stderr: "" };
      if (args.join(" ") === "pr diff 52") return { code: 0, stdout: "diff --git a/a.ts b/a.ts\n+export const ready = true;", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    sendUserMessage(message: string) { messages.push(message); },
    registerCommand(name: string, command: PreflightCommand) { commands.set(name, command); },
    events: { emit() {}, on() {} },
  } as never);

  await commands.get("preflight")!.handler("", {
    cwd: "/project", hasUI: true, isIdle: () => true,
    ui: { notify() {}, confirm: async () => true },
  });

  assert.match(messages[0] ?? "", /diff --git a\/a\.ts b\/a\.ts/);
  assert.match(messages[0] ?? "", /- \[ \] CI is green/);
  assert.ok(calls.some(([program, args]) => program === "gh" && args.join(" ") === "pr ready 52"));
  assert.ok(calls.some(([program, args]) => program === "gh" && args[0] === "pr" && args[1] === "comment" && args[2] === "52" && args.at(-1)?.includes("GO")));
});
