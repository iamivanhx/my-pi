import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import shipExtension from "../extensions/ship.ts";

type ShipCommand = {
  handler: (args: string, context: unknown) => Promise<void>;
};

type Notify = (message: string, level: "info" | "warning" | "error") => void;
type CommandResult = { code: number; stdout: string; stderr: string };
type Exec = (command: string, args: string[], options: { cwd: string; timeout: number }) => Promise<CommandResult>;

function shippingDocument(content: object): string {
  return `---\n${JSON.stringify(content, null, 2)}\n---\n`;
}

function validShippingDocument(): string {
  return shippingDocument({
    environments: {
      staging: {
        deploy: "pnpm deploy:staging",
        verify: "pnpm verify:staging",
      },
      production: {
        deploy: "pnpm deploy:production",
        verify: "pnpm verify:production",
      },
    },
    rollback: "pnpm rollback -- --environment {environment}",
    ciCheck: "release",
    monitoringUrl: "https://monitoring.example.test/releases",
  });
}

function registerShipCommand(exec: Exec = async () => ({ code: 0, stdout: "", stderr: "" })): ShipCommand {
  const commands = new Map<string, ShipCommand>();

  shipExtension({
    exec,
    registerCommand(name: string, command: ShipCommand) {
      commands.set(name, command);
    },
  } as never);

  assert.equal(commands.size, 1);
  const command = commands.get("ship");
  assert.ok(command);
  return command;
}

function interactiveContext(
  cwd: string,
  notify: Notify,
  select: (title: string, options: string[]) => Promise<string | undefined> = async () => undefined,
) {
  return {
    cwd,
    hasUI: true,
    isIdle: () => true,
    ui: { notify, select },
  };
}

test("registers the /ship command", () => {
  registerShipCommand();
});

