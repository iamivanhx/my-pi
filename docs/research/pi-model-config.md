# Model & provider configuration in pi + per-agent mapping

Research for issue #3. Sources: pi `0.83.0` bundled docs (`$(npm root -g)/@earendil-works/pi-coding-agent/docs/*`, same content as https://pi.dev/docs), `pi-subagents 0.35.1` source (`/Users/ivanhx/Projects/agentic-skills/node_modules/pi-subagents`), `pi-claude-bridge 0.6.3` (npm + vendored source), and local config under `~/.pi/agent/` (read-only inspection).

## 1. How pi configures providers and models

**Config lives under `~/.pi/agent/`, not `~/.pi/` directly.** Verified locally: `~/.pi/agent/{settings.json, auth.json, models-store.json}` exist; `~/.pi/settings.json` does not. (Source: `ls ~/.pi`; pi docs `settings.md` table: global scope is `~/.pi/agent/settings.json`, project scope is `.pi/settings.json`, project overrides global.)

**Four distinct files, four distinct jobs:**

| File | Job | Edit it? |
|---|---|---|
| `~/.pi/agent/settings.json` / `.pi/settings.json` | Defaults & behavior: `defaultProvider`, `defaultModel`, `defaultThinkingLevel` (`off…max`), plus the whole `subagents` block | Yes — this is the main surface |
| `~/.pi/agent/auth.json` | Credentials written by `/login` (OAuth tokens or API keys, auto-refresh) | Via `/login`, not by hand normally |
| `~/.pi/agent/models.json` | **Custom providers/models** (Ollama, vLLM, LM Studio, proxies) and overrides of built-in providers | Yes — this is the open-provider seam |
| `~/.pi/agent/models-store.json` | **Cache** of refreshed provider catalogs "for offline use" | No — cache, not config |

Sources: `docs/settings.md` ("Model & Thinking" table: `defaultProvider`, `defaultModel`, `defaultThinkingLevel`); `docs/providers.md` ("Built-in catalogs ship with pi; configured providers may refresh newer catalogs and cache them in `~/.pi/agent/models-store.json` for offline use"; auth file section); `docs/models.md` ("Add custom providers and models (Ollama, vLLM, LM Studio, proxies) via `~/.pi/agent/models.json`").

**Credential resolution order** (`docs/providers.md` § Resolution Order):
1. CLI `--api-key`
2. `auth.json` entry (API key or OAuth token)
3. Environment variable (e.g. `ANTHROPIC_API_KEY` → provider `anthropic`, `OPENAI_API_KEY` → `openai`; full table in `docs/providers.md`)
4. Custom provider `apiKey` from `models.json` (supports `$ENV_VAR` interpolation and `"!command"` shell execution — `docs/models.md` § Value Resolution)

**Custom providers (`models.json`)** declare `baseUrl`, `api` (one of `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`), optional `apiKey`/`headers`, a `models[]` array (only `id` required per model), per-model `reasoning`, `thinkingLevelMap`, `contextWindow`, `cost`, and a `compat` object for partially-compatible servers (`supportsDeveloperRole`, `supportsReasoningEffort`, `maxTokensField`, `thinkingFormat`, etc.). The file hot-reloads each time `/model` opens. It can also override built-in providers (e.g. route `anthropic` through a proxy) and patch built-in models via `modelOverrides`. (All: `docs/models.md`.)

**Extensions** can additionally register whole providers in code via `pi.registerProvider()` (`docs/custom-provider.md`) — this is how claude-bridge exists as a provider at all.

## 2. The two provider families in play locally

