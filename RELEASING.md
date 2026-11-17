# Releasing

`package.json` (`description`, `keywords`) is the single source for the description. GitHub's description and topics are copied from it, and the Release workflow refuses to stage if GitHub differs.

1. Bump `version` in `package.json`, update `CHANGELOG.md` (move Unreleased under the new version and date), commit as `Release x.y.z`, tag `vx.y.z`, and push the commit and the tag.
2. The Release workflow tests, builds and **stages** the version on npm (trusted publishing, no stored token).
3. The npm account that owns the `extantape` org approves it with 2FA: `npm stage list` then `npm stage approve <id>`. Only then is it public.

The first version of a new package is published by hand by the owner (`npm publish --access public`), because npm can only trust a workflow for a package that exists. Then trust is set for the workflow.

Sessions never publish or approve. This repo is private until the owner makes it public.
