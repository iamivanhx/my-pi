# Status line feasibility in pi

Research for issue #5. Verified against `@earendil-works/pi-coding-agent@0.83.0` (local global install) and pi.dev on 2026-08-03.

## TL;DR

**Install, don't build.** Pi has a first-class footer/status-line extension API, and the registry already has dozens of mature status-line packages. Every element of the Claude Code-style status line (model, branch, context bar, cost, +/- lines) is covered by existing packages — `pi-footer` covers all five in one package. A custom build is only warranted if the exact gradient aesthetic matters, and even then it is a small (~60-line) extension on a documented API.

## 1. Does pi expose a footer / status-line / widget API?

Yes — three tiers, all documented in the extensions/TUI docs:

| API | What it does | Source |
| --- | --- | --- |
| `ctx.ui.setStatus(key, text)` | Persistent status text merged into the built-in footer | [docs/tui.md ("Pattern 4: Persistent Status Indicator")](https://pi.dev/docs/latest/tui); shipped example `examples/extensions/status-line.ts` |
| `ctx.ui.setWidget(key, lines, {placement})` | Persistent widget above/below the input editor | [docs/tui.md ("Pattern 5: Widgets Above/Below Editor")](https://pi.dev/docs/latest/tui) |
| `ctx.ui.setFooter((tui, theme, footerData) => component)` | **Replaces the footer entirely** with a custom renderer; `setFooter(undefined)` restores the default | [docs/tui.md ("Pattern 6: Custom Footer")](https://pi.dev/docs/latest/tui); [docs/extensions.md ("Widgets, Status, and Footer")](https://pi.dev/docs/latest/extensions); shipped example `examples/extensions/custom-footer.ts` |

Related: `ctx.ui.setWorkingIndicator(...)` customizes the streaming spinner, and `setEditorComponent` can replace the whole editor (docs/tui.md, Patterns 4b and 7). The package's own examples index (`docs/extensions.md`, "UI Components" table) lists `status-line.ts` ("Footer status indicator") and `custom-footer.ts` ("Replace footer entirely") as canonical patterns.

## 2. What session data is reachable from such an extension?

All of the Claude Code status-line data points are reachable:

| Data point | How | Source |
| --- | --- | --- |
| Model | `ctx.model?.id`; context window via model config `contextWindow` | `examples/extensions/custom-footer.ts`; `dist/core/model-config.d.ts:32` (`contextWindow` field) |
| Tokens / context % | Iterate `ctx.sessionManager.getBranch()`, sum assistant `message.usage.input/output`; divide by `contextWindow` for % | `examples/extensions/custom-footer.ts` (does exactly this); docs/tui.md: "Token stats available via `ctx.sessionManager.getBranch()` and `ctx.model`" |
| Cost | Same loop: `message.usage.cost.total` | `examples/extensions/custom-footer.ts` |
| Git branch | `footerData.getGitBranch()` (null if not a repo, `"detached"` for detached HEAD), reactive via `footerData.onBranchChange(cb)` | `dist/core/footer-data-provider.d.ts` (`ReadonlyFooterDataProvider`); docs/tui.md Pattern 6: "`footerData` exposes data not otherwise accessible to extensions" |
| Lines changed (+/-), dirty state, anything else | Shell out with `pi.exec("git", ["diff", "--shortstat"], ...)` | `docs/extensions.md` §`pi.exec(command, args, options?)` (line ~1615) |
| Other extensions' statuses | `footerData.getExtensionStatuses()` | `dist/core/footer-data-provider.d.ts` |

So a footer extension can compute model, branch, context %, cost, and +/- lines with no gaps in the API.

## 3. Do installable status-line packages already exist?

Yes, in abundance. The registry ([pi.dev/packages](https://pi.dev/packages), 5,370 packages at time of research; filterable via `?name=...`) returns dozens of hits for footer/statusline/powerline. Top candidates (downloads/mo per registry listing, 2026-08-03):

| Package | Downloads/mo | Notes |
| --- | --- | --- |
| `pi-powerline-footer` (nicopreme) | 11.6K | Most popular. Powerline bar in the editor border; git branch + staged/unstaged/untracked; color-coded context warnings (70%/90%); token/cost display; Nerd Font autodetect. (npm README v0.11.0) |
| `@narumitw/pi-statusline` | 9.7K | "Replaces the footer with an information-rich statusline": model, thinking, cwd, git/PR state, `ctx 42.0%/200k`, cost; 7 color presets, responsive; `/statusline` config menu. (npm README v0.46.0) |
| `pi-zentui` | 7.3K | Starship-inspired statusline + Opencode-style TUI theme |
| `@firstpick/pi-extension-git-footer-status` | 4.7K | "git status, token usage, context usage, and model telemetry"; cost + context-window usage |
| `@shvax/pi-statusline` | 2.8K | Configurable single-line status footer |
| `@narumitw/pi-starship` | 2.0K | Starship-style TOML-configurable statusline |
| `pi-footer` (wobondar) | 1.1K | **Covers every requested element**: `Git Diff` segment ("Uncommitted insertion/deletion summary … `+42/-10`"), `Context Bar` ("Progress bar plus context usage … `[████████░░░…] 50k/200k`" with conditional colors), model, cost, presets incl. powerline. (npm README) |
| `pi-hud-footer` | 1.1K | "Claude HUD style" footer; configurable `barWidth` context progress bar, tokens, cache rate |
| `pi-shannon-statusline` | 0.3K | Port of a Claude Code statusline (shannon) to pi |

Also relevant: `@morgan.rebrand/claude-statusline` ("Statusline renderer for Claude Code, Antigravity CLI, and Pi") and many powerline variants/forks.

## 4. Mapping to the desired Claude Code status line (AKCodez gist)

| Desired element | Available? | Where |
| --- | --- | --- |
| Model name | Yes | virtually all packages; API: `ctx.model.id` |
| Git branch | Yes | all; API: `footerData.getGitBranch()` |
| Gradient context bar | Bar: yes (`pi-footer` Context Bar, `pi-hud-footer` barWidth, conditional colors in `pi-powerline-footer`). A true per-cell color *gradient* is not advertised verbatim by any package — the one cosmetic gap. | package READMEs |
| Cost ($) | Yes | `pi-footer`, `pi-powerline-footer`, `@narumitw/pi-statusline`, etc.; API: `usage.cost.total` |
| +/- lines changed | Yes | `pi-footer` Git Diff segment (`+42/-10`); API: `pi.exec` git |

## Recommendation

1. **Install first**: `pi install npm:pi-footer` — the only single package advertising all five elements (model, branch, context bar, cost, +/- diff), with presets and per-segment config. Alternative if you prefer popularity/polish over the diff segment: `pi install npm:pi-powerline-footer` or `npm:@narumitw/pi-statusline`. (Don't run two footer-owning extensions at once — `@narumitw/pi-statusline` README warns both would own the footer.)
2. **Build only for the gradient**: if the exact gradient bar from the Claude Code gist is a hard requirement, write a ~60-line extension modeled on `examples/extensions/custom-footer.ts` — the API surface (`setFooter` + `footerData` + `sessionManager.getBranch()` + `pi.exec git diff --shortstat`) provides everything; only the ANSI gradient rendering is custom work.

## Sources

- Pi docs (web): https://pi.dev/docs/latest/tui , https://pi.dev/docs/latest/extensions , https://pi.dev/docs/latest/packages
- Pi package source (same docs shipped locally): `$(npm root -g)/@earendil-works/pi-coding-agent` v0.83.0 — `docs/tui.md` (Patterns 4–7), `docs/extensions.md` ("Custom UI", "Widgets, Status, and Footer", `pi.exec`), `examples/extensions/status-line.ts`, `examples/extensions/custom-footer.ts`, `dist/core/footer-data-provider.d.ts`, `dist/core/model-config.d.ts`
- Registry: https://pi.dev/packages?name=footer , `?name=statusline` , `?name=powerline` (queried 2026-08-03)
- Package READMEs via npm registry: `pi-powerline-footer@0.11.0`, `@narumitw/pi-statusline@0.46.0`, `pi-footer`, `pi-hud-footer`, `@firstpick/pi-extension-git-footer-status`, `@zigai/pi-footer`
