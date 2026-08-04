# Designer subagent — UI/UX skill loadout & Kimi K3 via Fireworks

Research for issue #19 (`iamivanhx/my-pi`). Date: 2026-08-04. Intended final location per the issue: `docs/research/designer-model-and-skill-loadout.md` on branch `research/designer-model-and-skill-loadout`.

**Short answer:**

1. **Skills:** install two, build one. Anthropic's official `frontend-design` skill (anthropics/skills) is purpose-built against the "typical AI-generated" look and encodes almost every technique the ticket lists (deliberate aesthetic direction, typography/layout heuristics, anti-cliché calibration, plan-critique-build loop, screenshot self-critique). Pair it with Vercel Labs' `web-design-guidelines` audit skill for the critique half of the loop. The only thing worth *building* is a small project-local design-system-grounding skill, because no registry package can know this repo's tokens/house style. The heavyweight `pi-ui-workflow` package is skippable.
2. **Model:** Kimi K3 via Fireworks is **validated — and easier than expected**. `accounts/fireworks/models/kimi-k3` is already in pi's *built-in* Fireworks provider catalog: no `models.json` needed, just `FIREWORKS_API_KEY` (already held). The catalog entry confirms vision input (`text, image`), 1,048,576-token context, $3/$15/M with $0.30 cache reads, and ships Kimi-specific tool-calling compat flags (`deferredToolsMode: "kimi"`, `requiresReasoningContentOnAssistantMessages: true`, strict tools) — i.e., pi has first-class handling of K3's tool-loop quirks. Recommend K3 as primary with `opus-5` as `fallbackModels`, not as replacement.

---

## Half 1 — UI/UX skill loadout

### How skills reach a pi subagent (wiring facts)

