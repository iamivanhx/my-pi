# Designer skill pins

The designer has two upstream design-skill sources, selected in
[`.pi/settings.json`](../../.pi/settings.json):

- Anthropic's `frontend-design`, loaded from
  `git:github.com/anthropics/skills@b29e7cf65e5cb78a5ac33d582270551bc74a14eb`.
- Vercel's `web-design-guidelines`, vendored under
  [`.pi/skills/web-design-guidelines`](../../.pi/skills/web-design-guidelines)
  from `vercel-labs/web-interface-guidelines` commit
  `4e799d45c17aec1498c269287a83b9dba22b966b`.

`design-system` is project-local rather than upstream-pinned. It defines the
portable Stitch `DESIGN.md` schema used to ground designer work.

## Deliberate pin bumps

1. Review the candidate upstream commit and the relevant skill/guideline
   changes.
2. For `frontend-design`, update the full commit SHA in `.pi/settings.json`,
   then reconcile the project package with:

   ```bash
   pi install -l git:github.com/anthropics/skills@<new-commit>
   ```

   Reapply its narrow `skills` filter so no other Anthropic skill is loaded.
3. For `web-design-guidelines`, replace only the vendored `guidelines.md` from
   the reviewed `command.md`; update its full source commit in `SOURCE.md`.
   Do not restore the upstream runtime fetch from `main`.
4. Update this document's full commit SHA(s), run `pnpm test` and `pnpm check`,
   then commit the bump.
