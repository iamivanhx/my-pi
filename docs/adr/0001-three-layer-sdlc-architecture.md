# ADR-0001: Three-layer SDLC architecture and typed control interface

- **Status:** Accepted
- **Date:** 2026-08-06
- **Issue:** [#48 — Refactor 1: reference audit and architecture ADR](https://github.com/iamivanhx/my-pi/issues/48)

## Context

my-pi is becoming an installable Pi package that supplies an SDLC product, not
only a set of project-local extensions. The first implementation put workflow
judgment in TypeScript state machines. In particular, `extensions/build.ts`
classified shell command strings to infer gate progression and parsed reviewer
prose with regular expressions to recover severities and findings.

The 2026-08-05/06 build sessions exposed the failure mode:

- [Issue #31](https://github.com/iamivanhx/my-pi/issues/31) and
  [Issue #32](https://github.com/iamivanhx/my-pi/issues/32) were reopened after
  `/build` advanced through commit, PR action, and Issue closure despite
  unresolved Critical/Major findings. The defect and intended remediation were
  captured in [Issue #45](https://github.com/iamivanhx/my-pi/issues/45).
- The [Issue #33](https://github.com/iamivanhx/my-pi/issues/33) session reached
  the opposite failure: malformed or absent prose findings repeatedly re-entered
  the review gate with no bounded stop or cancellation path.
- The consolidated evidence and target direction are recorded in the
  [package refactor plan](../specs/package-refactor-plan.md). Every audited
  failure occurred where deterministic extension code tried to infer workflow
  state or judgment from model-authored text.

A later plan review identified the missing bridge in the proposed architecture:
`/build status` and irreversible-action guards still need machine-readable
stage, finding, disposition, and authorization state. This ADR defines that
bridge without returning judgment to the extension.

## Decision

my-pi has three product layers:

| Layer | Owns | Does not own |
| --- | --- | --- |
| `extensions/` — runtime | Slash-command registration; deterministic skill and context injection; subagent dispatch/correlation; structured state persistence and status projection; git/GitHub/process/file adapters; cancellation; hard safety preconditions and human-authorization UI | Workflow judgment, next-step selection, findings interpretation, retry decisions, or prose-derived state |
| `skills/` — doctrine | The SDLC process in prose: stage order, conditional routes, findings disposition, bounded retry policy, escalation, and when to ask the human | Direct execution of commits, pushes, tracker/PR mutations, deploys, rollbacks, or destructive file replacements |
| `agents/` — roster | Fresh-context specialist roles with canonical structured output contracts | Orchestration, runtime state, or irreversible product actions |

The seam rule is:

> **Extensions never interpret model output; skills never perform irreversible actions without a human gate.**

Here, *interpret* means deriving state or decisions from free-form language,
formatting conventions, shell-command strings, or heuristics. A runtime may
validate and act on a declared schema field such as
`severity: "Critical"`; it may not recover that field by regexing reviewer
prose, classify the meaning of a finding, or infer a stage from a bash command.
Structured fields are the control protocol, not natural language disguised as
one.

The extension runtime may keep a reducer and hard-precondition table over
accepted control events. That is not an orchestration state machine: it does
not choose the next stage or decide what a finding means. It records what the
doctrine explicitly declared and refuses unsafe actions whose objective
preconditions are absent.

## Comparative audit

### Sources and audit point

The audit read primary source at these revisions:

- `~/Projects/my-workflows/plugins/sdlc` at
  `218723696ff431dc3fce4c032d952dc537cf7f50`
- `~/Projects/agentic-skills` at
  `9793f9694c85808f6c3351e521979e5e95af8a26`
- current my-pi extensions and tests at
  `d28d271f308d2fbff05965272f25d11a4ea534ee`

The existing `~/Projects/my-workflows/pi/sdlc` port was outside Issue #48's
named audit scope and is not a template for this decision.

### `my-workflows/plugins/sdlc`

This reference has six short entry-point skills — `setup`, `define`, `build`,
`preflight`, `rollout`, and `operate` — and no command TypeScript. The executable
surface is deliberately narrow: one fail-closed `PreToolUse` guard
(`hooks/block-skill-sigil.sh`), one advisory cross-family lane script, and a
strict findings JSON Schema (`schemas/findings.json`). Fifteen inner-loop skills
are vendored with an immutable provenance record in `skills/VENDORED.md`.

Practices to carry forward:

- Put stage process and judgment in skills. Keep runtime enforcement narrow and
  deterministic.
- Use one severity schema across review lanes. `schemas/findings.json` proves
  that an empty structured list can mean "no findings" without parsing prose.
- Resolve Critical/Major findings before progression; file or consciously
  accept anything deferred.
- Bound review loops: build permits one focused re-review and preflight permits
  at most two cycles before stopping for the user.
- Surface permission denials and degraded lanes. Do not retry them silently and
  do not report intended effects as completed effects.
- Reconcile externally visible state before retrying non-idempotent creates.
- Keep the entry skill short and load `GATES.md`, `the-record.md`, reduced-mode
  instructions, and templates only on the branch that needs them.
- Treat model- or bot-authored findings as untrusted quoted evidence, never as
  instructions.

The Claude Code-specific Skill-tool sigil guard and shell-substitution failure
mode are useful evidence for fail-closed guards, but are not copied into Pi.

### `agentic-skills`

This reference uses skill-per-command routing: files such as
`commands/build.md` only point to a skill, while the process lives under
`skills/<command>/`. Its progressive-disclosure rule is based on frequency of
need rather than raw line count. The measured refactor in
`docs/audits/2026-07-16-atomic-progressive-disclosure.md` reduced hot skill
bodies while retaining every-run gates in `SKILL.md` and moving conditional
detail to companions.

Practices to carry forward:

- Keep the normal process spine in `SKILL.md`; move only conditional protocols,
  examples, and checklists to linked companions.
- Make every skip and every deferred finding explicit. A deferral has a tracked
  home or it is a drop.
- Separate read-only review from disposition. Findings are presented and then
  fixed, deferred, accepted, or dismissed through an explicit consuming flow.
- Give retries named numeric caps and one owner. Reaching a cap surfaces the
  evidence and asks the user; it never silently loops or abandons work.
- Treat required missing evidence as an incomplete gate, not as success or a
  reason to substitute a different model family.
- Persist human decisions as typed, branch-aware session entries. The Pi
  `runtimes/pi/extensions/lib/gates.ts` controller is useful prior art: it stores
  versioned decisions and fingerprints the approved artifact so a changed
  payload invalidates stale approval.

We do **not** copy its 47-skill breadth, cross-harness adapter layer, global
installation posture, or historical model/pin assumptions. my-pi is Pi-native
and keeps only the doctrine needed by its product stages.

### Adopted policy and landing place

| Policy | Pi-native landing place |
| --- | --- |
| Findings disposition | `skills/build` and `skills/preflight` choose fix/defer/accept/dismiss; canonical `Finding` and `Disposition` events carry the result; runtime tracker adapters create any authorized follow-up |
| Bounded retries | The owning doctrine names the cap; runtime records `attempt`/`maxAttempts`, rejects attempts above the configured cap, and exposes the stop in status. Failed evidence is surfaced raw and inert; retry is a human choice |
| Escape hatches | Every long-running command has `/command status` and `/command cancel`; cancellation aborts correlated work and invalidates late replies. Handoff or degraded-mode branches stay doctrine |
| Progressive disclosure | Each stage skill keeps its normal spine in `SKILL.md` and links conditional companions. The runtime injects the active skill and only the context needed for the current command |
| No silent degradation | Required malformed/missing agent output produces a structured failed-delegation event and blocks. Optional degradation is a declared doctrine decision recorded in the event stream |
| Human gates | Disposition and irreversible-action requests cross an explicit extension UI. Approval is one-shot and tied to the exact structured payload fingerprint |

## Carry-over inventory

`runtime`, `doctrine`, and `discard` below are normative dispositions. `split`
means the mechanical half remains runtime while the judgment/policy half moves
to doctrine. Every code or test disposition has an implementation owner.

### `extensions/build.ts`

| Current behavior | Disposition | Owner |
| --- | --- | --- |
| `/build` registration, interactive/idle/single-run checks, Issue argument parsing | runtime | [#50](https://github.com/iamivanhx/my-pi/issues/50) |
| Fresh-window check and Issue metadata fetch/validation through `gh` | runtime | #50 |
| Current/default branch lookup and Issue branch creation/switch | runtime | #50 |
| Nine-gate names and todo-list instructions | doctrine in `skills/build/SKILL.md` | #50 |
| `Gate`, `Transition`, `nextGate`, `run.gate`, and announcement sets | discard; replace with accepted `RunStage` events and their projection | #50 |
| Test/full-suite/Issue-comment/test-path regex classification | discard | #50 |
| Bash/tool-result-driven gate advancement | discard | #50 |
| Write/edit blocking keyed to `run.gate` | discard; doctrine controls its implementation phase, while runtime keeps only objective irreversible-action/file-safety guards | #50 |
| Reviewer-prose `parseFindings` and `declaresNoFindings` | discard; reviewer dispatch uses canonical `outputSchema` | #50 |
| Human-pasted code-review parsing and recursive recollection | discard; structured findings only, with one bounded human-selected retry | #50 |
| Structured finding formatting and severity-enum blocking check | runtime projection/guard over validated fields | #50 |
| Review remediation-vs-deferral choice and blocking policy | doctrine | #50 |
| Human selection/confirmation UI for dispositions | runtime control interface | #50 |
| Follow-up Issue creation after an authorized deferral | runtime tracker adapter | #50 |
| TDD/review instructional prompts and per-gate announcements | doctrine | #50 |
| Skill lookup/read and deterministic Issue/context injection | runtime | #50 |
| `issue-reviewer` dispatch and request/reply correlation | runtime, using schema-validated output and bounded failure events | #50 |
| Default-branch protection | runtime hard precondition inside typed git adapters; retire bash-string regex detection | #50 |
| Draft PR reuse/open/update and closing-reference plumbing | runtime GitHub adapter | #50 |
| Issue closure after successful PR action | runtime tracker adapter, separately human-authorized | #50 |
| `PR group:` convention parsing | runtime parsing of a declared Issue metadata convention; replace if the tracker exposes a native group source | #50 |
| Replayed messages such as "The green test passed" without a corresponding accepted event | discard | #50 |
| Unbounded review retry on missing/unusable output | discard | #50 |
| `tests/build.test.ts` state-machine assertions | rewrite around command, control-event, adapter, cancellation, and guardrail seams | #50 |

### `extensions/define.ts`

| Current behavior | Disposition | Owner |
| --- | --- | --- |
| `/define` registration and interactive/idle checks | runtime | [#51](https://github.com/iamivanhx/my-pi/issues/51) |
| Idea-kind and next-beat interview state machine | doctrine in `skills/define/SKILL.md`; runtime renders requested UI | #51 |
| Wayfinder-first, greenfield, collapse, prototype, threat-model, and observability routing rules | doctrine | #51 |
| Skill discovery/read and exact skill/context injection | runtime | #51 |
| Writer, researcher, and reviewer-lane dispatch/correlation | runtime | #51 |
| Prose-only "use the findings contract" reviewer request | discard; pass the canonical schema through `outputSchema` | #51 |
| Ticket/dependency creation via plain `gh` (specified but absent from the current file) | add runtime tracker adapters after structured authorization | #51 |
| One-window discipline, failed-delegation choice, and retry policy | doctrine, with runtime single-run/cancel/status enforcement | #51 |
| Missing dispatch timeout, status, and cancellation | add runtime behavior | #51 |
| `tests/define.test.ts` | rewrite for the thin runtime/control surface | #51 |

### `extensions/preflight.ts`

| Current behavior | Disposition | Owner |
| --- | --- | --- |
| `/preflight` registration and interactive/idle checks | runtime | [#52](https://github.com/iamivanhx/my-pi/issues/52) |
| PR, linked-Issue, CI, and diff retrieval | runtime | #52 |
| CI conclusion calculation over GitHub's structured fields | runtime | #52 |
| Markdown acceptance-checklist extraction | runtime parsing of a declared tracker artifact contract; doctrine receives the raw body as context | #52 |
| Single-vs-multi Issue proportionality and lane conditions | doctrine in `skills/preflight/SKILL.md` | #52 |
| Regex search of comment prose to infer a prior cross-family lane | discard; use structured lane/delegation events | #52 |
| Writer and review-lane dispatch/request correlation | runtime; expand to all required parallel lanes | #52 |
| Prose findings contract | discard; every lane gets the canonical `outputSchema` | #52 |
| Findings merge, severity judgment, disposition, GO/NO-GO decision | doctrine plus explicit human gate | #52 |
| Reading-gate UI and rendering of diff/artifacts/findings | runtime presentation of doctrine-selected inputs | #52 |
| PR description, verdict comment, follow-up filing, ready/draft actions | runtime GitHub/tracker adapters after structured authorization | #52 |
| Single-Issue-only limitation and missing conditional/full fan-out lanes | discard limitation; implement full doctrine/runtime path | #52 |
| Missing per-lane timeout, status, and cancellation | add runtime behavior | #52 |
| `tests/preflight.test.ts` | rewrite for proportional dispatch, schema results, correlation, actions, status, and cancellation | #52 |

### `extensions/ship.ts` and `extensions/shipping/document.ts`

| Current behavior | Disposition | Owner |
| --- | --- | --- |
| `/ship` registration and interactive/idle checks | runtime | [#53](https://github.com/iamivanhx/my-pi/issues/53) |
| Read `shipping.md`, parse JSON frontmatter, and validate required fields | runtime; structured product-owned input is a legitimate parsing boundary | #53 |
| `ShippingDocument` types, errors, format, and parser in `shipping/document.ts` | runtime shared module; retain rather than fold into prose | #53, with the writer contract consumed by [#54](https://github.com/iamivanhx/my-pi/issues/54) |
| Environment existence lookup | runtime | #53 |
| Environment selection policy and deploy/verify/rollback sequence | doctrine in `skills/ship/SKILL.md`; runtime presents selection UI | #53 |
| Rollback placeholder substitution from the validated document | runtime | #53 |
| Deploy/verify process execution and timeout | runtime adapter after exact-payload authorization | #53 |
| Deploy/verify exit-code capture and bounded output storage | runtime | #53 |
| Regex scan of stdout/stderr for words such as error/fatal/failed | discard; runtime reports bounded/redacted output and doctrine/human judges it | #53 |
| CI-check and monitoring guidance | doctrine decides when to consult/offer; runtime performs configured checks | #53 |
| Immediate deploy without showing the exact environment/command and obtaining approval | discard; typed human authorization is mandatory | #53 |
| Missing rollback execution, status, cancellation, and secret redaction | add runtime behavior | #53 |
| `tests/ship.test.ts` | rewrite for parser, authorization, adapters, output handling, status, and cancellation | #53 |

### `extensions/setup.ts`

| Current behavior | Disposition | Owner |
| --- | --- | --- |
| `/setup` registration and interactive/idle checks | runtime | [#54](https://github.com/iamivanhx/my-pi/issues/54) |
| Loaded-resource verification and actionable missing-resource errors | runtime | #54, after packaging in [#49](https://github.com/iamivanhx/my-pi/issues/49) |
| Read/inject bundled setup skills and target-project context | runtime | #54 |
| Tracker/domain/shipping interview order and field choices | doctrine in `skills/setup/SKILL.md` | #54 |
| Shipping format contract | runtime shared schema plus doctrine explanation | #53/#54 |
| Target file inspection, proposed diff display, path safety, and confirmed write | runtime file adapter | #54 |
| Current unverified "send instructions and trust the model wrote it" path | discard | #54 |
| Current dependence on skills that happen to be installed on the host | discard; use package-bundled resources | #49/#54 |
| `tests/setup.test.ts` | rewrite for resource verification, safe writes, idempotency, and valid output | #54 |

### `extensions/learning.ts`

`/learning` remains a supported, non-stage command because it closes the
feedback loop without inventing another artifact.

| Current behavior | Disposition | Owner |
| --- | --- | --- |
| `/learning` registration, interactive/idle checks, prompt/editor, and selection UI | runtime | [#56](https://github.com/iamivanhx/my-pi/issues/56) |
| Exactly-one-home policy and the three homes | doctrine in `skills/learning/SKILL.md` | #56 |
| Glossary-vs-ADR judgment | doctrine through `domain-modeling` | #56 |
| Loaded `domain-modeling` discovery/read/injection | runtime | #56 |
| Product Issue vs my-pi workflow-defect routing choice | doctrine | #56 |
| Plain `gh issue create` in the selected repository | runtime tracker adapter after structured authorization | #56 |
| Current hard-coded policy strings in TypeScript | discard after the doctrine skill owns them | #56 |

### `extensions/designer-model.ts`

| Current behavior | Disposition | Owner |
| --- | --- | --- |
| Fireworks provider registration | runtime; keep | [#56](https://github.com/iamivanhx/my-pi/issues/56), coordinated with [#49](https://github.com/iamivanhx/my-pi/issues/49) |
| Kimi K3 model metadata, thinking map, and compatibility flags | runtime provider contract; keep and validate against the installed Pi version | #56 |
| Designer role-to-model routing | not owned by this file; move from dev-only settings to the supported package/user mechanism selected in #49 | #49 |

### Cross-cutting tests explicitly called out by Issue #48

| Test | Disposition | Owner |
| --- | --- | --- |
| `tests/learning.test.ts` | Rewrite for thin runtime plus injected `skills/learning` doctrine; preserve tracker-routing and domain-model injection coverage | [#56](https://github.com/iamivanhx/my-pi/issues/56) |
| `tests/agent-roster.test.ts` | Rewrite dev-only model-setting assertions after #49 and prose-contract assertions after #50/#52; retain exact roster/tool coverage | #56 final migration, consuming #49/#50/#52 artifacts |
| `tests/designer-loadout.test.ts` | Rewrite package-path/pin/routing assertions after #49; retain provider compatibility and three-skill loadout coverage | #56 final migration, consuming #49 |

## Typed doctrine-to-runtime control interface

### Purpose and non-goals

The interface is the only machine-readable path by which doctrine declares run
state, dispositions findings, requests retries, and asks runtime to perform an
irreversible action. It exists so status and hard guards can use values rather
than prose.

It does not make semantic decisions, choose the next stage, summarize model
text, or treat a command string as proof that a stage occurred.

### Canonical event envelope

All persisted events use version 1. The runtime, not the model, assigns
`eventId`, `sequence`, and `recordedAt`. Exactly one run is active per command
session; an event for another or cancelled `runId` is rejected normally and is
not persisted.

```ts
type SdlcCommand =
  | "setup"
  | "define"
  | "build"
  | "preflight"
  | "ship"
  | "learning";

type EventActor =
  | { type: "doctrine" }
  | { type: "human" }
  | { type: "runtime" }
  | { type: "agent"; agent: string; delegationId: string };

interface ControlEvent<T> {
  schemaVersion: 1;
  eventId: string;
  runId: string;
  command: SdlcCommand;
  sequence: number;
  recordedAt: string; // runtime-generated ISO timestamp
  actor: EventActor;
  value: T;
}

interface EvidenceRef {
  type: "tool-result" | "delegation" | "control-event" | "artifact" | "external";
  ref: string;
  sha256?: string;
}
```

The runtime validates that every evidence reference exists and, where
applicable, that a tool result succeeded or an artifact fingerprint still
matches. It does not judge the natural-language content behind the reference.

### `RunStage`

```ts
type BuildStage =
  | "initialize" | "open-issue" | "clarify" | "red" | "green" | "review"
  | "final-suite" | "commit" | "push" | "pr-action" | "close" | "complete";

type DefineStage =
  | "initialize" | "chart" | "interview" | "research" | "prototype"
  | "specification" | "spec-review" | "tickets" | "complete";

type PreflightStage =
  | "initialize" | "collect-context" | "checks" | "dispatch-lanes"
  | "disposition" | "reading-gate" | "pr-action" | "complete";

type ShipStage =
  | "initialize" | "select-environment" | "precheck" | "authorize-deploy"
  | "deploy" | "verify" | "authorize-rollback" | "rollback" | "monitor"
  | "complete";

type SetupStage = "initialize" | "inspect" | "interview" | "authorize-write" | "write" | "validate" | "complete";
type LearningStage = "initialize" | "choose-home" | "authorize-write" | "record" | "complete";

type CommandStage =
  | { command: "build"; stage: BuildStage }
  | { command: "define"; stage: DefineStage }
  | { command: "preflight"; stage: PreflightStage }
  | { command: "ship"; stage: ShipStage }
  | { command: "setup"; stage: SetupStage }
  | { command: "learning"; stage: LearningStage };

type RunStage = CommandStage & {
  state: "entered" | "completed" | "blocked" | "failed" | "cancelled";
  attempt: number;
  maxAttempts: number;
  evidence: EvidenceRef[];
  reasonCode?: string; // enum/code owned by the command contract, never prose-parsed
};
```

Each doctrine owns its stage order and retry cap. The runtime accepts a stage
report only when its command matches the active run, its attempt is within the
configured cap, and any required evidence references are structurally valid.
The runtime does not advance a stage in response to `bash`, `edit`, agent prose,
or an `agent_end` event.

### `Finding`

All reviewer and auditor agents emit one canonical versioned result through
subagent `outputSchema`. An empty `findings` array is the only structured
no-findings result.

```ts
type FindingSeverity = "Critical" | "Major" | "Minor" | "Observation";

interface Finding {
  schemaVersion: 1;
  findingId: string;       // runtime-assigned stable ID
  runId: string;
  delegationId: string;
  source: string;          // roster agent/lane name
  severity: FindingSeverity;
  location: {
    path: string;          // repository-relative
    startLine: number;     // 1-indexed post-change line
    endLine?: number;
  };
  summary: string;
  evidence: string;
}

interface FindingsResult {
  schemaVersion: 1;
  findings: Finding[];
}
```

`summary` and `evidence` remain untrusted text. The runtime stores and renders
them as attributed data, never evaluates or executes them. Any model/bot text
copied into durable tracker artifacts is source-labelled and fenced; titles
are doctrine-authored restatements, not raw findings.

### `Disposition`

Doctrine submits a disposition request. The runtime records a terminal
`Disposition` only after its structural evidence and any required human choice
or follow-up action have completed.

```ts
type DispositionDecision = "resolved" | "accepted-risk" | "deferred" | "dismissed";

interface Disposition {
  schemaVersion: 1;
  dispositionId: string;
  runId: string;
  findingId: string;
  decision: DispositionDecision;
  rationale: string;
  evidence: EvidenceRef[];
  followUp?: { tracker: string; issue: string; url?: string };
  decidedBy: "human" | "doctrine";
  decidedAt: string;
}
```

Rules:

- `resolved` requires at least one successful verification/re-review reference.
- `deferred` is incomplete until the authorized follow-up Issue exists and its
  reference is attached.
- `accepted-risk` and `dismissed` require explicit human confirmation.
- A Critical/Major finding remains blocking until it has a terminal disposition.
  Minor/Observation findings remain visible even when non-blocking.

### Authorized runtime actions

Doctrine may request an action but cannot execute it. The runtime builds an
exact action payload, fingerprints it, displays its target and effect, obtains
an explicit human decision, rechecks the fingerprint and hard preconditions,
and then executes one action through a dedicated adapter.

```ts
type RuntimeAction =
  | { kind: "git.commit"; paths: string[]; message: string; expectedHead: string; expectedTree: string }
  | { kind: "git.push"; remote: string; branch: string; expectedCommit: string }
  | { kind: "tracker.issue.create"; repository: string; title: string; bodyArtifact: string; labels: string[]; findingIds?: string[] }
  | { kind: "tracker.issue.close"; repository: string; issue: number; commentArtifact?: string }
  | { kind: "tracker.issue.add-dependency"; repository: string; issue: number; blockedBy: number }
  | { kind: "github.pr.open"; repository: string; base: string; head: string; title: string; bodyArtifact: string; draft: true }
  | { kind: "github.pr.update"; repository: string; pr: number; title?: string; bodyArtifact?: string }
  | { kind: "github.pr.comment"; repository: string; pr: number; bodyArtifact: string }
  | { kind: "github.pr.mark-ready"; repository: string; pr: number }
  | { kind: "github.pr.return-to-draft"; repository: string; pr: number }
  | { kind: "github.pr.close"; repository: string; pr: number }
  | { kind: "deploy.execute"; environment: string; shippingDocumentSha256: string }
  | { kind: "deploy.rollback"; environment: string; shippingDocumentSha256: string }
  | { kind: "project.file.replace"; path: string; expectedSha256: string | null; proposedArtifact: string; proposedSha256: string };

interface ActionRequest {
  schemaVersion: 1;
  actionId: string;
  runId: string;
  action: RuntimeAction;
  payloadSha256: string;
  requestedAt: string;
  prerequisiteEvents: string[];
}

interface ActionAuthorization {
  schemaVersion: 1;
  actionId: string;
  payloadSha256: string;
  decision: "approved" | "denied";
  decidedBy: "human";
  decidedAt: string;
  oneShot: true;
}

interface ActionResult {
  schemaVersion: 1;
  actionId: string;
  payloadSha256: string;
  status: "succeeded" | "failed" | "cancelled" | "already-satisfied";
  exitCode?: number;
  outputArtifact?: string;
  externalRef?: string;
  completedAt: string;
}
```

Action-specific requirements:

| Action | Hard runtime checks before execution |
| --- | --- |
| `git.commit` | Current branch is not the default branch; HEAD/tree still match the request; exact paths are staged; final-suite evidence exists; no unresolved Critical/Major finding |
| `git.push` | Branch is not the default branch; the authorized commit exists; remote/ref are exact; no force push |
| Tracker creates | Prepared body is a separate artifact; repository/labels are allowed; retries reconcile by embedded run/action marker or exact stable key before creating |
| Tracker close | Target Issue matches the run; prerequisite PR/action events succeeded; unresolved blockers are absent |
| PR open/update/comment/ready/draft/close | Repository, base/head/PR and payload fingerprints still match; create reconciles by head branch/closing references before retry |
| Deploy/rollback | The model supplies only the named environment and document fingerprint. Runtime resolves the command from the committed, validated `shipping.md`; the model never supplies raw command/argv. The exact environment and resolved command are shown before approval |
| Project file replacement | Resolve under `ctx.cwd`; reject traversal and symlink escape; show the proposed diff; invalidate approval if current/proposed hash changes; execute through Pi's per-file mutation queue |

Approval is one action, one exact payload, one use. A changed payload or stale
artifact requires new approval. A retry reuses the original `actionId` and
fingerprint; it never creates a fresh identity for an ambiguously completed
side effect.

Managed doctrine must not perform the modeled irreversible actions through
generic `bash`. Runtime adapters are the exclusive supported route. The stage
refactors must restrict or replace any generic execution capability that could
bypass those adapters while a managed run is active; parsing shell strings with
regular expressions is not an acceptable guard. Existing default-branch safety
logic is retained inside the typed git adapters, not as prose/command sniffing.

### Emission mechanism

The Pi runtime exposes a small model-callable control-tool family rather than
one loose free-form tool:

- stage report (`RunStage` input)
- disposition request (`findingId` plus the requested terminal decision)
- retry request (failed delegation/stage ID; original attempt identity)
- action request (`RuntimeAction` input)
- status query (read-only compact projection)

Each tool uses strict TypeBox/JSON Schema parameters. Issue #50 must verify the
chosen schema shapes across the package's supported model providers; if a
provider cannot reliably call a discriminated union, the runtime registers
separate action-family tools rather than weakening the schema.

Subagent findings do not pass through parent prose. The runtime supplies
`FindingsResult` as `outputSchema`, validates the result, assigns IDs, and emits
accepted finding events. A malformed or absent result emits a
`DelegationFailed` event with the bounded, redacted raw output artifact; it does
not fabricate an empty list.

All mutating control operations enter one in-process FIFO/mutex keyed by the
active run. Validation, sequence assignment, persistence, and projection happen
inside that critical section so sibling Pi tool calls cannot race or observe a
stale state. Policy rejection is a normal tool result (`accepted: false` with a
reason code); thrown tool errors are reserved for infrastructure faults.

### Persistence, status, cancellation, and retries

- Accepted events are appended as versioned, non-context session entries and
  reconstructed from `ctx.sessionManager.getBranch()` on session start/tree
  navigation. Tool results also return the accepted event ID and compact state.
- Every control-tool result includes the compact projection: command, run ID,
  current declared stage, attempt/cap, in-flight delegation IDs, unresolved
  blocking finding IDs, and pending/last action.
- `/command status` and the read-only status tool render that projection only.
  They never inspect assistant messages or infer from shell history.
- `/command cancel` aborts the active `AbortController`, records cancellation,
  clears pending grants, and invalidates delegation/request IDs. Late replies for
  a cancelled or superseded request are ignored and never persisted.
- Retry limits belong to the command doctrine and are installed as runtime
  configuration at run start. A retry is explicit and human-selected. The
  runtime rejects attempts over the cap and preserves the prior raw evidence.
- A failed/denied action is not reported as succeeded. Before retrying a
  non-idempotent external action, the adapter reconciles actual state and returns
  `already-satisfied` when the intended effect already exists.

### Security and operational properties

- Only schema-validated enums and identifiers influence guards. Model-authored
  summaries/evidence are data, bounded in size, attributed, and inert.
- Known secret values are redacted before output/event artifacts are persisted
  or rendered. Payload artifacts must not contain credentials.
- Run, delegation, event, action, and external references make every failure and
  authorization diagnosable without reading conversation prose.
- Status is truthful by construction: it reports accepted events and observed
  action results, not predictions or replayed gate announcements.
- Event schema version mismatch, sequence gaps, stale payload hashes, unknown
  run IDs, and missing prerequisite evidence fail closed with explicit reason
  codes.

## Consequences

### Positive

- The #31/#32 fail-open path and #33 fail-closed loop lose their shared cause:
  no extension parses reviewer language or guesses progression from a command.
- Doctrine stays editable and inspectable as prose while hard guards use stable,
  testable values.
- Status, cancellation, retries, and irreversible actions share one audit trail.
- Stage refactors #50–#54 can reuse one vocabulary rather than inventing
  command-specific text protocols.

### Costs and constraints

- Issue #50 must implement and prove the control runtime before #51–#53 reuse it.
- Runtime adapters and event migration/version handling become product APIs and
  require focused tests.
- Restricting generic execution during managed runs may require a structured
  reversible-command tool so tests and diagnostics remain available without
  creating an irreversible-action bypass.
- Skills must stay synchronized with the canonical stage/action names without
  duplicating schema definitions; the schema artifacts created in #50 become the
  single source of truth.

## Follow-up implementation map

- [#49](https://github.com/iamivanhx/my-pi/issues/49): installable package,
  bundled skills/dependencies, and supported routing defaults.
- [#50](https://github.com/iamivanhx/my-pi/issues/50): canonical schema artifacts,
  control tools/runtime, and `/build` proving implementation.
- [#51](https://github.com/iamivanhx/my-pi/issues/51): `/define` doctrine/runtime.
- [#52](https://github.com/iamivanhx/my-pi/issues/52): `/preflight`
  doctrine/runtime and all review lanes.
- [#53](https://github.com/iamivanhx/my-pi/issues/53): `/ship`, shipping document,
  and deployment adapters.
- [#54](https://github.com/iamivanhx/my-pi/issues/54): `/setup` onboarding doctrine
  and safe target-project writes.
- [#56](https://github.com/iamivanhx/my-pi/issues/56): `/learning`, designer
  provider carry-over, and the three cross-cutting test migrations.
- [#55](https://github.com/iamivanhx/my-pi/issues/55): end-to-end validation of
  the composed package after every implementation slice above is complete.