- Pi implements the Agent Skills standard (`SKILL.md` + frontmatter) and loads skills from `~/.pi/agent/skills/`, project `.pi/skills/` / `.agents/skills/`, package `skills/` dirs, a settings `skills` array, or `--skill` (https://pi.dev/docs/latest/skills). Skills written for Claude Code work as-is; the docs explicitly show adding `~/.claude/skills` to the settings `skills` array.
- pi-subagents agent frontmatter supports `skills:` (named allowlist), `skillPath:` (extra skill directories), and `inheritSkills:` — so the designer can carry exactly its design skills without leaking them to other agents (pi-subagents README, https://www.npmjs.com/package/pi-subagents, agent-frontmatter section).
- Progressive disclosure: only name+description sit in the system prompt; the agent `read`s the full SKILL.md on demand, or it can be forced with `/skill:name` (https://pi.dev/docs/latest/skills).

### Survey — what exists

| Skill / package | What it is | Maturity / provenance | Verdict |
| --- | --- | --- | --- |
| `frontend-design` (anthropics/skills) | Anthropic's official anti-generic design skill. Read in full: names the three current AI-default looks (cream+serif+terracotta; near-black+acid accent; broadsheet hairlines) and forbids spending free axes on them; mandates a named aesthetic direction, characterful type pairing (explicitly not Inter/Arial), a 4–6 hex token palette, one "signature" element, a two-pass plan→self-critique→build process, screenshot self-critique ("a picture is worth 1000 tokens"), plus UX-writing and CSS-specificity guidance. (SKILL.md: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | First-party Anthropic, Apache-2.0 repo, also shipped as an official Claude Code plugin (https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/README.md) with an Anthropic blog post on its rationale (https://claude.com/blog/improving-frontend-design-through-skills). | **Install. This is the core of the loadout** — it directly encodes three of the four techniques the ticket names (typography/layout heuristics, reference/direction-driven design, critique loops). |
| `web-design-guidelines` (vercel-labs/agent-skills) | UI *review/audit* skill: interface guidelines covering accessibility, keyboard support, forms, animation, performance, design-system compliance; returns file:line findings (https://github.com/vercel-labs/agent-skills; Vercel changelog https://vercel.com/changelog/web-interface-guidelines-now-available-as-an-agent-command). | First-party Vercel Labs. Known caveat: the skill fetches its guidelines from the repo's `main` at runtime — pinning to a commit is an open issue (https://github.com/vercel-labs/agent-skills/issues/30). | **Install (vendored/pinned).** Covers the quality-floor/critique axis `frontend-design` treats lightly. Vendor a pinned copy into the skill dir rather than letting it fetch `main`. |
| Other anthropics/skills entries: `canvas-design` (+ ~30 bundled OFL display/body fonts), `brand-guidelines`, `algorithmic-art` | Adjacent creative skills; `canvas-design` targets static canvas/poster art, `brand-guidelines` encodes a fixed corporate identity (repo tree, https://github.com/anthropics/skills) | First-party Anthropic. | **Skip as skills**; `canvas-design`'s font library is a useful reference list of characterful OFL typefaces if the designer needs self-hosted fonts. |
| `pi-ui-workflow` (npm) | `/ui-workflow` pipeline: 7 bundled UI sub-agents (research/needs/form/visual/IA/interaction/content), a bundled `design-dna` skill, universal `ui-workflow` skill, curated reference-site list (godly.website, awwwards, mobbin, 60fps.design, …), optional HTML prototypes (https://www.npmjs.com/package/pi-ui-workflow; https://pi.dev/packages/pi-ui-workflow). | v0.2.11; last publish 2026-06-10, dormant since; ~213 downloads/month; single maintainer (npm registry `time` data, https://registry.npmjs.org/pi-ui-workflow; https://api.npmjs.org/downloads/point/last-month/pi-ui-workflow). | **Skip.** Its 7-agent orchestration duplicates what the designer agent *is*; low adoption and 2-months-dormant. Steal two ideas instead: its reference-site list and its external-skill routing map (which itself points at `frontend-design` and `web-design-guidelines`). |
| `@chankov/agent-skills` (npm/pi.dev) | General engineering skill bundle including a `frontend-ui-engineering` skill plus API/testing/review skills (https://pi.dev/packages/%40chankov/agent-skills). | Community bundle, generic scope. | Skip — engineering-flavored, not design-distinctiveness-flavored; overlaps with skills the coder roster already covers. |
| `browser-tools` (badlogic/pi-skills) | CDP screenshot/navigation helper scripts as a skill (https://github.com/badlogic/pi-skills; SKILL.md https://raw.githubusercontent.com/badlogic/pi-skills/main/browser-tools/SKILL.md). | First-party-adjacent (pi author), but the launcher hard-codes macOS Chrome paths and tab targeting is `pages().at(-1)` (source: browser-screenshot.js, browser-start.js in the repo). | Viable on this Mac, but **prefer `pi-lean-portal`** (below) for one consistent browser story across agents. |

### Techniques → coverage map

| Technique from the ticket | Covered by |
| --- | --- |
| Design-system grounding | **Build**: a small project skill (`.pi/skills/design-system/SKILL.md`) holding this project's tokens, type scale, spacing, and "house taste" notes. Registry skills cannot know these. Pi's skill format makes this a ~1-file job (https://pi.dev/docs/latest/skills). |
| Typography/layout heuristics | `frontend-design` (type pairing, scale, structure-as-information, CSS-specificity warnings); `web-design-guidelines` for the enforcement pass. |
| Reference-driven design | `frontend-design` (ground-in-the-subject directive); plus the designer's `web_search`/`fetch_content` tools against pi-ui-workflow's reference-site list (godly.website, mobbin, 60fps.design, awwwards). No install needed — the researcher-loadout tools already cover fetching. |
| Screenshot critique loops | `frontend-design` explicitly instructs screenshot self-critique; the *capability* comes from a browser tool: `pi-lean-portal` (Playwright click/type/screenshot, v0.4.0, actively maintained — already the interactive-browser pick in `docs/research/researcher-tool-loadout.md` §2), with K3's vision input consuming the screenshots. |

### Recommended designer skill loadout

```md
---
name: designer
description: UI/UX specialist producing distinctive, non-generic design output
model: fireworks/accounts/fireworks/models/kimi-k3
fallbackModels: anthropic/claude-opus-5
tools: read, bash, edit, write, web_search, fetch_content, get_search_content, <pi-lean-portal browser tool>
skills: frontend-design, web-design-guidelines, design-system
---
```

- **Install:** `frontend-design` and `web-design-guidelines` — clone/vendor their skill directories into `~/.pi/agent/skills/` (or point pi's settings `skills` array at a checkout); pin `web-design-guidelines` to a commit (its runtime-fetch-from-main behavior is an open issue, vercel-labs/agent-skills#30). Both are plain Agent-Skills-standard directories, which pi consumes natively (https://pi.dev/docs/latest/skills).
- **Build (small):** `design-system` project skill under `.pi/skills/` — tokens, type ramp, references to prior accepted designs. This is the one place install-over-build inverts, by necessity.
- **Reuse:** `pi-lean-portal` for the screenshot half of the critique loop (same package already recommended for the researcher; one browser dependency serves both).
- **Skip:** `pi-ui-workflow`, `@chankov/agent-skills`, `canvas-design`/`brand-guidelines`/`algorithmic-art` as active skills.

---

## Half 2 — Kimi K3 via Fireworks

### The headline: no `models.json` needed

Fireworks is a **built-in pi provider** — auth via `FIREWORKS_API_KEY` env var or the `fireworks` key in `~/.pi/agent/auth.json` (provider table, https://pi.dev/docs/latest/providers). And `accounts/fireworks/models/kimi-k3` is in pi's built-in Fireworks catalog (https://pi.dev/models/fireworks/accounts-fireworks-models-kimi-k3). The catalog entry, verbatim facts:

| Property | Value (pi catalog) |
| --- | --- |
| Model id | `accounts/fireworks/models/kimi-k3` |
| API / base URL | `openai-completions` / `https://api.fireworks.ai/inference/v1` |
| Input | **text, image** (vision confirmed) |
| Reasoning | Yes; `thinkingLevelMap` maps low/medium/high/max and sets `"off": null` — **thinking cannot be disabled** |
| Context / max output | 1,048,576 / 131,072 tokens |
| Cost | $3 in / $15 out / $0.30 cache read / $0 cache write per 1M |
| Compat | `deferredToolsMode: "kimi"`, `requiresReasoningContentOnAssistantMessages: true`, `supportsStrictMode: true`, `supportsDeveloperRole: false`, `thinkingFormat: "openai"`, `sendSessionAffinityHeaders: true` |

So the only "wiring" is: export the existing `FIREWORKS_API_KEY` (or `/login fireworks`), and set the designer's frontmatter `model: fireworks/accounts/fireworks/models/kimi-k3` (per-agent `model`/`fallbackModels` frontmatter and `subagents.agentOverrides` are documented in the pi-subagents README, https://www.npmjs.com/package/pi-subagents). A `models.json` stanza is only needed to *override* catalog values; the catalog page provides a ready-made one for that case.

### Tool-calling reliability

- **Fireworks side:** the Fireworks kimi-k3 model page lists function calling and vision ("text-and-vision", serverless) as supported (https://fireworks.ai/models/fireworks/kimi-k3), and Fireworks' function-calling API is OpenAI-compatible JSON-Schema `tools` with `tool_choice` and streaming tool calls (https://docs.fireworks.ai/guides/function-calling).
- **Moonshot side:** K3 uses OpenAI-style function calling, but always thinks, and multi-turn tool loops must replay the prior assistant message *including* `reasoning_content` and `tool_calls` (MoonshotAI/Kimi-K3 README, https://github.com/MoonshotAI/Kimi-K3/blob/main/README.md; API docs https://platform.kimi.ai/docs/api/chat).
- **pi side (the decisive bit):** pi's built-in catalog entry encodes exactly those quirks as defaults — `requiresReasoningContentOnAssistantMessages: true` handles the reasoning-replay requirement, `deferredToolsMode: "kimi"` selects Kimi's deferred tool serialization for OpenAI-compatible Chat Completions, and `supportsStrictMode: true` enables strict JSON-schema tools (model page above; flag semantics in https://pi.dev/docs/latest/models, OpenAI Compatibility section). First-class, maintained compat flags are as strong a "works in pi subagent sessions" signal as exists short of a live run — which should still be the first smoke test after wiring.

### Vision for screenshot critique

Confirmed on all three layers: pi catalog `input: ["text", "image"]` (model page above); Fireworks describes K3 as having "native visual understanding" and lists it under vision serverless models (https://fireworks.ai/models/fireworks/kimi-k3); Moonshot documents image input via URL or base64, JPEG/PNG/WebP (https://github.com/MoonshotAI/Kimi-K3/blob/main/README.md; https://platform.kimi.ai/docs/guide/use-kimi-vision-model). This is the piece `opus-5` doesn't beat: both are vision-capable, but K3's 1M context leaves more room for multi-screenshot critique loops.

### Cost posture vs the fallback

| | Kimi K3 (Fireworks serverless, standard) | opus-5 (Anthropic) |
| --- | --- | --- |
| Input / output per 1M | $3 / $15 (Fireworks serverless pricing, https://docs.fireworks.ai/serverless/pricing; pi catalog) | $5 / $25 (pi catalog, https://pi.dev/models/anthropic/claude-opus-5) |
| Cache read / write | $0.30 / $0 | $0.50 / $6.25 |
| Context | 1,048,576 | 1,000,000 |

K3 is ~40% cheaper on list rates and has free cache writes. Two cost caveats: (a) thinking cannot be turned off (`"off": null`), so output-token spend runs structurally higher than the sticker rate suggests — keep the designer's `thinking` at `low`/`medium` for iteration loops; (b) Fireworks' Fast (`accounts/fireworks/routers/kimi-k3-fast`, +50%) and Priority (+25%) tiers exist if serverless congestion bites (https://fireworks.ai/models/fireworks/kimi-k3; https://docs.fireworks.ai/serverless/pricing) — the Fast router variant is also in pi's catalog.

### One interaction note

pi-subagents documents that forking context from an Anthropic parent transcript with signed thinking blocks forces a child's thinking off; open-ended design agents "work best with fresh context" (pi-subagents README, model-tiering section). The designer should run fresh-context (the default), not forked — doubly so since K3 cannot run with thinking off.

---

## Recommendation

1. **Skills:** install `frontend-design` (anthropics/skills) + a pinned vendored `web-design-guidelines` (vercel-labs/agent-skills); build one small project `design-system` skill in `.pi/skills/`; reuse `pi-lean-portal` for the screenshot half of the critique loop. Skip `pi-ui-workflow` (dormant, ~213 dl/mo, duplicates the designer's own orchestration) and the rest of the field.
2. **Model:** adopt **Kimi K3 via Fireworks** — `model: fireworks/accounts/fireworks/models/kimi-k3`. It is built into pi's Fireworks provider (no `models.json`), vision-capable for screenshot critique, priced at $3/$15 (cheaper than opus-5's $5/$25), 1M context, and pi ships dedicated Kimi tool-calling compat flags. Keep `opus-5` as `fallbackModels: anthropic/claude-opus-5` rather than as the pick. First action after wiring: a live smoke test of a tool-loop + screenshot turn, since compat flags are documentation-grade, not run-grade, evidence.

## Source index

- pi skills doc: https://pi.dev/docs/latest/skills · custom models doc: https://pi.dev/docs/latest/models · providers doc: https://pi.dev/docs/latest/providers
- pi model catalog — Fireworks Kimi K3: https://pi.dev/models/fireworks/accounts-fireworks-models-kimi-k3 · catalog listing: https://pi.dev/models?provider=fireworks · opus-5: https://pi.dev/models/anthropic/claude-opus-5
- pi-subagents README (frontmatter `model`/`fallbackModels`/`skills`/`skillPath`, agentOverrides, model tiering, fork-context note): https://www.npmjs.com/package/pi-subagents
- anthropics/skills — frontend-design SKILL.md: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md · repo: https://github.com/anthropics/skills · Claude Code plugin: https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/README.md · Anthropic blog: https://claude.com/blog/improving-frontend-design-through-skills
- vercel-labs/agent-skills — web-design-guidelines: https://github.com/vercel-labs/agent-skills · pinning issue: https://github.com/vercel-labs/agent-skills/issues/30 · Vercel changelog: https://vercel.com/changelog/web-interface-guidelines-now-available-as-an-agent-command
- pi-ui-workflow: https://www.npmjs.com/package/pi-ui-workflow · registry: https://registry.npmjs.org/pi-ui-workflow · downloads: https://api.npmjs.org/downloads/point/last-month/pi-ui-workflow
- @chankov/agent-skills: https://pi.dev/packages/%40chankov/agent-skills
- badlogic/pi-skills browser-tools: https://github.com/badlogic/pi-skills
- Fireworks — Kimi K3 model page: https://fireworks.ai/models/fireworks/kimi-k3 · serverless pricing: https://docs.fireworks.ai/serverless/pricing · OpenAI compatibility: https://docs.fireworks.ai/tools-sdks/openai-compatibility · function calling: https://docs.fireworks.ai/guides/function-calling
- Moonshot — Kimi-K3 README: https://github.com/MoonshotAI/Kimi-K3/blob/main/README.md · chat API: https://platform.kimi.ai/docs/api/chat · vision guide: https://platform.kimi.ai/docs/guide/use-kimi-vision-model
- Prior house research: `docs/research/researcher-tool-loadout.md` (pi-lean-portal survey, tool loadout posture)
