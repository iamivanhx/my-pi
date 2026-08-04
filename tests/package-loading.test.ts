import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("loads /learning from the project-local package path", async () => {
  const configDirectory = await mkdtemp(resolve(tmpdir(), "my-pi-test-"));

  try {
    const result = spawnSync(
      resolve("node_modules/.bin/pi"),
      ["--approve", "--offline", "--mode", "rpc", "--no-session", "--no-skills", "--no-prompt-templates", "--no-themes"],
      {
        cwd: process.cwd(),
        env: { ...process.env, PI_CODING_AGENT_DIR: configDirectory },
        input: '{"id":"commands","type":"get_commands"}\n',
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const responses = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id?: string; success?: boolean; data?: { commands?: Array<{ name: string }> } });
    const response = responses.find((candidate) => candidate.id === "commands");

    assert.equal(response?.success, true);
    assert.ok(response?.data?.commands?.some((command) => command.name === "learning"));
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});
