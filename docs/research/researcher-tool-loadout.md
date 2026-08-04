# Researcher subagent tool loadout — is pi-web-access enough?

Research for issue #16 (`iamivanhx/my-pi`). Date: 2026-08-04. Intended final location per the issue: `docs/research/researcher-tool-loadout.md`.

**Short answer:** pi-web-access alone covers ~90% of what a research agent needs — and it actually ships a fourth tool, `source_check`, that the current loadout (`web_search`, `fetch_content`, `get_search_content`) omits. The one genuine capability gap is interactive browsing (JS-only flows, logins, clicking through docs portals), best filled by `pi-lean-portal`. Everything else surveyed is either redundant, immature, or deprecated.

---

## 1. What pi-web-access already covers

Source: npm README, https://www.npmjs.com/package/pi-web-access (v0.18.0). Repo: https://github.com/nicobailon/pi-web-access

Registered tools:

| Tool | Capability |
| --- | --- |
| `web_search` | Multi-provider search with synthesized cited answers. Providers: SearXNG (self-hosted, preferred when configured), OpenAI/Codex, Exa (zero-config MCP), Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, SERPdive, Kagi, Ollama, Perplexity, Gemini; explicit-only: AnySearch, xAI, Bright Data SERP, SerpBase. Supports batch `queries`, `recencyFilter`, `domainFilter`, `provider: "all"`, `includeContent`. |
| `fetch_content` | URL → readable Markdown with a deep extraction fallback chain (Readability → Firecrawl → Jina Reader → TinyFish → Search1API → Querit → Kagi Extract → Ollama Web Fetch → Parallel → Bright Data Unlocker → Gemini). Special handling: **GitHub URLs are cloned locally** (real file contents + local path; repos >350MB get an API view; private repos via `gh`), **PDFs** converted to Markdown (Gemini or local `unpdf`), **YouTube/local video** understanding via Gemini incl. transcripts and frame extraction, raw mode, page-grounded answer mode, direct images. |
| `get_search_content` | Retrieval of stored full content from prior searches/fetches, with `findText` passage search and offset/limit paging. |
| `source_check` | **Not in the current researcher loadout.** Claim verification: runs searches, dedupes to ≤20 sources, optionally fetches ≤5 pages, and returns a machine-readable artifact with claim status (`supported` / `contradicted` / `unclear` / `missing-evidence`), exact passage citations with offsets, and SHA-256 content hashes. |

