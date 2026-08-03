# Token-efficiency techniques & existing pi packages

Research for issue #4. Sources checked 2026-08-03: pi docs ([pi.dev/docs](https://pi.dev/docs)) and the pi package registry ([pi.dev/packages](https://pi.dev/packages), 5,370 packages at time of survey).

## TL;DR

Pi already ships strong native token management — auto-compaction, branch summarization, session branching, on-demand skills, and automatic prompt caching — all tunable via settings. The registry is saturated with token-efficiency packages (200+ matching "token", 155 matching "compact"). **No new extension is needed.** The recommendation is a posture: tune compaction settings, practice session hygiene (`/new`, `/fork`, `/tree`), offload big scoped work to subagents, and be cache-aware before adopting any context-mutating package.

## 1. What pi supports natively

All claims cite the pi docs.

### 1.1 Auto-compaction and `/compact`

From [Compaction & Branch Summarization](https://pi.dev/docs/latest/compaction):

- Auto-compaction triggers when `contextTokens > contextWindow - reserveTokens`; `reserveTokens` defaults to 16,384 tokens.
- The cut-point walk keeps the most recent ~`keepRecentTokens` (default 20,000) untouched and summarizes everything older into a `CompactionEntry`; the session then reloads as `summary + kept messages`.
- Manual `/compact [instructions]` lets you focus the summary ("keep the API decisions, drop the debugging detours").
- Summaries use a structured format (Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context) plus cumulative `<read-files>` / `<modified-files>` tracking that survives repeated compactions.
- During summary generation, tool results are truncated to 2,000 chars — the docs explicitly note that tool results (especially `read` and `bash`) "are typically the largest contributors to context size."
- Settings live in `~/.pi/agent/settings.json` or `<project>/.pi/settings.json`:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

### 1.2 Branch summarization and session branching

- `/tree` navigation offers to summarize the branch you abandon and injects that summary into the target branch ([compaction doc](https://pi.dev/docs/latest/compaction#branch-summarization)) — so exploratory dead-ends cost one summary, not their full transcript.
- The [Sessions doc](https://pi.dev/docs/latest/sessions) recommends `/tree` to "keep alternatives together" and `/fork` / `/clone` "when you want a separate session file"; [Using Pi](https://pi.dev/docs/latest/usage) documents `/new` (fresh session), `/fork` (branch from an earlier user message), and `/clone`. This is the primary practice signal in the docs: branch or restart instead of letting one session bloat.

### 1.3 Extension hooks for custom summarization

- `session_before_compact` and `session_before_tree` events let an extension cancel or replace the default summary, including using a different (cheaper) model — the docs link a complete [`custom-compaction.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/custom-compaction.ts) example ([compaction doc](https://pi.dev/docs/latest/compaction#custom-summarization-via-extensions)).

### 1.4 Prompt caching

- Prompt caching is handled by pi/providers automatically — e.g. the [Providers doc](https://pi.dev/docs/latest/providers) notes "Prompt caching is enabled automatically for Claude models" (Bedrock section).
- Pi is deliberately cache-aware around summarization: compaction and branch-summary requests "use fresh routing session IDs and, where supported by the provider, disable prompt-cache writes because these one-off prompts are unlikely to be reused" ([compaction doc](https://pi.dev/docs/latest/compaction#overview)).
- The TUI footer surfaces "token/cache usage, cost, context usage" live ([Using Pi](https://pi.dev/docs/latest/usage)), so cache hit behavior is observable without extra tooling.

### 1.5 Skills: progressive disclosure

- The [Skills doc](https://pi.dev/docs/latest/skills) states skills load on-demand with "progressive disclosure: only descriptions are always in context, full instructions load on-demand." Packaging procedures as skills (rather than pasting them into project instructions) is itself a token-saving technique.

### 1.6 Subagent offloading

- Core pi has no built-in subagent tool, but the extension API supports it (`ctx.newSession()`, `ctx.fork()` in the [Extensions doc](https://pi.dev/docs/latest/extensions)), and the official examples include a `subagent/` extension ("Spawn sub-agents"). In practice the community package `pi-subagents` (§2.1) is the de-facto standard.

## 2. Registry landscape

Survey of [pi.dev/packages](https://pi.dev/packages) (5,370 total; queried `token`, `context`, `cache`, `compact`, `prune`, `trim`, `condense`, `summar`, `efficien`; sorted by downloads). Every token-efficiency niche is already occupied, usually several times over. Downloads are monthly, as of 2026-08-03.

### 2.1 Subagent offloading (keep the parent context clean)

| Package | Downloads | Notes |
|---|---|---|
| [pi-subagents](https://pi.dev/packages/pi-subagents) | 172.7K | De-facto standard. Child agents "start with a clean system prompt and only the context you intentionally give them"; foreground/background runs, chains, parallel execution. |
| [@quintinshaw/pi-dynamic-workflows](https://pi.dev/packages/@quintinshaw/pi-dynamic-workflows) | 28.4K | Fan-out across "100s of subagents" with token/cost accounting, git-worktree isolation, per-subagent context governance. |
| [avtc-pi-subagent](https://pi.dev/packages/avtc-pi-subagent) | 1.3K | Subagents with context compaction and nesting. |
| [pi-boomerang](https://pi.dev/packages/pi-boomerang) | 0.6K | "Token-efficient autonomous task execution with context collapse." |

### 2.2 Tool-output reduction (attack the biggest context contributor)

| Package | Downloads | Notes |
|---|---|---|
| [@hypabolic/pi-hypa](https://pi.dev/packages/@hypabolic/pi-hypa) | 14.5K | Rewrites bash through a local deterministic compressor; keeps errors/warnings/changed-files, evidence recoverable. Not an LLM summarizer. |
| [pi-rtk-optimizer](https://pi.dev/packages/pi-rtk-optimizer) | 11K | RTK command rewriting + tool output compaction. |
| [pi-lean-ctx](https://pi.dev/packages/pi-lean-ctx) | 7.7K | Routes bash/read/grep/find/ls through lean-ctx, claims 60–90% savings; session cache makes unchanged re-reads cost ~13 tokens. |
| [pi-condense](https://pi.dev/packages/pi-condense) | 1.8K | Replaces finished tool-call batches with recoverable stubs; explicitly timed around prompt-cache boundaries. |
| [pi-bash-trim](https://pi.dev/packages/pi-bash-trim) | 0.06K | Smart bash output trimming to fit context budgets. |

### 2.3 Alternative / smarter compaction

| Package | Downloads | Notes |
|---|---|---|
| [@monotykamary/pi-vcc](https://pi.dev/packages/@monotykamary/pi-vcc) (and fork @sting8k/pi-vcc) | 1.8K | Algorithmic compactor, **no LLM calls**: deterministic, 35–99% reduction on real sessions, 30–470 ms, history recoverable via `vcc_recall`. |
| [pi-async-compaction](https://pi.dev/packages/pi-async-compaction) | 1.3K | Precomputes background summaries so compaction doesn't block. |
| [pi-observational-memory](https://pi.dev/packages/pi-observational-memory) | 4.1K | "Cache-friendly tiered compaction with observations and reflections." |
| [pi-smart-compact](https://pi.dev/packages/pi-smart-compact) / [pi-ultra-compact](https://pi.dev/packages/pi-ultra-compact) / [pi-blackhole](https://pi.dev/packages/pi-blackhole) | 2.2K / 1.4K / 1.5K | Verification-oriented, threshold-based, and observation-preserving compaction variants. |
| [pi-reasoning-zip](https://pi.dev/packages/pi-reasoning-zip) | 1.7K | Compacts reasoning/thinking blocks. |

### 2.4 Context pruning

| Package | Downloads | Notes |
|---|---|---|
| [pi-dynamic-context-pruning](https://pi.dev/packages/pi-dynamic-context-pruning) | 0.8K | Prunes stale/duplicate tool output, "gated by a cache-aware net-benefit calculation so pruning only happens when it's actually worth the prompt-cache cost." Non-destructive, branch-aware. |
| [pi-context-prune](https://pi.dev/packages/pi-context-prune) | 0.7K | Prunes future context, preserves original tool-call history. |
| [@8monkey/pi-context-history](https://pi.dev/packages/@8monkey/pi-context-history) | 0.8K | Trims old history, strips stale tool calls, rolling summary in system prompt. |

### 2.5 Prompt-cache optimization

| Package | Downloads | Notes |
|---|---|---|
| [pi-cache-optimizer](https://pi.dev/packages/pi-cache-optimizer) | 5.8K | Reorders stable system-prompt content to the front, OpenAI-compatible `prompt_cache_key` fallback, long-retention requests, proxy warnings, footer cache stats. |
| [@mrclrchtr/supi-cache](https://pi.dev/packages/@mrclrchtr/supi-cache) | 4.1K | Prompt-cache health monitoring and cross-session forensics. |
| [pi-opencode-go-cache](https://pi.dev/packages/pi-opencode-go-cache) | 0.4K | Cache stamping for pi's opencode-go provider (Kimi/DeepSeek/etc.). |

### 2.6 Output terseness (cut assistant output tokens)

| Package | Downloads | Notes |
|---|---|---|
| [pi-caveman](https://pi.dev/packages/pi-caveman) | 4K | "~75% of output tokens" cut via terse style modes. |
| [pi-laconic](https://pi.dev/packages/pi-laconic) | 1.7K | Ultra-compressed output, three intensity modes. |
| [@fernado03/oh-my-pi-supreme-token-saver](https://pi.dev/packages/@fernado03/oh-my-pi-supreme-token-saver) | 4K | Toggleable terse-reply/compact-shell extensions. |

### 2.7 Observability (measure before optimizing)

[pine-of-glass](https://pi.dev/packages/pine-of-glass) (5.5K, token accounting/tool-trace), [@mrclrchtr/supi-context](https://pi.dev/packages/@mrclrchtr/supi-context) (4.6K, context-pressure snapshots), [@liziy/token-stats](https://pi.dev/packages/@liziy/token-stats) (quota/cache-hit-rate footer), plus many footer/statusline packages that show token/cache/cost.

## 3. What the docs recommend as practice

Synthesized from the primary sources above:

1. **Let auto-compaction work; steer it when it matters** — use `/compact <instructions>` before a milestone so the summary keeps what you care about ([compaction](https://pi.dev/docs/latest/compaction)).
2. **Session hygiene over marathon sessions** — `/new` per task; `/fork`//`/tree` for alternatives so abandoned branches become one summary, not permanent context ([sessions](https://pi.dev/docs/latest/sessions), [usage](https://pi.dev/docs/latest/usage)).
3. **Tool output is the enemy** — the docs single out `read`/`bash` results as the largest context contributors ([compaction](https://pi.dev/docs/latest/compaction#message-serialization)); prefer targeted reads/greps over dumps.
4. **Use skills for procedures** — progressive disclosure means only descriptions ride along every turn ([skills](https://pi.dev/docs/latest/skills)).
5. **Don't fight the prompt cache** — pi itself avoids cache-write pollution for one-off summarization prompts ([compaction](https://pi.dev/docs/latest/compaction#overview)); anything that rewrites earlier context every turn busts cache and can cost more than it saves (a point the pi-condense and pi-dynamic-context-pruning READMEs both engineer around).

## 4. Recommendations for the SDLC workflow & settings

1. **Build no new extension.** Every niche (compaction, pruning, tool-output compression, caching, subagents, terseness, observability) has multiple maintained packages; native features cover the baseline.
2. **Settings tuning** (`.pi/settings.json`): keep `compaction.enabled: true`. For long autonomous SDLC runs, consider raising `reserveTokens` (headroom for big final responses) and `keepRecentTokens` (more intact recent work at the cost of earlier compaction). Defaults (16,384 / 20,000) are reasonable starting points.
3. **Encode the SDLC phases as session boundaries**: one session (or subagent) per phase — research, plan, implement, review — with structured handoffs, instead of one mega-session. This is the native-feature-aligned version of "be efficient."
4. **If adopting packages, shortlist**: `pi-subagents` (offloading; dominant by downloads), `pi-cache-optimizer` (cache hit rates, useful for OpenAI-compatible/proxy providers), and one tool-output reducer (`@hypabolic/pi-hypa` or `pi-lean-ctx`) — trial individually while watching the footer's cache/token stats, since context-mutating extensions can degrade cache hit rates.
5. **Standing posture for project instructions**: prefer targeted `read`/`grep` over whole-file dumps, delegate bulk exploration to subagents, `/compact` with instructions before phase transitions, terse output style.

## Answer to the ticket question

Pi natively supports: threshold-based auto-compaction with tunable settings, manual focused `/compact`, branch summarization on `/tree`, session branching (`/fork`, `/clone`, `/new`), extension hooks for custom summarization, automatic provider prompt caching with cache-aware summarization requests, and on-demand skill loading. The registry already provides mature packages for every remaining niche. **Conclusion: adopt settings + practices (and optionally 1–3 existing packages); build nothing new.**
