import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

type PackageManifest = {
  "pi-subagents"?: { agents?: string[] };
};

type SubagentSettings = {
  packages?: unknown[];
  subagents?: {
    defaultModel?: string;
    agentOverrides?: Record<string, { model?: string; fallbackModels?: string[] }>;
  };
};

const findingAgents = [
  "issue-reviewer",
  "pr-reviewer-claude",
  "pr-reviewer-gpt",
  "security-auditor",
  "perf-auditor",
];

const expectedModels: Record<string, { model: string; fallbackModels?: string[] }> = {
  writer: { model: "openai-codex/gpt-5.6-luna:low" },
  researcher: { model: "claude-bridge/claude-sonnet-5:medium" },
  "issue-reviewer": { model: "claude-bridge/claude-sonnet-5:high" },
  "perf-auditor": { model: "claude-bridge/claude-sonnet-5:high" },
  "pr-reviewer-claude": { model: "claude-bridge/claude-opus-5:high" },
  "pr-reviewer-gpt": { model: "openai-codex/gpt-5.6-sol:high" },
  "security-auditor": { model: "claude-bridge/claude-opus-5:high" },
  designer: {
    model: "fireworks/accounts/fireworks/models/kimi-k3",
    fallbackModels: ["claude-bridge/claude-opus-5"],
  },
};

async function agentSource(name: string) {
  return readFile(`agents/${name}.md`, "utf8");
}

function frontmatter(source: string) {
  const matched = source.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(matched, "agent source must start with YAML frontmatter");
  return matched[1];
}

const roster = [
  "writer",
  "researcher",
  "issue-reviewer",
  "pr-reviewer-claude",
  "pr-reviewer-gpt",
  "security-auditor",
  "perf-auditor",
  "designer",
].sort();

test("exposes exactly the SDLC roster to pi-subagents", async () => {
  const [manifest, agentEntries] = await Promise.all([
    readFile("package.json", "utf8").then((contents) => JSON.parse(contents) as PackageManifest),
    readdir("agents"),
  ]);

  assert.deepEqual(manifest["pi-subagents"]?.agents, ["./agents"]);
  assert.deepEqual(
    agentEntries.filter((entry) => entry.endsWith(".md")).map((entry) => entry.slice(0, -3)).sort(),
    roster,
  );
});

test("keeps model routing in the subagents settings mapping", async () => {
  const [settings, sources] = await Promise.all([
    readFile(".pi/settings.json", "utf8").then((contents) => JSON.parse(contents) as SubagentSettings),
    Promise.all(roster.map(agentSource)),
  ]);

  assert.equal(settings.subagents?.defaultModel, "claude-bridge/claude-sonnet-5");
  assert.deepEqual(settings.subagents?.agentOverrides, expectedModels);
  for (const source of sources) {
    assert.doesNotMatch(frontmatter(source), /^model:/m);
  }
});

test("gives the researcher its specified tools and reviewers the shared findings contract", async () => {
  const [researcher, ...reviewers] = await Promise.all([
    agentSource("researcher"),
    ...findingAgents.map(agentSource),
  ]);

  assert.match(
    frontmatter(researcher),
    /^tools: read, bash, web_search, fetch_content, get_search_content, source_check, resolve-library-id, query-docs$/m,
  );
  const settings = JSON.parse(await readFile(".pi/settings.json", "utf8")) as SubagentSettings;
  assert.ok(settings.packages?.some((entry) => (
    typeof entry === "object"
    && entry !== null
    && "source" in entry
    && entry.source === "npm:@upstash/context7-pi@0.1.2"
  )));
  for (const reviewer of reviewers) {
    assert.match(reviewer, /<Critical\|Major\|Minor\|Observation>/);
    assert.match(reviewer, /<file>:<line>/);
  }
});