test("points to /setup when shipping.md is absent without starting a ship", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "my-pi-ship-test-"));
  const execCalls: unknown[][] = [];
  const notifications: Array<{ message: string; level: string }> = [];

  try {
    const command = registerShipCommand(async (command, args, options) => {
      execCalls.push([command, args, options]);
      return { code: 0, stdout: "", stderr: "" };
    });
    await command.handler("", interactiveContext(cwd, (message, level) => notifications.push({ message, level })));

    assert.deepEqual(execCalls, []);
    assert.deepEqual(notifications, [{
      message: "No shipping.md found. Run /setup to record this project's shipping workflow.",
      level: "warning",
    }]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("points to /setup when shipping.md is incomplete without starting a ship", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "my-pi-ship-test-"));
  const execCalls: unknown[][] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  await writeFile(join(cwd, "shipping.md"), shippingDocument({
    environments: { staging: { deploy: "pnpm deploy:staging" } },
    rollback: "pnpm rollback -- --environment {environment}",
    ciCheck: "release",
  }));

  try {
    const command = registerShipCommand(async (command, args, options) => {
      execCalls.push([command, args, options]);
      return { code: 0, stdout: "", stderr: "" };
    });
    await command.handler("", interactiveContext(cwd, (message, level) => notifications.push({ message, level })));

    assert.deepEqual(execCalls, []);
    assert.deepEqual(notifications, [{
      message: "shipping.md is incomplete (environments.staging.verify). Run /setup to complete it before shipping.",
      level: "warning",
    }]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("deploys, verifies, and checks command output for changed-path errors", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "my-pi-ship-test-"));
  const execCalls: unknown[][] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  await writeFile(join(cwd, "shipping.md"), validShippingDocument());

  try {
    const command = registerShipCommand(async (command, args, options) => {
      execCalls.push([command, args, options]);
      return { code: 0, stdout: "", stderr: "" };
    });
    await command.handler("production", interactiveContext(cwd, (message, level) => notifications.push({ message, level })));

    assert.deepEqual(execCalls, [
      ["sh", ["-lc", "pnpm deploy:production"], { cwd, timeout: 900_000 }],
      ["sh", ["-lc", "pnpm verify:production"], { cwd, timeout: 900_000 }],
    ]);
    assert.deepEqual(notifications, [
      { message: "Rollback ready for production: pnpm rollback -- --environment production", level: "info" },
      { message: "Deploying production...", level: "info" },
      { message: "Deployment to production succeeded.", level: "info" },
      { message: "Verifying production...", level: "info" },
      { message: "Verification for production succeeded.", level: "info" },
      {
        message: "No errors reported while shipping the changed path. Review CI check: release. Monitoring: https://monitoring.example.test/releases",
        level: "info",
      },
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("surfaces errors reported by deploy or verify output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "my-pi-ship-test-"));
  const notifications: Array<{ message: string; level: string }> = [];
  await writeFile(join(cwd, "shipping.md"), validShippingDocument());

  try {
    const command = registerShipCommand(async (_command, _args, _options) => ({
      code: 0,
      stdout: "ERROR: new handler returned a 500 response",
      stderr: "",
    }));
    await command.handler("production", interactiveContext(cwd, (message, level) => notifications.push({ message, level })));

    assert.deepEqual(notifications.at(-1), {
      message: "Errors reported while shipping the changed path:\nERROR: new handler returned a 500 response\nReview CI check: release. Monitoring: https://monitoring.example.test/releases",
      level: "warning",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("does not flag successful zero-error output as a shipping error", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "my-pi-ship-test-"));
  const notifications: Array<{ message: string; level: string }> = [];
  await writeFile(join(cwd, "shipping.md"), validShippingDocument());

  try {
    const command = registerShipCommand(async (_command, _args, _options) => ({
      code: 0,
      stdout: "0 errors found",
      stderr: "",
    }));
    await command.handler("production", interactiveContext(cwd, (message, level) => notifications.push({ message, level })));

    assert.equal(notifications.at(-1)?.level, "info");
    assert.match(notifications.at(-1)?.message ?? "", /No errors reported while shipping the changed path/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("does not verify after a failed deploy and keeps the rollback visible", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "my-pi-ship-test-"));
  const execCalls: unknown[][] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  await writeFile(join(cwd, "shipping.md"), validShippingDocument());

  try {
    const command = registerShipCommand(async (command, args, options) => {
      execCalls.push([command, args, options]);
      return { code: 1, stdout: "", stderr: "deployment denied" };
    });
    await command.handler("production", interactiveContext(cwd, (message, level) => notifications.push({ message, level })));

    assert.deepEqual(execCalls, [["sh", ["-lc", "pnpm deploy:production"], { cwd, timeout: 900_000 }]]);
    assert.deepEqual(notifications, [
      { message: "Rollback ready for production: pnpm rollback -- --environment production", level: "info" },
      { message: "Deploying production...", level: "info" },
      { message: "Deploy failed:\ndeployment denied", level: "error" },
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("asks the human to select from documented environments", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "my-pi-ship-test-"));
  const selections: unknown[][] = [];
  await writeFile(join(cwd, "shipping.md"), validShippingDocument());

  try {
    const command = registerShipCommand();
    await command.handler("", interactiveContext(cwd, () => {}, async (title, options) => {
      selections.push([title, options]);
      return "staging";
    }));

    assert.deepEqual(selections, [["Choose an environment to ship", ["production", "staging"]]]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rejects a requested environment that the shipping document does not define", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "my-pi-ship-test-"));
  const execCalls: unknown[][] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  await writeFile(join(cwd, "shipping.md"), validShippingDocument());

  try {
    const command = registerShipCommand(async (command, args, options) => {
      execCalls.push([command, args, options]);
      return { code: 0, stdout: "", stderr: "" };
    });
    await command.handler("development", interactiveContext(cwd, (message, level) => notifications.push({ message, level })));

    assert.deepEqual(execCalls, []);
    assert.deepEqual(notifications, [{
      message: "shipping.md does not define the development environment. Choose one of: production, staging.",
      level: "warning",
    }]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
