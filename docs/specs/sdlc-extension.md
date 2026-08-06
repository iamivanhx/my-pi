# SDLC extension spec

Terminal artifact of [Wayfinder map: my-pi extension suite](https://github.com/iamivanhx/my-pi/issues/1), consolidated in [Consolidate the SDLC extension spec](https://github.com/iamivanhx/my-pi/issues/15). Sources: the [workflow rethink](https://github.com/iamivanhx/my-pi/issues/7), the [agent roster & role→model mapping](https://github.com/iamivanhx/my-pi/issues/8), the [Blacksmith posture](https://github.com/iamivanhx/my-pi/issues/14), and the research tickets [#2](https://github.com/iamivanhx/my-pi/issues/2), [#16](https://github.com/iamivanhx/my-pi/issues/16), [#19](https://github.com/iamivanhx/my-pi/issues/19).

The architecture and its doctrine-to-runtime contract are governed by
[ADR-0001](../adr/0001-three-layer-sdlc-architecture.md).

## Posture

- **Lean-interactive / HITL.** No unattended-orchestration machinery. Anything Engine-shaped is out of scope (Blacksmith is shelved).
- **Pi-native rethink, not a port.** The Claude Code `sdlc` plugin at `~/Projects/my-workflows` and `~/Projects/agentic-skills` are prior art and quality bars, not templates.
- **Three product layers.** `extensions/` is the runtime, `skills/` is the SDLC doctrine, and `agents/` is the specialist roster. The seam rule is: extensions never interpret model output; skills never perform irreversible actions without a human gate. ADR-0001 defines what that means and the typed interface between the layers.
- **Skills are injected deterministically.** Model self-invocation remains best-effort in Pi, so a stage command loads and injects its package-owned doctrine at the point of use. Injection is runtime plumbing; the injected skill owns progression, judgment, conditional routing, and human interaction.
- **Structured control, not prose inference.** Stage reports, findings, dispositions, retries, and action requests cross the versioned control interface from ADR-0001. Status and guardrails project accepted events. Runtime never regex-parses reviewer prose or bash commands to infer state.
- **Runtime owns effects, not decisions.** Extensions register commands, assemble context, dispatch/correlate agents with schemas, persist structured events, render UI/status, cancel work, and execute typed git/GitHub/process/file actions after exact human authorization. They do not decide which gate should run next or what a finding means.
- **Bootstrap.** `/define` and `/build` are commands of this package and do not exist until it is built. Plain sessions build the package from this spec and the refactor Issues using ambient implementation skills. The pipeline applies to target projects only after installation and `/setup`.

## Reliability and control contract

Every long-running stage command provides status and cancellation. Required
missing/malformed evidence blocks and is surfaced for bounded, human-selected
retry; runtime messages report only accepted events and observed results.
Irreversible effects use exact, one-shot human authorization. ADR-0001 is the
single source of truth for event projections, finding dispositions, action
schemas, persistence, cancellation, and reconciliation semantics.

## Command surface

Six commands are registered by package extensions. The five stage commands each
pair a thin runtime with an authored doctrine skill; `/learning` is the
feedback-loop command and follows the same split.

### /setup

Project onboarding. `skills/setup/SKILL.md` owns the interview and ordering:
tracker / canonical triage labels / domain docs, followed by a slim
`shipping.md` containing deploy command per environment, health-check/verify
command, rollback move, CI check name, and optional monitoring URL. Flag-system,
external-PR-bot, and rollout-mode interviews stay dropped.

`extensions/setup.ts` owns `/setup` registration, package-resource verification,
deterministic injection of bundled setup resources, target-project inspection,
proposed diff display, path-safe file writes, and validation. It never relies on
a similarly named host skill. Re-runs are idempotent: an existing file is not
replaced unless the exact proposed diff is shown and explicitly authorized.

- **Runtime:** command registration; package-resource diagnostics; skill/context injection; structured control/status; safe target-file adapters.
- **Doctrine:** `skills/setup/SKILL.md`, composing the bundled `setup-matt-pocock-skills` content and the shipping interview.
- **Agents:** none — inline.

### /define

Wayfinder-first with collapse. The doctrine routes the interview through
wayfinder's charting move; if charting surfaces no fog, it collapses to
`grilling` + `domain-modeling` (`grill-with-docs` remains dropped). Greenfield
always routes through wayfinder: Brief → map Destination + Notes; foundational
choices (stack, architecture, domain model, deployment) become decision tickets;
the first slice is a walking skeleton. `/prototype` is offered when the key
unknown is look/behavior. `threat-model` and `observability` are conditional
lenses whose output lands as Issue acceptance criteria, never separate
documents.

Spec drafting dispatches **writer**; research tickets dispatch **researcher**;
the cross-family spec check dispatches **both PR reviewer lanes** with the
canonical findings schema. PR↔Issue grouping is fixed at to-tickets time. The
one-window rule belongs to doctrine and is enforced as a single active runtime
run.

`extensions/define.ts` owns `/define` registration, stage-skill/context injection,
writer/researcher/reviewer dispatch and correlation, structured result handling,
plain `gh` ticket/dependency actions after authorization, and cancel/status. It
contains no interview state machine and parses no agent prose.

- **Runtime:** command registration; injection; structured event/status/cancel surface; subagent dispatch; authorized tracker actions.
- **Doctrine:** `skills/define/SKILL.md`, composing `wayfinder`, `grilling`, `domain-modeling`, `prototype`, `threat-model`, `observability`, `to-spec`, and `to-tickets`.
- **Agents:** writer, researcher, pr-reviewer-claude + pr-reviewer-gpt.

### /build

Execute exactly one Issue in one fresh window through nine doctrine gates
(defect hunt remains folded into code review):

1. Open Issue
2. Clarify requirements — close with a proportional program-design note naming interfaces, types, module boundaries, and file layout
3. Red test
4. Green implementation
5. Code review and defect hunt — dispatch **issue-reviewer** in fresh context
6. Final full suite
7. Commit and push
8. PR action
9. Close Issue

`skills/build/SKILL.md` owns the gate order, TDD/review composition, findings
disposition, bounded retry choices, and the human interactions. Critical/Major
findings are resolved through focused red/green work or explicitly dispositioned
by the human. A required malformed reviewer result blocks and offers at most the
defined retry; it never becomes a clean result or an automatic loop.

`extensions/build.ts` owns `/build <issue>` registration, Issue/context fetch,
branch setup, doctrine injection, issue-reviewer dispatch with the canonical
`outputSchema`, control-event persistence, default-branch protection, status and
cancellation, and typed git/GitHub/tracker adapters. It does not contain a gate
state machine driven by `tool_call`/`agent_end`, parse findings, or classify bash
commands as proof of a gate.

- **Runtime:** command registration; branch and Issue plumbing; injection; structured reviewer dispatch; control/status/cancel; guarded git/GitHub actions.
- **Doctrine:** `skills/build/SKILL.md`, composing `tdd` and `code-review` at the appropriate gates.
- **Agents:** issue-reviewer.

### /preflight

Keyed to the **PR**, proportional:

- **Single-Issue PR → slim gate:** CI, definition of done, description, and a cross-family look if none ran.
- **Multi-Issue PR → full fan-out:** **pr-reviewer-claude + pr-reviewer-gpt** always run in parallel; **security-auditor** is conditional on auth/payments/user data/external input/LLM I/O; **perf-auditor** is conditional on user-facing surface; **writer** drafts the PR description.

`skills/preflight/SKILL.md` owns proportionality, lane selection, findings merge
and disposition, and the reading gate. The merge gate remains the human reading
the diff against the design artifact: lane findings are evidence, not the
verdict. A slim gate reads the diff against the Issue acceptance criteria; a
full gate reads it against the spec and Issues' program-design notes.

Every review lane receives the canonical versioned findings schema through
`outputSchema`. The runtime correlates structured lane results; doctrine merges
and dispositions them in conversation. Required missing/malformed evidence
blocks and is surfaced with its raw artifact. No lane is silently retried or
substituted.

Follow-ups are ordinary tracker Issues outside the current PR group, born
agent-ready with finding, triage label, and provenance, and named in the GO
verdict. GO/NO-GO posting, follow-up filing, description update, and
ready/return-to-draft actions are authorized plain `gh` adapters.

- **Runtime:** command registration; PR/diff/artifact context; parallel dispatch/correlation; schema validation; control/status/cancel; authorized `gh` actions.
- **Doctrine:** `skills/preflight/SKILL.md`, owning proportionality, merge/disposition, and reading-gate judgment.
- **Agents:** writer, pr-reviewer-claude, pr-reviewer-gpt, security-auditor (conditional), perf-auditor (conditional).

### Findings contract

All review lanes, including `/build`'s issue-reviewer, receive ADR-0001's
canonical versioned findings schema through `outputSchema`; an empty findings
array is the only clean result. Disposition uses the matching structured
contract. Critical/Major remain blocking until terminally dispositioned, and
runtime never interprets reviewer sentences.

### /ship

`skills/ship/SKILL.md` owns environment selection, pre-deploy checks, the human
gate before deploy, verification, monitoring/error glance, and rollback
decision. It consumes the full `shipping.md` contract: deploy/verify per
environment, rollback, named CI check, and optional monitoring URL.

`extensions/ship.ts` and `extensions/shipping/document.ts` own `/ship`
registration, reading and validating the product-owned JSON-frontmatter file,
control/status/cancel, bounded process execution, known-secret redaction, and
verbatim result reporting. The model selects only a named environment; runtime
resolves the exact deploy or rollback command from the fingerprinted document,
shows it to the human, and executes it only after exact authorization. A failed
deploy or verify stops for the human; no automatic retry or rollback occurs.

- **Runtime:** command registration; structured document parser; control/status/cancel; authorized deploy/rollback adapters; redacted output handling.
- **Doctrine:** `skills/ship/SKILL.md`.
- **Agents:** none — inline.

### /learning

Every learning gets exactly one home: glossary/ADR through `domain-modeling`, a
product Issue, or a my-pi Issue for workflow defects. `skills/learning/SKILL.md`
owns that taxonomy and the glossary-vs-ADR judgment. `extensions/learning.ts`
owns command/UI plumbing, explicit domain-modeling injection, and authorized
tracker creation. It does not hard-code the routing doctrine.

- **Runtime:** command registration; selection UI; skill injection; authorized tracker action.
- **Doctrine:** `skills/learning/SKILL.md`, composing `domain-modeling` where selected.
- **Agents:** none — inline.

## Ambient skills

Invoked directly, outside the stage pipeline: `triage`, `diagnosing-bugs`,
`improve-codebase-architecture`. A triage agent is deliberately not built
(volume is low; one-file addition later if that changes).

## Agent roster

Eight custom agents ship from my-pi's `agents/` directory, exposed through
`{"pi-subagents": {"agents": ["./agents"]}}`. **Churn guard:** stage doctrine
dispatches only these roles; pi-subagents built-ins remain available as general
tools but no product stage depends on them. Agent `.md` files omit model
frontmatter. Routing-default delivery remains an open design until Issue #49
selects and tests an installing-user override mechanism.

| Agent | Role | Notes |
|---|---|---|
| writer | Spec drafting, PR descriptions | Structured artifact result where the caller machine-consumes it |
| researcher | Research tickets | Tools per #16: `read, bash, web_search, fetch_content, get_search_content, source_check` + `resolve-library-id, query-docs` from `@upstash/context7-pi` |
| issue-reviewer | /build code-review gate | Fresh context; canonical findings output schema |
| pr-reviewer-claude | Preflight lane, always paired | Canonical findings output schema |
| pr-reviewer-gpt | Preflight lane, always paired | Canonical findings output schema |
| security-auditor | Conditional preflight lane | Canonical findings output schema; pure model review until codex-security is adopted |
| perf-auditor | Conditional preflight lane | Canonical findings output schema |
| designer | UI/UX specialist | Fresh-context only; three pinned design skills; screenshots through packaged browser tooling |

### Recommended role→model mapping

The package documents these product recommendations. **Routing-default delivery
is an open design until Issue #49 selects and tests the supported mechanism.**
Package-owned agent frontmatter is not the defaulting mechanism.

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

Luna/Sol picks were validated against Cerebras' "Getting the most out of
GPT-5.6" guidance (Luna: routine high-volume; Terra: mid implementation driver;
Sol: complex long-running work). The open-model seam remains: an installed and
validated provider/model can replace a recommendation through user settings.

## Pinned skills

**Installed-and-pinned, fork-as-exception.** Track `mattpocock/skills` at a
pinned commit; upgrades are deliberate pin-bumps. Needed beyond the ten
installed: `to-spec`, `to-tickets`, `triage`, `wayfinder`,
`setup-matt-pocock-skills`, `improve-codebase-architecture`. Dropped:
`grill-with-docs`, `implement`, `handoff`, `rollout`, `operate`. The designer's
`web-design-guidelines` remains the one vendored exception.

Stage skills (`setup`, `define`, `build`, `preflight`, `ship`) and supporting
`learning` are authored for my-pi rather than copied from either reference. Each
keeps the every-run process in `SKILL.md`; optional protocols may use small
relative companions.

## Deferred

- **[openai/codex-security](https://github.com/openai/codex-security) as security-auditor scan engine** — deferred to a follow-up Issue. The canonical findings schema makes its `findings.json` compatible when adopted; the Docker/SDK dependency needs its own validation effort first.
- **Footer pipeline-position display** — structured status makes this possible, but it remains a build-time nice-to-have rather than a product requirement.
