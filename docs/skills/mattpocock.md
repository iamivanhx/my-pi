# Matt Pocock skills pin

`my-pi` loads the selected Matt Pocock skills directly from
[`mattpocock/skills`](https://github.com/mattpocock/skills) at this immutable
commit:

```text
git:github.com/mattpocock/skills@2ffb184ffbb752faa664c0b204f3c9241b1428e9
```

The selected paths live in [`.pi/settings.json`](../../.pi/settings.json).
They intentionally expose the 15 required skills: the nine surviving baseline
skills (the former ten-skill baseline drops `grill-with-docs`) and six extras.
They also exclude `implement`, `handoff`, `rollout`, and `operate`. No skill
files are vendored in this repository.

## Deliberate pin bumps

1. Review the candidate upstream commit and the skills it changes.
2. Install the reviewed commit into the project configuration:

   ```bash
   pi install -l git:github.com/mattpocock/skills@<new-commit>
   ```

3. Reapply the selected `skills` filter in `.pi/settings.json`; do not load
   newly available skills by default.
4. Update this document with the new full commit SHA and run the package-loading
   test suite before committing the pin bump.