**Anthropic via `pi-claude-bridge`** (npm `pi-claude-bridge@0.6.3`, https://github.com/elidickinson/pi-claude-bridge): a pi extension that registers a `claude-bridge` provider backed by Claude Code through the Claude Agent SDK, so usage bills against the Claude subscription (README: "As of June 15, 2026 it uses subscription quota just like Claude Code direct does"; registered `cost` is all zeros — `src/models.ts` `buildModels`). Models exposed, in picker order (`src/models.ts` `MODEL_IDS_IN_ORDER`): `claude-fable-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`. Its own config is a separate file, `~/.pi/agent/claude-bridge.json` (global) or `.pi/claude-bridge.json` (project, merged over global), covering `provider.plan` (`"pro"`/`"max"`), `provider.longContextExtraUsage` (1M-context entitlement for Opus 4.6 / Sonnet 4.6; Opus 4.7/4.8/5, Sonnet 5, and Fable get 1M automatically — `src/models.ts` `resolveClaudeCodeRuntimeModel`), and the AskClaude tool options (README § Configuration, `src/config.ts`).

**OpenAI via `openai-codex`**: local `auth.json` has exactly one entry, an `openai-codex` OAuth token (`{type, access, refresh, expires, accountId}`), and `models-store.json` holds only the cached `openai-codex` catalog (`gpt-5.3-codex-spark`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.5`, … with `api: "openai-codex-responses"` and per-model `thinkingLevelMap`). Direct-API `openai` is also built in and activates with `OPENAI_API_KEY` or a `/login` API key (`docs/providers.md`).

**Current local defaults** (`~/.pi/agent/settings.json`): `defaultProvider: "claude-bridge"`, `defaultModel: "claude-fable-5"`, `defaultThinkingLevel: "high"`; the `subagents.agentOverrides` block currently only disables five roles (`reviewer`, `security-auditor`, `perf-auditor`, `cross-family-reviewer`, `scribe`).

## 3. How pi-subagents expresses per-agent model mapping

**Model strings.** A model reference is `[provider/]model[:thinking]`. The thinking suffix is parsed by `splitKnownThinkingSuffix` (`src/shared/model-info.ts:43`) against the level set `off | minimal | low | medium | high | xhigh | max` (`src/shared/model-info.ts:1`); a suffix on the model string wins over a separate `thinking` config value (`resolveEffectiveThinking`, `src/shared/model-info.ts:36-39`). Matching is fuzzy: provider separators `/ : .`, id separator variants, case, and trailing date stamps all resolve to the same model; exact `provider/id` wins; a provider-qualified query never switches providers; ambiguous bare ids require a provider prefix (README § "Changing an agent's model"). Examples from README: `anthropic/claude-sonnet-4:high`, `openai-codex/gpt-5.5:high`.

**Where a role's model comes from (precedence, highest first)** — README § "Changing an agent's model" ("Per-run model overrides and `agentOverrides.<name>.model` still win, and explicit agent frontmatter still wins over the global default"):
1. Per-run override: `/run reviewer[model=anthropic/claude-sonnet-4:high] "…"` or the `model` param of the `subagent` tool call
2. `subagents.agentOverrides.<name>.model` (+ `thinking`, `fallbackModels`) in settings
3. Agent frontmatter `model:` in the agent's `.md` file — **none of the eight bundled agents set one** (verified: `grep '^model:' agents/*.md` matches nothing; they set only `thinking:`), so builtins "inherit your current Pi default model by default"
4. `subagents.defaultModel` (applies to builtin, package, user, and project agents without frontmatter `model`)
5. The pi session/default model (`defaultProvider`/`defaultModel` in settings)

`agentOverrides.<name>` can also change `thinking`, `fallbackModels` (tried in order on provider failure — `src/runs/shared/model-fallback.ts:247-254`), `tools`, `skills`, prompt text, inherited context, or set `disabled: true` (README; parse: `src/agents/agents.ts:1011`). Related knobs: `subagents.disableThinking: true` clears bundled thinking defaults in one place; `subagents.modelScope: { enforce, allow: ["anthropic/*", …] }` glob-enforces which resolved `provider/id` values subagents may use; the watchdog is configured separately via `subagents.watchdog.main.model`/`thinking` and `subagents.watchdog.children.*` (all README). Inspect the live mapping with `/subagents-models [agent]`.

## 4. Answer: the cleanest single-place role→model surface

**The `subagents` block of one settings file is the single edit-to-switch surface.** Use `~/.pi/agent/settings.json` for a machine-wide mapping (or `.pi/settings.json` to pin one project; project overrides global — `docs/settings.md`). Because no bundled agent hard-codes a model in frontmatter, this block fully determines every role, and every entry is one `provider/model:thinking`-style string:

```jsonc
// ~/.pi/agent/settings.json — the one place to edit
{
  "defaultProvider": "claude-bridge",
  "defaultModel": "claude-fable-5",
  "defaultThinkingLevel": "high",
  "subagents": {
    // roles without an override follow this (falls back to session model if unset)
    "defaultModel": "claude-bridge/claude-fable-5",
    "agentOverrides": {
      "worker":   { "model": "claude-bridge/claude-fable-5", "thinking": "high",
                    "fallbackModels": ["openai-codex/gpt-5.4"] },
      "reviewer": { "model": "openai-codex/gpt-5.5", "thinking": "high" },   // cross-family review
      "scout":    { "model": "claude-bridge/claude-haiku-4-5", "thinking": "low" },
      "oracle":   { "model": "openai-codex/gpt-5.5", "thinking": "xhigh" }
    }
  }
}
```

Why this is the right surface:
- **Single place, plain strings.** Switching a role's family is a one-line edit of a `provider/model:thinking` string; switching the whole fleet is one `subagents.defaultModel` edit. Fuzzy matching tolerates separator/date variants (README).
- **Both current families are just provider prefixes.** Anthropic-by-subscription is `claude-bridge/...` (extension-registered provider); OpenAI is `openai-codex/...` (subscription OAuth already in `auth.json`) or `openai/...` (API key). The mapping schema doesn't care which.
- **The open-provider seam is `~/.pi/agent/models.json`, orthogonal to the mapping.** To add a future open/OpenAI-compatible provider (Ollama, vLLM, LM Studio, a proxy), declare it once in `models.json` with `baseUrl` + `api: "openai-completions"` (+ `compat` tweaks as needed); it becomes a provider prefix like any other, and the role mapping changes to e.g. `"model": "ollama/qwen2.5-coder:7b"` with **no structural change** (`docs/models.md`). Auth slots into the same resolution order (`docs/providers.md`).
- **Everything else stays out of the mapping file's way.** Credentials live in `auth.json`/env; catalog metadata is cached in `models-store.json`; claude-bridge plumbing (plan/1M context) lives in `claude-bridge.json`. None of those need touching to remap roles.
- Optional guard rail: add `subagents.modelScope` (`{ "enforce": true, "allow": ["claude-bridge/*", "openai-codex/*"] }`) so a typo'd or drifting mapping fails loudly instead of silently using an unintended provider (README § model scope).

Caveats: per-run `[model=...]` overrides and an agent file's own `model:` frontmatter outrank this block, so keep custom agents' frontmatter model-free to preserve the single surface; the watchdog needs its own `subagents.watchdog.*` entries; and settings changes load on pi restart (`/subagents-models` shows the live mapping, which "can differ from settings on disk until you reload Pi" — README).
