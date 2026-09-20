# Exact-runtime notice review

## Current result, 20 September 2026

The revised candidate removes the four PDFKit/fontkit attribution blockers by
replacing the report adapter with pinned `pdf-lib` standard fonts, and excludes
development-only `stackback` through explicit runtime dependency staging. The
final installed/lock graph selects 343 packages and excludes 109 lock entries;
none of the five historical blockers is selected. The final rebuilt artifact also
passed exact notice/hash checks and fresh packaged-runtime migration/restart/crash
recovery; see [the readiness follow-up](READINESS-FOLLOWUP-2026-09-20.md).
This is technical attribution evidence, not permission to redistribute publicly.
The original packages and their unresolved historical attribution register are
not retroactively changed or declared licensed.

Four notices have been recovered across the two review passes; their hashes, sources and limits are recorded in
[`third-party/recovered-notices.json`](third-party/recovered-notices.json).

- **xml-naming 0.1.0:** resolved the missing software notice using revision
  `c0afc395948730bed124859d7fc7cccabe0aac8a`. Its package version matches and both
  published `src` files match byte for byte. The repository contains the MIT
  notice omitted by the package's `files` selection.
- **abstract-logging 2.0.1:** recovered the author-maintained notice explicitly
  linked by its published README. The captured HTML is stored as inert `.txt`.
  Its dynamic 2026 copyright year is preserved, not misrepresented as the
  package's release year.
