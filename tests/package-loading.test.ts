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
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: configDirectory, PI_CODING_AGENT_DIR: configDirectory };
  delete env.PI_SUBAGENT_CHILD;

  return spawnSync(
    resolve("node_modules/.bin/pi"),
    ["--approve", ...(installPackages ? [] : ["--offline"]), "--mode", "rpc", "--no-session", "--no-prompt-templates", "--no-themes", ...disabledResources],
    {
      cwd: process.cwd(),
      env,
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

test("loads /build, /learning, /setup, and /ship from the project-local package path", async () => {
  const configDirectory = await mkdtemp(resolve(tmpdir(), "my-pi-test-"));

  try {
    const result = getCommands(configDirectory, ["--no-skills"]);

    assert.equal(result.status, 0, result.stderr);
    const commandNames = parseCommands(result.stdout).map((command) => command.name);
    assert.ok(commandNames.includes("build"));
    assert.ok(commandNames.includes("learning"));
    assert.ok(commandNames.includes("setup"));
    assert.ok(commandNames.includes("ship"));
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("loads pi-subagents alongside the packaged roster", async () => {
  const configDirectory = await mkdtemp(resolve(tmpdir(), "my-pi-test-"));

  try {
    const result = getCommands(configDirectory, ["--no-skills"], true);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(parseCommands(result.stdout).some((command) => command.name === "subagents"));
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("loads the pinned Matt Pocock and designer skills", async () => {
  const configDirectory = await mkdtemp(resolve(tmpdir(), "my-pi-test-"));

  try {
    const result = getCommands(configDirectory, [], true);

    assert.equal(result.status, 0, result.stderr);
    const skillNames = parseCommands(result.stdout)
      .filter((command) => command.source === "skill")
      .map((command) => command.name.replace("skill:", ""))
      .sort();

    assert.deepEqual(skillNames, [
      ...pinnedMattPocockSkills,
      "design-system",
      "frontend-design",
      "observability",
      "threat-model",
      "web-design-guidelines",
    ].sort());
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("documents immutable skill pins and their bump procedures", async () => {
  const [agentInstructions, mattPocockPin, designerPin] = await Promise.all([
    readFile("AGENTS.md", "utf8"),
    readFile("docs/skills/mattpocock.md", "utf8"),
    readFile("docs/skills/designer.md", "utf8"),
  ]);

  assert.match(agentInstructions, /docs\/skills\/mattpocock\.md/);
  assert.match(agentInstructions, /docs\/skills\/designer\.md/);
  assert.match(mattPocockPin, /git:github\.com\/mattpocock\/skills@2ffb184ffbb752faa664c0b204f3c9241b1428e9/);
  assert.match(mattPocockPin, /pi install -l git:github\.com\/mattpocock\/skills@<new-commit>/);
  assert.match(designerPin, /b29e7cf65e5cb78a5ac33d582270551bc74a14eb/);
  assert.match(designerPin, /4e799d45c17aec1498c269287a83b9dba22b966b/);
  assert.match(designerPin, /pnpm test/);
});
