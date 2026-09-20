# Exact-build notice sidecars

Build scripts emit two files without changing application code:

- `third-party-notices.json`: contributing modules, installed versions, source
  and notice hashes, and hashes of generated chunks/assets.
- `THIRD-PARTY-NOTICES.txt`: exact package notices, component notices and labelled
  README references. A reference is not silently promoted to a complete notice.

The UI sidecars travel with `runtime/ui`; main/preload sidecars travel inside
`app.asar!/dist`. Existing packages must be rebuilt to contain new evidence.

After preparing and packaging the final candidate, inspect its exact directory:

```sh
node scripts/desktop/artifact-notices.mjs '/absolute/path/to/Orchestra Desktop Internal-darwin-arm64'
node scripts/desktop/artifact-notices.mjs '/absolute/path/to/Orchestra Desktop Internal-darwin-arm64' --text
```

These are read-only commands. JSON contains identities, notice locations/hashes,
unresolved backend entries after validated supplements, flattened package maps,
component-review flags, integrity errors and coverage gaps. `--text` emits a
single plain-text aggregation, including the Electron Chromium HTML as inert
text. Save generated audit output outside this supplemental source directory;
otherwise future runtime copies would recursively include old audit reports.

The checker reads only the supplied artifact. It never backfills an old bundle
from this checkout. Hash mismatches set a failing exit code. Missing sidecars and
notice locations remain explicit gaps. `complete` is always false: aggregation
does not certify licensing, generated/native transitive provenance, trademark
rights, signing, public-release permission or clean-machine qualification.

`component-supplements.json` preserves scoped upstream design/vendor notices.
These do not close missing wrapper attribution. `recovered-notices.json` is the
separate package-level recovery register. Unicode mapping-data reproduction and
the current licence's applicability are recorded in `unicode-tr46.json`.

Runtime preparation now stages the exact installed production dependency graph
plus pinned Prisma migration tooling, rather than copying all development
packages. `runtime-dependencies.json` records selected packages, lock/source
metadata hashes, absent optional edges, retained CLI links and Prisma file hashes.
Development source installations are not pruned or modified.

`pdf-notices.json` contains the independently researched PDF component notice
packet. `pdf-standard-fonts-transform.json` pins 28 original metric objects and
six exact unused browser bundles. A separate post-copy step adds one ASCII
attribution field to each object, records original/staged hashes, and omits only
those six bundles. Encodings remain unchanged. `font-attribution-transform.json`
travels with the runtime; the checker verifies the transform, original functional
object hashes, absence of omitted bundles and hashes of all ten PDF component
notices using artifact-owned evidence. This is an explicitly modified staged
package, not a claim of unchanged npm archive contents.

`declaredUnresolved` includes only historical register entries actually present
in the supplied backend. `historicalUnresolvedNotBundled` retains the other
entries without declaring their original licences resolved. Old artifacts remain
unchanged; do not use source-graph removal as proof of a packaged omission.
