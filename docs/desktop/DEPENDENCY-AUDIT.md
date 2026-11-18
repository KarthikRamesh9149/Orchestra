# Full desktop dependency audit

Run `npm run audit:all` on a clean locked install. It checks the backend,
Electron, frontend, and VS Code extension, including development tools. The
GitHub source workflow runs those same checks independently. None of these
gates suppresses advisories.

The affected build tools import Picomatch by name. For
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), no
fixed registry release was available. Their imports now resolve to
`scripts/desktop/tooling-glob`, a first-party adapter that uses the
nonrecursive matcher in Minimatch 11. It contains no Picomatch matching
code. The VS Code packaging tool also uses Minimatch 11 for
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).

This is a compatibility layer for the locked toolchain, not a general
Picomatch implementation or a product runtime dependency. Keep the native
package and extension archives free of build-tool dependencies. On updates,
check tool API compatibility, the test discovery and file-deny regressions,
the frontend build, and the extension's packaged file list. Remove the
adapter and its install configuration when patched upstream dependencies are
available and pass those checks.
