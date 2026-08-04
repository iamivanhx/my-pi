# SDLC extension spec

Terminal artifact of [Wayfinder map: my-pi extension suite](https://github.com/iamivanhx/my-pi/issues/1), consolidated in [Consolidate the SDLC extension spec](https://github.com/iamivanhx/my-pi/issues/15). Sources: the [workflow rethink](https://github.com/iamivanhx/my-pi/issues/7), the [agent roster & role→model mapping](https://github.com/iamivanhx/my-pi/issues/8), the [Blacksmith posture](https://github.com/iamivanhx/my-pi/issues/14), and the research tickets [#2](https://github.com/iamivanhx/my-pi/issues/2), [#16](https://github.com/iamivanhx/my-pi/issues/16), [#19](https://github.com/iamivanhx/my-pi/issues/19).

## Posture

- **Lean-interactive / HITL.** No unattended-orchestration machinery. Anything Engine-shaped is out of scope (Blacksmith is shelved).
- **Pi-native rethink, not a port.** The Claude Code `sdlc` plugin at `~/Projects/my-workflows` is reference material only.
- **Skills are injected, never trusted to self-invoke.** Per the skill-primitives research (#2), model-invocation of skills is best-effort in pi. The extension owns orchestration via extension primitives — registered commands, `sendUserMessage`, lifecycle events — and injects skill content explicitly at the point of use.
- **Bootstrap.** `/define` and `/build` are commands *of this extension* and do not exist until it is built. Plain sessions build the extension from this spec directly, using the ambient skills (`tdd`, `code-review`) by hand. The pipeline below applies to projects only after the extension exists.

## Command surface

Six commands, all registered by the extension. Rollout and operate are dead as stages; routing is the command surface itself.

### /setup

Project onboarding. Part 1 (tracker / triage labels / domain docs) delegates unchanged to the pinned `setup-matt-pocock-skills`. Part 2 writes a slimmed `shipping.md`: deploy command per env, health-check/verify command, rollback move, CI check name (monitoring URL optional). Flag-system, external-PR-bot, and rollout-mode interviews are dropped.

- **Primitives:** command registration; `sendUserMessage` to drive the interview.
- **Skills injected:** `setup-matt-pocock-skills`.
- **Agents:** none — inline.

### /define

Wayfinder-first with collapse. The interview beat routes through wayfinder's charting move; if charting surfaces no fog, it collapses to plain `grilling` + `domain-modeling` (`grill-with-docs` is dropped — that combination *is* it). Greenfield always routes through wayfinder: Brief → map Destination + Notes; foundational choices (stack, architecture, domain model, deployment) become decision tickets; first slice is a walking skeleton. `/prototype` is offered as a detour when the key unknown is look/behavior. `threat-model` and `observability` are conditional lenses whose output lands as acceptance criteria on Issues, never separate documents. Spec drafting (decisions already made) dispatches **writer**; research tickets dispatch **researcher**; the cross-family spec check dispatches **both PR reviewer lanes**. Ticket creation is plain `gh issue create` driven by the extension — no model. PR↔Issue grouping is fixed at to-tickets time: default, all tickets from one spec share one branch/PR. One-window discipline is enforced by the extension.

- **Primitives:** command registration; `sendUserMessage`; explicit injection of skill content per beat.
- **Skills injected:** `wayfinder`, `grilling`, `domain-modeling`, `prototype` (on detour), `threat-model` / `observability` (conditional), `to-spec`, `to-tickets`, `research` (via researcher).
- **Agents:** writer, researcher, pr-reviewer-claude + pr-reviewer-gpt.

### /build

Execute exactly one Issue in one fresh window, through **nine gates** (defect hunt is folded into code review):

1. Open Issue
2. Clarify requirements — closes with the **program-design beat**: before any test, post a short design note (interfaces, types, module boundaries, file layout for this Issue) as a comment on the Issue. Proportional — one paragraph is valid; the evidence is that it exists before the red test.
3. Red test
4. Green implementation
5. Code review (incl. defect hunt) — dispatches **issue-reviewer**, fresh context
6. Final full suite
7. Commit and push
8. PR action — first Issue of a group opens the draft PR with all `Closes #N` lines; `closingIssuesReferences` is the single source of truth thereafter. Plain `gh`, no model.
9. Close Issue

The gate list is injected into `pi-manage-todo-list` at session start; `tdd` and `code-review` content is injected explicitly at their gates. Gate-skipping enforcement is rebuilt on pi extension events (`tool_call`, `agent_end`), replacing the Claude Code hook. Coding is inline (planned drivers: `gpt-5.6-terra`, sometimes sonnet — variant choice validated against Cerebras' GPT-5.6 guidance).

- **Primitives:** command registration; todo-list injection; `tool_call` / `agent_end` event enforcement; `gh` plumbing.
- **Skills injected:** `tdd`, `code-review`.
- **Agents:** issue-reviewer.

### /preflight

Keyed to the **PR**, proportional:

- **Single-Issue PR → slim gate:** CI, definition-of-done, description, cross-family look if none ran.
- **Multi-Issue PR → full fan-out** on the whole diff: **pr-reviewer-claude + pr-reviewer-gpt always both run in parallel** (the directed cross-family-reviewer role is retired); **security-auditor** conditional on auth/payments/user data/external input/LLM I/O; **perf-auditor** conditional on user-facing surface. PR description drafting dispatches **writer**.

**Findings contract (all review lanes, including /build's issue-reviewer):** every finding is anchored to file+line and carries a severity from the four-level taxonomy — **Critical / Major / Minor / Observation**. Critical/Major must be resolved or explicitly human-accepted before merge. The contract lives in the reviewer agents' `.md` files; it is what makes the two parallel lanes mergeable into one disposition list.

**The merge gate is a reading gate.** GO is the human reading the diff against the design artifact — lane findings are aids, not the verdict. Scaled with the gate: slim gate reads the diff against the Issue's acceptance criteria; full gate reads it against the spec and the Issues' program-design notes. The extension presents diff + artifact together at the GO/NO-GO moment; the human dispositions findings inline — no triage agent.

**Follow-ups:** ordinary tracker Issues, never members of the current PR group, born agent-ready (finding as brief + triage label + provenance link), filed by the extension with deterministic labels, each named in the GO verdict. Anything that must block merge is a surviving Critical → NO-GO. GO/NO-GO posting, follow-up filing, and mark-ready are plain `gh` — no model.

- **Primitives:** command registration; parallel dispatch via `pi-subagents`; `gh` plumbing.
- **Skills injected:** none beyond the lane agents' own content.
- **Agents:** writer, pr-reviewer-claude, pr-reviewer-gpt, security-auditor (conditional), perf-auditor (conditional).

### /ship

Small on-demand skill-shaped command: read `shipping.md`, deploy, verify health/smoke, confirm the rollback move, glance at errors on the changed path. Inline, no agents.

### /learning

Every learning gets exactly one home: glossary/ADR via `domain-modeling`, product Issue, or **my-pi Issue for workflow defects** (how this suite improves itself). Inline.

## Ambient skills

Invoked directly, outside the pipeline: `triage`, `diagnosing-bugs`, `improve-codebase-architecture`. A triage agent is deliberately not built (volume is low; one-file addition later if that changes).

## Agent roster

Eight custom agents shipped from my-pi's own `agents/` dir, exposed via `{"pi-subagents": {"agents": ["./agents"]}}`. **Churn guard:** the pipeline dispatches only these; pi-subagents builtins stay enabled as general tools but no pipeline step references them. Agent `.md` files omit `model` frontmatter — models live solely in the mapping below.

| Agent | Role | Notes |
|---|---|---|
| writer | Spec drafting, PR descriptions | |
| researcher | Research tickets | Tools per #16: `read, bash, web_search, fetch_content, get_search_content, source_check` + `resolve-library-id, query-docs` from `@upstash/context7-pi` |
| issue-reviewer | /build code-review gate | Fresh context; issue-scoped diffs |
| pr-reviewer-claude | Preflight lane, always paired | Findings contract |
| pr-reviewer-gpt | Preflight lane, always paired | Findings contract |
| security-auditor | Conditional preflight lane | **Pure model review** — codex-security deferred (see Deferred) |
| perf-auditor | Conditional preflight lane | |
| designer | UI/UX specialist | Per #19: vision + Kimi tool-calling compat flags; thinking can't be disabled → fresh-context dispatch only. Skills: anthropics `frontend-design`, pinned-vendored vercel `web-design-guidelines`, project-local `design-system` (DESIGN.md/Stitch schema); screenshots via pi-lean-portal |

### Role→model mapping

Single edit-to-switch surface — the `subagents` block of `~/.pi/agent/settings.json`:

```json
"subagents": {
  "defaultModel": "claude-bridge/claude-sonnet-5",
  "agentOverrides": {
    "writer":               { "model": "openai-codex/gpt-5.6-luna:low" },
    "researcher":           { "model": "claude-bridge/claude-sonnet-5:medium" },
    "issue-reviewer":       { "model": "claude-bridge/claude-sonnet-5:high" },
    "perf-auditor":         { "model": "claude-bridge/claude-sonnet-5:high" },
    "pr-reviewer-claude":   { "model": "claude-bridge/claude-opus-5:high" },
    "pr-reviewer-gpt":      { "model": "openai-codex/gpt-5.6-sol:high" },
    "security-auditor":     { "model": "claude-bridge/claude-opus-5:high" },
    "designer":             { "model": "fireworks/accounts/fireworks/models/kimi-k3",
                              "fallbackModels": ["claude-bridge/claude-opus-5"] }
  }
}
```

Luna/Sol picks validated against Cerebras' "Getting the most out of GPT-5.6" guidance (Luna: routine high-volume; Terra: mid implementation driver; Sol: complex long-running work). Open-model seam stays open: a future provider in `models.json` is just another prefix.

## Pinned skills

**Installed-and-pinned, fork-as-exception.** Track `mattpocock/skills` at a pinned commit; upgrades are deliberate pin-bumps. Needed beyond the ten installed: `to-spec`, `to-tickets`, `triage`, `wayfinder`, `setup-matt-pocock-skills`, `improve-codebase-architecture`. Dropped: `grill-with-docs`, `implement`, `handoff`, `rollout`, `operate`. The one vendored exception: the designer's `web-design-guidelines` (per #19).

## Deferred

- **[openai/codex-security](https://github.com/openai/codex-security) as security-auditor scan engine** — deferred to a follow-up issue. The severity taxonomy makes its `findings.json` drop-in whenever adopted; the Docker/SDK dependency needs its own validation effort first.
- **Footer pipeline-position display** — pi-footer is installed (#9); showing pipeline position is a nice-to-have for build time, not spec'd.