- **dingbat-to-unicode 1.0.1:** the repository owner [explicitly applied the
  new 1.0.2 licence to previous versions](https://github.com/mwilliamson/dingbat-to-unicode/issues/1#issuecomment-5740760399)
  on 19 September. The exact BSD-2-Clause text at revision
  `9eb2d1d8b8463b7bd3cd125597eabcfa9df42128` is retained without upgrading 1.0.1.
- **tr46 0.0.3:** author Sebmaster's [license-only commit](https://github.com/jsdom/tr46/commit/3a6f29721e7063b9ffd421e461a54beae6170001)
  directly parents the npm release's `a8009f9` revision. No implementation changed;
  version 0.0.3, installed `index.js` and `package.json` match exactly. This is not
  an assumption that an unrelated newer release's licence applies retroactively.
  The generated mapping table was separately reproduced byte-for-byte from
  Unicode 8.0.0; `unicode-tr46.json` pins both hashes and `unicode-tr46.txt`
  preserves its original data copyright and the current linked Unicode notice.
- **Brotli:** the decoder source contains Google Apache-2.0 notices despite the
  root MIT metadata. These existing source notices must remain intact; a root
  MIT label cannot clear all bundled-code obligations.
  The exact vendored Google Brotli submodule's full MIT notice is additionally
  retained in `brotli-vendored.txt`. This does not resolve the wrapper or the
  unpinned Emscripten toolchain that generated the encoder.
- **stackback:** `formatstack.js` contains a full V8/Google BSD-style notice.
  Preserve it for source and binary distributions. It does not resolve the
  separate missing MIT attribution for the rest of this package.

The five historical packages are @swc/helpers, brotli, dfa, fontkit and stackback
at the versions listed below. Their own missing notices remain unresolved;
removing them from a new, tested artifact is distinct from recovering those notices.
Only dingbat-to-unicode has a newly obtained owner clarification. The PDF adapter
replacement and staged dependency selection were explicitly authorised. No
licence was invented, and this is not public-release clearance.

The native preparation script copies the entire supplemental notice directory;
these additions therefore enter future prepared runtimes. Existing packages
must be rebuilt before claiming that they contain the recovered files.

## Earlier review history (counts below describe the prior checkpoint)

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
The Rolldown 1.2.4 native binding now also has its root MIT notice and upstream
Rollup/esbuild notices from the exact release revision
483c64833c0fb0d1b75f1339accf781c0a09b335. The third-party text has one terminal
newline added, explicitly recorded in the manifest; no terms were changed.
Three AWS packages now reference the pinned AWS repository-root Apache-2.0
notice, whose Amazon copyright attribution is retained. Their published package
metadata identifies that repository and Apache-2.0. The manifest explicitly
distinguishes this repository-root notice from a recovered package-specific
file; it does not claim a package source commit was supplied by npm.
This leaves 9 backend package notice locations unresolved. In particular,
native dependencies can carry additional third-party obligations beyond the root
JavaScript package license. Do not close those obligations based on this table.

Remaining packages include SWC helpers,
abstract-logging, brotli, dfa, dingbat-to-unicode,
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

## Historical package blocker register, 20 September

| Package | Review result / required resolution |
| --- | --- |
| @swc/helpers 0.3.17 | Published metadata says MIT. Owner-authored PR 6690 changed a later helper package to Apache-2.0 and added a license, but did not explicitly settle older MIT-labelled versions. Do not apply that correction retrospectively without evidence; qualify an upgrade instead. |
| brotli 1.3.3 | Reviewed published source revision lacks a root implementation license file; requires upstream notice resolution. |
| dfa 1.2.0 | MIT label/README statement is not a complete bundled attribution; requires upstream notice resolution. |
| fontkit 1.9.0 | Test-font licenses do not resolve implementation attribution; requires the software notice. |
| stackback 0.0.2 | Published revision lacks the complete notice; preserve existing metadata pending upstream resolution. |

All twelve previously open locations have been examined. Seven now have documented
notice evidence and five retain unresolved historical attribution, not unexamined
files or certified violations. The recovered-notices manifest preserves that
register. The exact-artifact checker separately reports which entries are actually
bundled and which are absent. Earlier counts above describe their checkpoints.

Existing upstream requests were rechecked on 20 September:

- [fontkit missing implementation notice](https://github.com/foliojs/fontkit/issues/255)
- [dfa missing notice](https://github.com/foliojs/dfa/issues/3)
- [Brotli generated encoder provenance and notices](https://github.com/foliojs/brotli.js/issues/57)
- [dingbat-to-unicode exact-version notice request](https://github.com/mwilliamson/dingbat-to-unicode/issues/1): now resolved by the owner clarification above.
- [SWC helper licence correction](https://github.com/swc-project/swc/pull/6690): a real later correction, not exact-0.3.17 closure.

Third-party issue comments are not a substitute for an applicable owner-provided
notice. No duplicate public requests were posted. The later candidate replacement
does not alter the historical findings or relicense any dependency.

The component-level notices already embedded in Brotli's decoder and stackback's
V8-derived formatter are additionally preserved in `third-party/component-notices.txt`.
They do not license the rest of either package. A regression test compares those
extracts with installed source headers, or verifies removal from the lock when
the package is no longer installed. It rejects a claim that the component notices
close either package's wrapper-level attribution gap.

## Revised PDF and runtime dependency candidate

The pinned renderer closure is `pdf-lib` 1.17.1, `@pdf-lib/standard-fonts` 1.0.0,
`@pdf-lib/upng` 1.0.1, `pako` 1.0.11 and nested `tslib` 1.14.1. It does not load
custom fonts or add a fontkit dependency. `pdf-notices.json` preserves ten component
notices covering Adobe Core14 metrics, the original font copyright lines, Unicode
encoding inputs, the original AFM converter, historical PDFKit code/data,
base64-arraybuffer and zlib. Published wrapper licences remain in their packages.
Exact archive/source/data identities and applicability limits are recorded; later
upstream licences are not guessed to cover unrelated older versions.

Adobe's unchanged permission requires modifications to be prominently noted in
modified files. The separate `font-attribution.mjs` post-copy step therefore adds
one ASCII `_orchestraAttribution` field, first in each of 28 decoded metric objects.
It requires pinned original compressed/inflated hashes, retains every original
field and `Notice`, and records staged hashes. Removing the added field reproduces
the original inflated JSON bytes. Two standard-fonts UMD files and four pdf-lib
browser bundles duplicate those metric payloads; only these six exact hashed,
unused outputs are omitted from staging. Checked Node/CJS/ESM entrypoints remain.
The two encoding files are pinned and retained unchanged. Source `node_modules`
and historical artifacts are never normalized or pruned.

`runtime-dependencies.mjs` copies the installed lock-identified production graph,
present optional/peer dependencies and explicitly pinned Prisma 6.6.0 CLI/client/
engines. It retains generated client/schema/native artifacts, verifies staged
resolution without falling back to the source tree, and retains only contained
CLI links whose targets were selected. No install, version resolution or global
prune is performed. `runtime-dependencies.json` records the selected/excluded graph;
`font-attribution-transform.json` records the separate, deliberately modified
package files. Neither report claims the transformed tree is an unchanged archive.

Focused tests verify original hashes, deterministic staging, all glyph widths and
kerning pairs through Node and ESM consumers, the actual staged report renderer
and PDF text extraction, and rejection of changed functional data or reintroduced
bundles. These are engineering attribution and regression checks, not legal advice.

## Exact artifact aggregation

The new build-only hooks emit `third-party-notices.json` and
`THIRD-PARTY-NOTICES.txt` alongside frontend assets and desktop main/preload
bundles. They identify modules that contributed output bytes, exact installed
package versions, source hashes, actual notice text and generated output hashes.
The desktop files are included under `app.asar!/dist`; UI files are copied under
`runtime/ui`. They do not run in the application or change chunk code.

`scripts/desktop/artifact-notices.mjs` checks one exact packaged directory:
backend package notices, hash-validated supplemental notices, Node/PostgreSQL/
pgvector/OpenSSL notices, Electron/Chromium notices, and both flattened build
sidecars. It rejects stale output/notice hashes and preserves gaps on old
artifacts; it never substitutes current checkout notices for missing artifact
files. See [the operating notes](third-party/BUNDLE-NOTICES.md).

The rendered react-icons families `tb`, `bi` and `si` have supplemental design
notices pinned by the v5.6.0 upstream build configuration, not its stale published
README version table. Avataaars' existing package notice preserves Pablo Stanley's
design attribution separately from DiceBear code's MIT notice. Component review
flags remain explicit; copyright notice presence is not trademark clearance.
