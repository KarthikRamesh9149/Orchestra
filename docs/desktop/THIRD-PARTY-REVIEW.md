# Exact-runtime notice review

Private Mac runtime reviewed 15 September 2026. This records evidence, not legal
advice or clearance to redistribute publicly.

The inventory covers 451 backend package entries. 432 have standalone notices;
isarray 1.0.0 includes its complete MIT notice in README. A bare MIT label or a
README hyperlink was not accepted as a bundled notice. 18 package notice locations
still require resolution. No missing filename is labelled a proven violation.

Pinned npm registry source revisions locate upstream notices for:

| Package | Revision | Upstream notice |
| --- | --- | --- |
| @esbuild/darwin-arm64 0.28.1 | bb9db84c02433fbe37b3509f53f9f3e3cc48725e | evanw/esbuild / LICENSE.md |
| @msgpackr-extract/msgpackr-extract-darwin-arm64 3.0.3 | db8f5b97e7aaab0bcad95f10582915d417153689 | kriszyp/msgpackr-extract / LICENSE |
| @napi-rs/canvas-darwin-arm64 0.1.80 | dda1b258dac667b4c66b94bbd4d70aa79ea4503a | Brooooooklyn/canvas / LICENSE |
| @nodable/entities 2.1.0 | f1c61a65e7b967c17b13822ef71e91bd25f17ce2 | nodable/val-parsers / LICENSE |
| undici-types 5.26.5 | 9197790ae0d015b40b75fd0c5cdb7420704b5272 | nodejs/undici / LICENSE |

The five upstream notices are now preserved byte-for-byte in `third-party/`,
with a package/version/source-revision/hash manifest and regression checks.
Runtime preparation copies this directory to `third-party-notices` in future
packages. Existing already-built packages were not retroactively modified.
This leaves 13 backend package notice locations unresolved. In particular,
native dependencies can carry additional third-party obligations beyond the root
JavaScript package license. Do not close those obligations based on this table.

Remaining packages include AWS credential providers/nested clients, SWC helpers,
Rolldown native bindings, abstract-logging, brotli, dfa, dingbat-to-unicode,
fontkit, stackback, tr46 and xml-naming. Some registry records have no source
revision. The full current list is reproducible with:

```sh
node scripts/desktop/bundled-notices.mjs .desktop/runtime/backend/node_modules
```

PostgreSQL, pgvector, OpenSSL and Node license files are present in the assembled
native runtime. Electron/Chromium, frontend dependencies and native transitive
notices still need an exact-artifact aggregate. Geist attribution is recorded in
the user guide; the current source references Google Fonts rather than bundling
font binaries. The launch video contains no redistributed font files, stock
media, music or external product assets.

Public distribution is deferred. Preserve every existing notice; do not replace
third-party licensing with Orchestra's Apache-2.0 license.

Further source inspection: exact published revisions for brotli, dfa, fontkit,
stackback, tr46 and dingbat-to-unicode did not contain a root software license
file. Fontkit's test-font licenses are not a license for its implementation.
MIT/BSD labels must not be replaced with invented copyright notices. These need
upstream attribution resolution, not another filename-only passing check.
