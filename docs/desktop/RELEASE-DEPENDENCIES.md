# Rights, ownership and external release dependencies

No signing credentials, provider approvals, Windows test hardware or legal ownership have been inferred from repository access.

| Dependency | Accountable role | Availability / gate |
| --- | --- | --- |
| First-party source ownership and Apache-2.0 approval | Karthik Ramesh, repository owner | Unconfirmed; proposed only. Blocks applying license/publication |
| Third-party dependency and transitive license review | Implementer prepares inventory; owner approves rights exceptions | Lockfile metadata inventory required; full bundled notices and binaries checked again in Steps 3/7/8 |
| Existing visual assets/fonts/icon rights | Owner confirms origin; implementer records notices | Unconfirmed; omitted binary assets cannot be treated as cleared |
| Mac Apple Silicon development | Current local Mac | Host available; clean-machine independent qualification not yet provided |
| Windows x64 machine and independent tester | Owner nominates tester | Explicitly deferred by the user; current development is Mac-only. Windows cannot be advertised or released until independently qualified |
| Mac developer signing/notarization credentials | Owner | Not confirmed; blocks signed release; no purchase authorized |
| Windows signing credentials | Owner | Not confirmed; blocks signed release; no purchase authorized |
| GitHub native authorization registration | Owner/provider administrator | Separate desktop App verified with selected desktop repository and real lifecycle; public enrollment remains a release gate |
| Google Drive desktop OAuth registration and scopes | Owner/provider administrator | Separate testing project and user-owned Desktop registration verified with selected synthetic file; public OAuth enrollment not certified |
| Slack supported authorization or self-hostable bridge | Owner/provider administrator | Separate desktop App and authorized public-channel grant, synthetic ingestion and lifecycle verified; no callback bridge needed |
| External AI test account and bounded usage | Owner supplies authorized configuration | Dedicated authorized desktop key and bounded real OpenAI checks verified; no copied hosted secret |
| Codex and VS Code qualification | Implementer + independent platform tester | Real installed clients verified with disposable scoped settings. Claude/Cursor explicitly deferred |
| Shared server/TLS/email and two-machine validation | Self-host operator + tester | Not provisioned; Step 6 responsibility, no existing production changes |
| Support/recovery and publication approval | Karthik Ramesh or named delegate | Delegate not assigned; explicit Step 8 approval required |

## Attribution

Imported from `KarthikRamesh9149/orchestrav2`, revision `8561d41980e97924db33e0c8f748b7cf576aac83`. Git history was not imported. Preserve source copyright comments and third-party notices. No root LICENSE/NOTICE file was present in the source tree; absence is not evidence of permission to redistribute. Source access is not an ownership determination.

The import manifest records excluded internal material without copying its contents. Dependency metadata is descriptive, not legal approval. Publication remains blocked until required rights and notices are resolved.
