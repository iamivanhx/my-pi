# Pi extension & skill primitives — can skills be model-invoked?

Resolves issue #2. Researched against primary sources only: pi docs (pi.dev), the pi
source installed globally (`@earendil-works/pi-coding-agent@0.83.0`, referenced below as
`<pkg>` = `$(npm root -g)/@earendil-works/pi-coding-agent`), and package manifests.
Research date: 2026-08-03.

## TL;DR

**Yes, skills are model-invocable in pi — but by a soft mechanism, not a guaranteed one.**
Pi injects each skill's name/description/location into the system prompt as
`<available_skills>` XML and instructs the model to `read` the SKILL.md when a task
matches. There is no dedicated "Skill" tool and no enforcement; pi's own docs caveat:
"models don't always do this; use prompting or `/skill:name` to force it"
(<https://pi.dev/docs/latest/skills>, "How Skills Work"). Autonomous multi-stage chaining
is entirely up to the model. The same failure mode that broke the Claude Code sdlc plugin
exists in pi's skill primitive — **but pi extensions provide a deterministic escape
hatch** (register commands, inject messages, observe agent lifecycle events), so an SDLC
extension should own its workflow orchestration and treat installed skills as content it
injects explicitly, not as steps the model will reliably pick up on its own.

## The three primitives

### Skills (model-facing, on-demand instructions)

Source: <https://pi.dev/docs/latest/skills> (`<pkg>/docs/skills.md`), `<pkg>/dist/core/skills.js`.

- Pi implements the [Agent Skills standard](https://agentskills.io/specification)
  (leniently — e.g. skill name need not match its directory). (`docs/skills.md`)
- A skill is a directory with `SKILL.md` (YAML frontmatter `name` + `description`
  required, plus freeform scripts/references/assets). (`docs/skills.md`)
- Loaded from `~/.pi/agent/skills/`, `~/.agents/skills/`, project `.pi/skills/` and
  `.agents/skills/` (after trust), packages, settings `skills` array, and `--skill`.
  Notably, Claude Code / Codex skill dirs can be consumed directly:
  `{"skills": ["~/.claude/skills", "~/.codex/skills"]}`. (`docs/skills.md`, "Locations")
- **How model invocation works** (`docs/skills.md` "How Skills Work";
  `<pkg>/dist/core/skills.js:257-278` `formatSkillsForPrompt`;
  `<pkg>/dist/core/system-prompt.js:27-30,103-105`):
  1. At startup pi scans skill locations and extracts names + descriptions.
  2. The system prompt appends: *"The following skills provide specialized instructions
     for specific tasks. Use the read tool to load a skill's file when the task matches
     its description."* followed by `<available_skills><skill><name/><description/>
     <location/></skill>…</available_skills>`.
  3. When a task matches, the agent is expected to `read` the SKILL.md. The docs
     explicitly note: *"models don't always do this; use prompting or `/skill:name` to
     force it"*.
  4. Skills are only listed if the `read` tool is active
     (`system-prompt.js`: `if (hasRead && skills.length > 0)`).
- **Explicit invocation**: every skill also registers a `/skill:name` command. Expansion
  is done client-side before the LLM sees it: pi reads the SKILL.md, strips frontmatter,
  and wraps the body in a `<skill name=… location=…>` block appended with any args
  (`<pkg>/dist/core/agent-session.js:946-974` `_expandSkillCommand`). This is
  deterministic — no reliance on the model choosing to read anything.
- **`disable-model-invocation: true`** hides a skill from the system prompt entirely;
  it becomes `/skill:name`-only (`docs/skills.md` frontmatter table;
  `skills.js:258` filters `disableModelInvocation`).
- **`allowed-tools`** is documented as experimental, but in v0.83.0 the parsed `Skill`
  interface only retains `name`, `description`, `disable-model-invocation`
  (`<pkg>/dist/core/skills.d.ts`), and `allowed-tools` appears nowhere in `dist/`
  (verified by grep). Per-skill tool gating is effectively not implemented yet — do not
  rely on it.

### Prompt templates (user-facing slash commands)

Source: <https://pi.dev/docs/latest/prompt-templates> (`<pkg>/docs/prompt-templates.md`).

- Markdown files whose filename becomes a `/name` command; expand into the user prompt
  with positional args (`$1`, `$@`, `${1:-default}`, `${@:N:L}`).
- Loaded from `~/.pi/agent/prompts/`, `.pi/prompts/`, packages, settings, `--prompt-template`.
- **Never model-invoked** — purely user-typed expansion. No description is shown to the
  model; they don't exist in the system prompt at all.

### Extensions (code that runs in-process)

Source: <https://pi.dev/docs/latest/extensions> (`<pkg>/docs/extensions.md`).

- TypeScript modules exporting `(pi: ExtensionAPI) => …`, loaded from
  `~/.pi/agent/extensions/`, `.pi/extensions/`, packages, `-e`. Full system permissions.
- Capabilities relevant here:
  - `pi.registerTool()` — custom tools the **model** calls (schema'd, first-class,
    reliable invocation path). Supports dynamic tool loading via `pi.setActiveTools()`
    with native deferred-loading on Anthropic/OpenAI models (`docs/extensions.md`,
    "Dynamic Tool Loading").
  - `pi.registerCommand()` — `/commands` that run code (checked before skill/template
    expansion in the input pipeline; see lifecycle diagram in `docs/extensions.md`).
  - `pi.on(event)` — ~30 lifecycle events: `input` (intercept/transform user input),
    `before_agent_start` (inject message, modify system prompt), `tool_call` (block),
    `tool_result` (modify), `turn_start`/`turn_end`, `agent_start`/`agent_end`/
    `agent_settled`, `session_*`, `resources_discover` (contribute additional
    skill/prompt/theme paths at runtime), `user_bash`, etc.
  - `pi.sendMessage()` / `pi.sendUserMessage()` — inject messages into the loop with
    delivery modes `steer` / `followUp` / `nextTurn` and `triggerTurn` (can start a turn
    while idle). This is what lets an extension **drive** a multi-stage workflow.
  - `pi.appendEntry()` + renderers — durable state in the session file.

### How they compose

- **Pi packages** bundle all four resource types (extensions, skills, prompts, themes)
  via a `pi` manifest in `package.json` or convention directories (`extensions/`,
  `skills/`, `prompts/`, `themes/`), installable from npm/git/local paths with
  per-resource filtering and enable/disable via `pi config`
  (<https://pi.dev/docs/latest/packages>, `<pkg>/docs/packages.md`).
- Extensions can add skill/prompt paths at runtime (`resources_discover`), read any
  SKILL.md themselves and inject its content via `sendMessage`/`sendUserMessage`, or
  synthesize `/skill:name` invocations — i.e. extensions can *deterministically* compose
  with skills.
- Input pipeline order (lifecycle diagram, `docs/extensions.md`): extension commands →
  `input` event → skill/template expansion → `before_agent_start` → agent loop.

## Key question: can skills be *reliably* model-invoked and chained?

**Model-invoked: yes, by design. Reliably: no guarantee — it is prompt-based, best-effort.**

Evidence:

1. The only model-invocation mechanism is the system-prompt XML listing plus the
   instruction to use `read` (`skills.js:formatSkillsForPrompt`). There is no Skill tool,
   no tool-call-shaped invocation, no runtime check that a matching skill was loaded.
2. Pi's docs state the caveat outright: *"the agent uses `read` to load the full SKILL.md
   (models don't always do this; use prompting or `/skill:name` to force it)"*
   (<https://pi.dev/docs/latest/skills>, "How Skills Work").
3. Nothing in pi tracks skill state, sequencing, or completion. Multi-stage chaining
   (skill A → skill B → skill C) exists only insofar as loaded skill content tells the
   model what to do next and the model complies. This is the same structural weakness
   that broke the Claude Code sdlc plugin.
4. Reliability levers that do exist:
   - Specific, trigger-rich `description` frontmatter (docs' stated best practice).
   - Standing instructions in `AGENTS.md`/`CLAUDE.md` context files
     (<https://pi.dev/docs/latest/usage>, "Context Files").
   - `/skill:name` — deterministic, client-side expansion.
   - Extensions — fully deterministic: commands, message injection, lifecycle events,
     and even system-prompt modification via `before_agent_start`.

## Claude Code plugin concept → pi equivalent

| Claude Code concept | Pi equivalent | Notes / source |
|---|---|---|
| Slash commands (`commands/*.md`) | **Prompt templates** (`/name`, args `$1`/`$@`) for pure prompt expansion; **extension commands** (`pi.registerCommand`) when code must run | <https://pi.dev/docs/latest/prompt-templates>, <https://pi.dev/docs/latest/extensions> |
| Skills (`skills/*/SKILL.md`) | **Skills** — same Agent Skills standard; pi can even load `~/.claude/skills` directly via the `skills` setting | <https://pi.dev/docs/latest/skills> |
| Subagents / agents (Task tool, `agents/*.md`) | **No core equivalent.** Built-in tools are only `bash, edit, find, grep, ls, read, write` (`<pkg>/dist/core/tools/`); no Task/subagent tool exists in `dist/` (verified by grep). Community package `@mariozechner/pi-subagents` provides delegation/chains; the SDK (<https://pi.dev/docs/latest/sdk>) lets an extension spawn its own agents | |
| Hooks (PreToolUse, PostToolUse, shell commands) | **Extension events**: `tool_call` (block/allow), `tool_result` (modify), `input`, `user_bash`, `before_agent_start`, `session_*` — in-process TypeScript rather than shell hooks, strictly more capable | <https://pi.dev/docs/latest/extensions>, "Events" |
| Plugin bundle / marketplace | **Pi package** (npm/git/local; `pi` manifest; `pi install`; gallery at <https://pi.dev/packages>) | <https://pi.dev/docs/latest/packages> |
| `CLAUDE.md` memory | `AGENTS.md` or `CLAUDE.md`, global + directory-walking; `SYSTEM.md`/`APPEND_SYSTEM.md` for system-prompt control | <https://pi.dev/docs/latest/usage> |
| MCP servers | No built-in MCP client; custom tools come from extensions (`pi.registerTool`), which cover the same need in-process | <https://pi.dev/docs/latest/extensions> |

## Decision guidance for the pi SDLC extension (gates #7)

1. **Do not gate the workflow on autonomous skill pickup.** Pi's model-invocation is the
   same prompt-based progressive disclosure that failed for the Claude Code sdlc plugin;
   pi documents the unreliability itself.
2. **The extension should own orchestration.** Concretely: register an entry command
   (`pi.registerCommand`), inject stage instructions deterministically
   (`pi.sendUserMessage` / `pi.sendMessage` with `deliverAs`/`triggerTurn`), and advance
   stages on `agent_end`/`agent_settled` events, persisting stage state with
   `pi.appendEntry`.
3. **Installed skills (e.g. the Matt Pocock set) can still be used — as content, invoked
   explicitly.** The extension can resolve a skill by name and inject its SKILL.md body
   (exactly what `/skill:name` expansion does), keeping the skills as the single source
   of instruction truth without trusting the model to fetch them. Marking
   workflow-internal skills `disable-model-invocation: true` avoids double-triggering.
4. Skills remain worthwhile for *opportunistic* pickup outside the orchestrated flow —
   keep descriptions specific per the docs' best practice.
