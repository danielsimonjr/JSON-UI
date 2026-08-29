# JSON-UI — TODO

Open work for this repo. File an item before starting it, tick it on completion, and record the
change in `CHANGELOG.md`.

## Open

- [ ] 🟡 **Internal deps are pinned to `"*"` — safe today, a hazard the moment anything publishes.**
      `@json-ui/headless` and `@json-ui/react` both declare `"@json-ui/core": "*"`. Inside the
      workspace this resolves locally and is correct, which is why every gate passes. In a
      *published* tarball `*` means "any version on the registry", so a consumer installs whatever
      `@json-ui/core` happens to be latest — including, if the `@json-ui` scope is not owned, a
      package published by someone else entirely. Left unchanged for the v0.2.0 release deliberately:
      nothing here is on npm (all three are 404), so the fix is not urgent and changing dependency
      resolution is not something to slip into a release commit unannounced.
      Fix when publishing is actually on the table: pin to `^0.2.0` (or `workspace:*` if the
      publish tooling rewrites it), and confirm the `@json-ui` scope is owned before the first
      `npm publish`.

- [ ] 🟢 **No npm presence at all.** `@json-ui/core`, `@json-ui/headless` and `@json-ui/react` all
      return 404. Decide whether these are meant to ship publicly, and under which scope — the rest
      of the fleet publishes under `@danielsimonjr`, not `@json-ui`. Until that is settled the
      packages are GitHub-release-only.
