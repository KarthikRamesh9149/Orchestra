# Exact-runtime notice review

## Current result, 16 September 2026

Seven attribution blockers remain. Two additional notices were recovered in this
pass; their hashes, sources and limits are recorded in
[`third-party/recovered-notices.json`](third-party/recovered-notices.json).

- **xml-naming 0.1.0:** resolved the missing software notice using revision
  `c0afc395948730bed124859d7fc7cccabe0aac8a`. Its package version matches and both
  published `src` files match byte for byte. The repository contains the MIT
  notice omitted by the package's `files` selection.
- **abstract-logging 2.0.1:** recovered the author-maintained notice explicitly
  linked by its published README. The captured HTML is stored as inert `.txt`.
  Its dynamic 2026 copyright year is preserved, not misrepresented as the
  package's release year.
- **Brotli:** the decoder source contains Google Apache-2.0 notices despite the
  root MIT metadata. These existing source notices must remain intact; a root
  MIT label cannot clear all bundled-code obligations.
- **stackback:** `formatstack.js` contains a full V8/Google BSD-style notice.
  Preserve it for source and binary distributions. It does not resolve the
  separate missing MIT attribution for the rest of this package.

The remaining seven are @swc/helpers, brotli, dfa, dingbat-to-unicode, fontkit,
stackback and tr46 at the versions listed below. Closing them requires applicable
upstream notice/clarification or an independently tested dependency replacement.
No maintainer clarification was obtained. No dependency was silently replaced,
feature removed, or license invented. This is not public-release clearance.

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

## Remaining attribution blockers, 16 September

| Package | Review result / required resolution |
| --- | --- |
| @swc/helpers 0.3.17 | Published metadata says MIT, while the inspected SWC v1.2.192 root LICENSE is Apache-2.0. Do not silently apply the root license to this older helper package. Obtain the version's applicable notice or separately qualify an upgrade. |
| abstract-logging 2.0.1 | Published README points to jsumners.mit-license.org; the linked notice could not be retrieved. Preserve the pointer, but do not fabricate its copyright year/text. |
| brotli 1.3.3 | Reviewed published source revision lacks a root implementation license file; requires upstream notice resolution. |
| dfa 1.2.0 | MIT label/README statement is not a complete bundled attribution; requires upstream notice resolution. |
| dingbat-to-unicode 1.0.1 | BSD-2-Clause metadata exists but the reviewed release tree lacks its copyright-bearing license text. |
| fontkit 1.9.0 | Test-font licenses do not resolve implementation attribution; requires the software notice. |
| stackback 0.0.2 | Published revision lacks the complete notice; preserve existing metadata pending upstream resolution. |
| tr46 0.0.3 | Published revision lacks the complete notice; a newer release's notice is not automatically proof for this version. |
| xml-naming 0.1.0 | Metadata declares MIT but has no registry source revision or complete root notice; establish applicable upstream attribution. |

All twelve previously open locations have now been examined. Three have a
documented repository-root notice; nine remain attribution blockers, not
unexamined files or certified violations. No dependencies were removed, updated
or relicensed to make this review appear complete. No maintainer has been
contacted and no public issue has been posted.
