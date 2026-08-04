import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

const pinnedMattPocockSkills = [
  "code-review",
  "codebase-design",
  "diagnosing-bugs",
  "domain-modeling",
  "grilling",
  "prototype",
  "research",
  "resolving-merge-conflicts",
  "tdd",
  "to-spec",
  "to-tickets",
  "triage",
  "wayfinder",
  "setup-matt-pocock-skills",
  "improve-codebase-architecture",
].sort();

function getCommands(
  configDirectory: string,
  disabledResources: string[] = [],
  installPackages = false,
) {
  return spawnSync(
    resolve("node_modules/.bin/pi"),
    ["--approve", ...(installPackages ? [] : ["--offline"]), "--mode", "rpc", "--no-session", "--no-prompt-templates", "--no-themes", ...disabledResources],
    {
      cwd: process.cwd(),
      env: { ...process.env, HOME: configDirectory, PI_CODING_AGENT_DIR: configDirectory },
      input: '{"id":"commands","type":"get_commands"}\n',
      encoding: "utf8",
    },
  );
}

function parseCommands(stdout: string) {
  const responses = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id?: string; success?: boolean; data?: { commands?: Array<{ name: string; source?: string }> } });
  const response = responses.find((candidate) => candidate.id === "commands");

  assert.equal(response?.success, true);
  return response?.data?.commands ?? [];
}

test("loads /learning from the project-local package path", async () => {
  const configDirectory = await mkdtemp(resolve(tmpdir(), "my-pi-test-"));

  try {
    const result = getCommands(configDirectory, ["--no-skills"]);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(parseCommands(result.stdout).some((command) => command.name === "learning"));
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("loads exactly the pinned Matt Pocock skills", async () => {
  const configDirectory = await mkdtemp(resolve(tmpdir(), "my-pi-test-"));

  try {
    const result = getCommands(configDirectory, [], true);

    assert.equal(result.status, 0, result.stderr);
    const skillNames = parseCommands(result.stdout)
      .filter((command) => command.source === "skill")
      .map((command) => command.name.replace("skill:", ""))
      .sort();

    assert.deepEqual(skillNames, pinnedMattPocockSkills);
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("documents the immutable skill pin and pin-bump procedure", async () => {
  const [agentInstructions, pinDocument] = await Promise.all([
    readFile("AGENTS.md", "utf8"),
    readFile("docs/skills/mattpocock.md", "utf8"),
  ]);

  assert.match(agentInstructions, /docs\/skills\/mattpocock\.md/);
  assert.match(pinDocument, /git:github\.com\/mattpocock\/skills@2ab958093e83e0ec752e6c1c5932da465bf23e0c/);
  assert.match(pinDocument, /pi install -l git:github\.com\/mattpocock\/skills@<new-commit>/);
});