Maturity: latest 0.18.0 published 2026-08-03 (npm registry `time` field, https://registry.npmjs.org/pi-web-access); ~175,572 downloads in the last month (https://api.npmjs.org/downloads/point/last-month/pi-web-access); MIT; maintained by nicobailon — the same author as pi-subagents itself, so parent/child integration is first-party-adjacent.

**Coverage verdict:** search, page/PDF/GitHub/YouTube fetching, deep-content retrieval, and citation-grade fact checking are all covered by this single package. What it cannot do: drive an interactive browser (click, type, log in, exercise SPAs that resist server-side extraction) — its fallback chain mitigates but does not eliminate this.

## 2. Registry survey — research-relevant extensions

Surveyed via pi.dev package catalog (https://pi.dev/packages, https://pi.dev/packages?type=extension) and npm.

### Browser automation / interactive browsing

| Package | What it is | Maturity | Verdict |
| --- | --- | --- | --- |
| `pi-lean-portal` (https://www.npmjs.com/package/pi-lean-portal) | Playwright-based interactive `browser-navigate` tools: accessibility-tree element refs, click/type/scroll/screenshot, persistent profiles + cookies, `/web` toggle. Requires `npx playwright install chromium firefox`. | v0.4.0, published 2026-08-02; steady releases since 2026-06 (npm registry time data); ~1,844 downloads/month; AGPL-3.0; repo https://github.com/coreyryanhanson/pi-lean-dimension | **Best interactive-browsing candidate.** Actively maintained; the only real gap-filler. AGPL license is fine for internal tooling. |
| `pi-browser-cdp-extension` (https://www.npmjs.com/package/pi-browser-cdp-extension) | `browser_execute` over Chrome DevTools Protocol against your real Chrome. | **Deprecated** — npm registry marks v1.1.0 "Package no longer supported"; only 2 releases (May 2026). | Rejected. |
| `@53able/pi-agent-browser` (https://pi.dev/packages/%4053able/pi-agent-browser) | Typed browser tools via `agent-browser` + Chrome for Testing; persistent sessions, domain restrictions. | ~1,157 downloads/month (npm downloads API); requires separate `agent-browser install` runtime. | Viable alternative, but extra runtime dependency and smaller footprint than pi-lean-portal; skip. |

### GitHub / API access

- pi-web-access already clones GitHub repos locally on `fetch_content` (see §1), and Pi's builtin `bash` reaches the authenticated `gh` CLI (`gh api`, `gh pr`, `gh issue`) — the Pi extensions doc positions shell access as the normal path for this (https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md). This repo's own issue tracker workflow already assumes `gh` (CLAUDE.md).
- No maintained, dedicated `pi-github-tools`-style extension surfaced in the registry survey; community options are `gh`-CLI recipe bundles like `tomsej/pi-ext` (https://github.com/tomsej/pi-ext), which are skills/recipes, not new tool capability.
- **Conclusion: no package needed — grant `bash` in the researcher's `tools` list instead.**

### Docs-specific fetchers / RAG-style knowledge access

- `@heyhuynhgiabuu/pi-search` (https://pi.dev/packages/%40heyhuynhgiabuu/pi-search): bundles a `context7` tool (up-to-date library docs) plus web/code search, GitHub repo Q&A, URL/PDF fetch, site crawling. Maturity: v0.3.0, last publish 2026-07-17; ~737 downloads/month (npm downloads API); single maintainer. Heavy overlap with pi-web-access; the only unique piece is Context7.
- Context7 is independently reachable without any Pi extension via its CLI (`npx ctx7 library <name>`, `npx ctx7 docs <id> "<query>"` — https://context7.com/docs/clients/cli) or via MCP through `pi-mcp-adapter` + an `mcp:context7/...` tools entry.
- No maintained local-knowledge-base/RAG extension for Pi stood out in the survey; the ecosystem answer for arbitrary knowledge sources is MCP via `pi-mcp-adapter` (https://www.npmjs.com/package/pi-mcp-adapter — v2.19.0, published 2026-08-03, ~246,448 downloads/month, same maintainer as pi-web-access). pi-subagents has first-class support for it: `mcp:` entries in a child's `tools` frontmatter forward direct MCP tool selections (pi-subagents README, https://www.npmjs.com/package/pi-subagents).

## 3. How pi-subagents wires extension tools into a child agent

Source: pi-subagents README (https://www.npmjs.com/package/pi-subagents; repo https://github.com/nicobailon/pi-subagents).

Frontmatter semantics that matter here:

- **`tools`** — strict allowlist. Omitted ⇒ Pi's normal builtins; empty ⇒ no tools (`--no-tools`). **Listing an extension tool name does not load its provider** — the extension must load via ambient discovery, `extensions`, `subagentOnlyExtensions`, or a path-like `tools` entry. `mcp:` entries are forwarded as direct MCP selections (requires pi-mcp-adapter) and do not grant builtins unless those are also listed.
- **`extensions`** — omitted ⇒ ambient extensions load; empty ⇒ none; a list ⇒ only those paths (plus required pi-subagents runtime pieces and any `subagentOnlyExtensions`).
- **`subagentOnlyExtensions`** — extension paths loaded only in this agent's child sessions; tools registered there survive the strict `tools` allowlist but never reach the parent.
- Fail-fast guarantee: before the first model turn, the child runtime compares every explicit tool name against Pi's final registry and **fails the run naming the missing providers** with `extensions`/`subagentOnlyExtensions` guidance — so a wrong loadout is loud, not silent.
- Per-agent settings overrides exist without editing bundled files: `subagents.agentOverrides.researcher.{tools,extensions,...}` in `.pi/settings.json` or `~/.pi/agent/settings.json`; `subagents.defaultExtensions` sets a shared allowlist for agents that don't declare one.

Practical wiring per candidate:

| Candidate | Wiring needed |
| --- | --- |
| pi-web-access (installed via `pi install npm:pi-web-access`) | Ambient extension; just list `web_search, fetch_content, get_search_content, source_check` in `tools`. Do **not** set `extensions: []` (that would unload it), or if you do allowlist, include its extension path. |
| pi-lean-portal | `pi install npm:pi-lean-portal` + `npx playwright install chromium firefox`; add its `browser-navigate` tool name(s) to `tools`. Loads ambiently once installed. |
| Context7 via MCP | `pi install npm:pi-mcp-adapter`, configure the Context7 server in `mcp.json`, then add `mcp:context7/<tool>` entries to `tools`. Note: global `directTools: true` in `mcp.json` is not enough — the `mcp:` frontmatter entry is required per agent. |
| `gh` CLI | No package; add `bash` (or a restricted shell tool) to `tools`. |

## 4. Recommended researcher loadout

```md
---
name: researcher
description: Web/docs research with sources; returns a cited research brief
tools:
  - read
  - bash
  - web_search
  - fetch_content
  - get_search_content
  - source_check
---
```

- **Packages:** `pi-web-access` (already installed) — no new required package.
- **Immediate wins, zero new dependencies:**
  1. Add `source_check` — pi-web-access already registers it; it directly serves the researcher's "trust external facts" role with machine-readable passage-cited verification (pi-web-access README).
  2. Add `read` + `bash` — `fetch_content` clones GitHub repos to a local path and saves PDF Markdown to disk expecting the agent to `read` sections (pi-web-access README); `bash` also unlocks `gh api` for issues/PRs/releases. Without `read`, half of the GitHub/PDF value of pi-web-access is stranded.
- **Optional add (only if interactive browsing proves needed in practice):** `pi-lean-portal` (`pi install npm:pi-lean-portal` + Playwright browsers), then append its browser tool name to `tools`. Defer until a real research task is blocked by a JS-only or login-gated page, since pi-web-access's Jina/Firecrawl/Gemini fallback chain already handles most SPA/anti-bot pages.
- Prefer applying via `subagents.agentOverrides.researcher.tools` in `.pi/settings.json` if the researcher is the pi-subagents builtin rather than a project agent file — overrides merge into unset frontmatter fields (pi-subagents README).

## 5. Not worth it

| Package | Reason |
| --- | --- |
| `pi-browser-cdp-extension` | Deprecated on npm ("Package no longer supported"), 2 releases total. |
| `@heyhuynhgiabuu/pi-search` | ~90% overlap with pi-web-access (search/fetch/PDF/GitHub); low adoption (~737 dl/mo); its unique Context7 piece is available via `npx ctx7` from `bash` or via pi-mcp-adapter without adopting an overlapping toolset. |
| `@53able/pi-agent-browser` | Viable but needs a separate `agent-browser` runtime install and has a smaller footprint than pi-lean-portal; one interactive-browser extension is enough. |
| Dedicated GitHub extension | None maintained in the registry; `gh` CLI via `bash` + pi-web-access repo cloning already cover it. |
| `pi-mcp-adapter` for the researcher specifically | Excellent, very actively maintained package (246k dl/mo), but adds config surface (mcp.json + per-agent `mcp:` entries) without a concrete MCP server need today; adopt when a specific knowledge source (e.g., Context7 MCP, internal RAG server) is actually wanted. |

## Source index

- pi-web-access README/npm: https://www.npmjs.com/package/pi-web-access · registry metadata: https://registry.npmjs.org/pi-web-access · downloads: https://api.npmjs.org/downloads/point/last-month/pi-web-access
- pi-subagents README/npm (frontmatter wiring, builtin researcher, agentOverrides): https://www.npmjs.com/package/pi-subagents
- Pi package catalog: https://pi.dev/packages · extensions doc: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
- pi-lean-portal: https://www.npmjs.com/package/pi-lean-portal · registry: https://registry.npmjs.org/pi-lean-portal
- pi-browser-cdp-extension (deprecated): https://registry.npmjs.org/pi-browser-cdp-extension
- @53able/pi-agent-browser: https://pi.dev/packages/%4053able/pi-agent-browser
- @heyhuynhgiabuu/pi-search: https://pi.dev/packages/%40heyhuynhgiabuu/pi-search · registry: https://registry.npmjs.org/@heyhuynhgiabuu/pi-search
- pi-mcp-adapter: https://registry.npmjs.org/pi-mcp-adapter
- Context7 CLI: https://context7.com/docs/clients/cli
- tomsej/pi-ext (gh recipes): https://github.com/tomsej/pi-ext

---

## Addendum (2026-08-04, post-review)

The survey missed **[@upstash/context7-pi](https://www.npmjs.com/package/@upstash/context7-pi)** (0.1.2, ~3.1k dl/mo): an *official* Upstash pi extension registering `resolve-library-id` + `query-docs` directly — no MCP adapter or `ctx7` CLI detour. **Recommended loadout amended to include it:**

`read, bash, web_search, fetch_content, get_search_content, source_check, resolve-library-id, query-docs` (add `pi install npm:@upstash/context7-pi`).

Consequences: the pi-mcp-adapter defer verdict strengthens (its last near-term use case is gone). Also reviewed and skipped: [context-mode](https://www.npmjs.com/package/context-mode) — redundant with pi's native context management per the token-efficiency decision (#4).
