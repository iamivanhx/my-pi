import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

type PackageSettings = {
  packages?: Array<string | { source?: string; skills?: string[] }>;
};

const kimiModel = "fireworks/accounts/fireworks/models/kimi-k3";
const fallbackModel = "claude-bridge/claude-opus-5";
const anthropicSkillsPin = "b29e7cf65e5cb78a5ac33d582270551bc74a14eb";
const webGuidelinesPin = "4e799d45c17aec1498c269287a83b9dba22b966b";

async function read(path: string) {
  return readFile(path, "utf8");
}

function frontmatter(source: string) {
  const matched = source.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(matched, "source must start with YAML frontmatter");
  return matched[1];
}

test("scopes the designer to its three design skills and screenshot tools", async () => {
  const designer = frontmatter(await read("agents/designer.md"));

  assert.match(designer, /^defaultContext: fresh$/m);
  assert.match(designer, /^inheritSkills: false$/m);
  assert.match(designer, /^skills: frontend-design, web-design-guidelines, design-system$/m);
  assert.match(designer, /^skillPath: \.\.\/\.pi\/skills, \.\.\/\.pi\/git\/github\.com\/anthropics\/skills\/skills$/m);
  assert.match(designer, /^tools: .*\bbrowser-navigate\b.*\bbrowser-snapshot\b/m);
  assert.match(designer, /^tools: .*\bbrowser-click\b.*\bbrowser-type\b/m);
});

test("pins the frontend skill and browser package sources", async () => {
  const settings = JSON.parse(await read(".pi/settings.json")) as PackageSettings;
  const packages = settings.packages ?? [];

  assert.ok(packages.some((entry) => (
    typeof entry === "object"
    && entry.source === `git:github.com/anthropics/skills@${anthropicSkillsPin}`
    && entry.skills?.includes("+skills/frontend-design/SKILL.md")
  )));
  assert.ok(packages.includes("npm:pi-lean-portal@0.4.0"));
});

test("vendors a pinned, offline web-design-guidelines skill", async () => {
  const [skill, guidelines, source] = await Promise.all([
    read(".pi/skills/web-design-guidelines/SKILL.md"),
    read(".pi/skills/web-design-guidelines/guidelines.md"),
    read(".pi/skills/web-design-guidelines/SOURCE.md"),
  ]);

  assert.match(skill, /^name: web-design-guidelines$/m);
  assert.match(skill, /guidelines\.md/);
  assert.doesNotMatch(skill, /githubusercontent\.com\/.*\/main/);
  assert.match(guidelines, /Web Interface Guidelines/);
  assert.match(source, new RegExp(webGuidelinesPin));
});

test("grounds design work in the portable Stitch DESIGN.md schema", async () => {
  const skill = await read(".pi/skills/design-system/SKILL.md");

  assert.match(skill, /^name: design-system$/m);
  assert.match(skill, /DESIGN\.md/);
  for (const section of [
    "Color",
    "Typography",
    "Spacing",
    "Layout",
    "Components",
    "Motion",
    "Voice",
    "Brand",
    "Anti-patterns",
  ]) {
    assert.match(skill, new RegExp(`^## ${section}$`, "m"));
  }
});

test("registers Kimi's Fireworks OpenAI compatibility contract", async () => {
  const source = await read("extensions/designer-model.ts");

  assert.match(source, /registerProvider\("fireworks"/);
  assert.match(source, /api: "openai-completions"/);
  assert.match(source, /deferredToolsMode: "kimi"/);
  assert.match(source, /requiresReasoningContentOnAssistantMessages: true/);
  assert.match(source, /supportsStrictMode: true/);
  assert.match(source, /off: null/);
});

test("keeps Kimi K3 and its Opus fallback in the central routing mapping", async () => {
  const settings = JSON.parse(await read(".pi/settings.json")) as {
    subagents?: { agentOverrides?: Record<string, { model?: string; fallbackModels?: string[] }> };
  };
  const designer = settings.subagents?.agentOverrides?.designer;

  assert.equal(designer?.model, kimiModel);
  assert.deepEqual(designer?.fallbackModels, [fallbackModel]);
});
