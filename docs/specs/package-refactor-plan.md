# my-pi package refactor plan

## Product definition

my-pi is an installable pi package that delivers a state-of-the-art software
development lifecycle — from product idea/features to shipping — into any
project. It is installed directly from the repo (`pi install
git:github.com/iamivanhx/my-pi@<ref>`), self-contained: installing it must pull
every dependency it needs (pi packages, pinned skill packs, agent roster,
model routing). `/setup` onboards each target project. It is not publicly
distributed for now.

## Why this refactor

A session audit (Issues #31, #32, #33 build runs, 2026-08-05/06) exposed a
systemic architecture fault, and an installability review exposed a packaging
fault:

1. **The methodology lives in the wrong layer.** The SDLC doctrine is encoded
   as TypeScript state machines inside `extensions/` (e.g. `build.ts`, 671
   lines). Deterministic code sits on both sides of an LLM-text boundary it
   cannot reliably parse: the review gate regex-scraped free-form reviewer
   prose, failing open in the #31/#32 sessions (Issues auto-closed with
   unaddressed Critical findings) and failing closed in the #33 session (an
   infinite no-usable-findings retry loop with no cancel path). Every audited
   failure occurred at this seam.
2. **The package is not installable.** All runtime dependencies — pi-subagents,
   pinned `mattpocock/skills` and `anthropics/skills` selections, vendored
   `web-design-guidelines`, per-agent model routing — live in the repo's
   project-local `.pi/settings.json`, which configures the my-pi development
   environment only. A fresh `pi install` delivers extensions and agents with
   no skills, no subagent runtime, and no pins.

## Architecture principle

Three layers, all shipped in the package. The seam rule: **extensions never
interpret model output; skills never perform irreversible actions without a
human gate.**

| Layer | Contents | Owns |
| --- | --- | --- |
| `extensions/` — the runtime | command surface (`/setup /define /build /preflight /ship`), deterministic skill+context injection, subagent dispatch, hard guardrails | everything code can verify: git/gh plumbing, branch protection, injection timing |
| `skills/` — the doctrine | one skill per SDLC stage, authored for this product (not copied from references) | judgment: gate progression, findings disposition, human interaction |
| `agents/` — the roster | reviewer/auditor/writer/researcher `.md` definitions with structured output contracts | fresh-context specialist roles |

Non-negotiable design rules distilled from the audit:

- No natural-language parsing in extension code. Structured subagent output
  (schemas) or human disposition — never regex over prose.
- No silent retries. A failed delegation is surfaced with its raw output;
  retry is a human choice, bounded.
- Critical/Major findings are resolved or explicitly human-dispositioned
  (fix inline via red/green, or defer as linked follow-up Issues). Never
  auto-closed past, never a deadlock.
- Every long-running command has an escape hatch (cancel/status).
- Hard enforcement only for irreversible actions: never commit/push to the
  default branch, PR/close plumbing via plain `gh`.
- Messages injected by the runtime must reflect actual state (no replayed
  stale gate announcements).

## Reference posture

`~/Projects/my-workflows` (Claude Code sdlc plugin: six entry-point skills,
zero command code, one enforcement hook, vendored inner loop) and
`~/Projects/agentic-skills` (skill-per-command with progressive disclosure)
are prior art and a quality bar — not templates. The refactor starts with a
fresh comparative audit (Issue: reference audit) whose output is an ADR and a
carry-over inventory, so my-pi lands ahead of both, pi-native.

## Target layout

```
my-pi/
  package.json      # pi manifest: extensions, skills, agents; bundled deps
  extensions/       # thin runtime per command + shared plumbing
  skills/           # SDLC doctrine: define, build, preflight, ship, setup + supporting
  agents/           # roster .md files with structured output contracts
  docs/adr/         # architecture decision records (currently missing)
  docs/specs/       # product spec (sdlc-extension.md, revised)
  tests/            # runtime plumbing + package-loading + install smoke tests
```

## Workstream slices

Created as GitHub issues; implement each in a fresh session using the ambient
Matt Pocock skills (no dogfooding requirement).

1. **Reference audit and architecture ADR** — comparative audit of the two
   reference projects and current my-pi; record the layering decision as
   ADR-0001; revise `docs/specs/sdlc-extension.md`; produce the carry-over /
   discard inventory (including `learning.ts`, `designer-model.ts`).
2. **Installable package scaffolding** — pi manifest with `skills/`; bundle or
   vendor all external dependencies at their pins; ship subagent config and
   model routing as package defaults; prove `pi install` from a clean
   environment.
3. **/build refactor** — doctrine skill + thin runtime; structured reviewer
   output; findings-disposition policy; cancel/status. The proving ground for
   the seam rule.
4. **/define refactor** — same treatment.
5. **/preflight refactor** — same treatment; supersedes Issue #33 and
   dispositions its uncommitted branch work.
6. **/ship refactor** — same treatment, including `shipping/document.ts`.
7. **/setup refactor** — target-project onboarding writing tracker config,
   labels, domain docs, and `shipping.md` into the target repo; verifies
   bundled skill availability post-install.
8. **End-to-end product validation** — install the package into a scratch
   project and run the full lifecycle idea→ship; fix what breaks; the
   product-readiness gate.

Dependency order: 1 → 2 → {3,7} → {4,5,6} → 8, with /build (3) preceding the
other stage refactors so its runtime/doctrine pattern is settled first.
