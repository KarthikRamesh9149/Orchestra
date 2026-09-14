# Step 6: shared workspace qualification

Scope: private Orchestra, Mac ARM, one physical Mac. The user explicitly deferred
the two-computer gate. This report does not authorize publication, certify Windows,
or change the managed `orchestrav2` product. Historical implementation evidence is
in STEP-6-CHECKPOINT.md; later entries supersede earlier pending statements.

**Disposition: the authorized single-Mac Step 6 gate is complete.** Two-computer
qualification remains explicitly deferred, not passed. Step 7/public release is
not certified by this disposition.

## Final candidate checks, 13 September 2026

- Backend desktop gate: **1,597 passed, 13 intentionally skipped**. The upstream
  hosted-only exclusions remain documented separately, not passed by implication.
- Frontend: **234 passed**, including three GitHub picker tests and revoked
  connector reconnection. Backend and frontend TypeScript/production builds pass.
- Dependency audits for backend, frontend and VS Code: zero reported vulnerabilities.
  Local static secret scan, reviewed import hashes and structural inventory pass.
  The temporary clean-worktree scan initially rejected dependency directory
  symlinks; excluding only those test dependency links fixed the harness issue.
  The original checkout scan also passed without changing its exclusions.
- Source-built self-host image:
  `sha256:d38a1a87ee6d3ca37f9264ddf12f995d41929908eccb7ba96b5c606bb9af3cf2`.
  Build reused pinned dependency layers, compiled application sources and copied
  only image-built outputs. No host dist mount. API, worker and web booted.
- On that image, **12 real HTTPS/shared-transport checks passed**: protected
  login, workspace switch, persisted rename, exact-byte upload/download,
  email-bound membership, developer denial, private-chat isolation, restored
  grant, refresh rotation, current-session continuity, logout and expired logout.

## Real operator/provider evidence

All data and registrations below are dedicated synthetic qualification material.
Private credentials, invitations, response bodies and keys remain outside Git.

| Boundary | Verified result |
| --- | --- |
| Invitation mail | Real mailbox receipt, received-code redemption, wrong-email and replay rejection, password login and exactly one membership; prior six-check evidence retained. Following Google reconnection, a fresh verification email was accepted by Gmail with `sent`, no error. |
| Drive | One selected synthetic document, real source text/viewer, actual remote token revocation, fresh OAuth, explicit reselection and successful sync. After reconnect/restart: one scanned, zero downloaded/indexed/failed; still one source document. |
| Slack | One selected synthetic public channel; actual revoke, same-scope reauthorization, channel membership restoration and successful sync. Worker-offline queued run later completed with five messages and zero new/indexed/updated revisions. The fifth message was the provider's real rejoin event, not duplicated imported evidence. |
| GitHub | Dedicated read-only app, only private Orchestra selected. Sync and repeat yielded one repo, eight branches, five commits and fourteen evidence items. Remote suspension made sync fail honestly; unsuspension recovered. Project unlink/relink also recovered and preserved fourteen items. Full app uninstall/reinstall and webhooks were not exercised; suspension is the remote access-loss test, not an uninstall claim. |
| Worker outage | Slack and Drive requests remained queued while the worker was stopped, then both completed after restart. Existing crash/lease and full queue-restore proofs remain applicable to unchanged worker code. |
| Source answers | Real authorized document/Slack/GitHub evidence returned through Socrates with citations/open targets. The self-hosted test server deliberately has no generation key: these were clearly labelled deterministic, degraded evidence-only responses, not live-model accuracy or latency certification. |

Private run evidence: GitHub recovery `37849cca-89c2-4aef-a4bf-ea76ebf7baa0`,
unlink/relink `997092d6-c9c8-489f-a4f2-27a0409fc1ab`, Slack restart recovery
`1edaf516-6aab-4714-b088-7a3b95dbc7ae`, and Drive restart recovery
`4a8bf8a6-db8f-4cb0-b565-d6e836b0f7dd`.

## Product corrections

- Revoked connectors can reconnect only through fresh authorization allowed by
  current provider configuration/release policy. Revoked sync stays forbidden.
- Shared GitHub has an explicit repository picker inside the existing card.
  It loads only on request, never auto-selects, validates the persisted link by
  rereading the backend, and reports listing/link/reload errors honestly.
- The packaged test reproduced missing shared-provider transport routes. Added
  only exact reviewed GET/POST/PATCH operations with UUID path bounds. OAuth
  callbacks, token administration, unknown providers and wrong methods remain
  blocked. Local-mode access is unchanged. The new regression failed before the
  fix; all 34 shared transport/contract/route tests then passed.
- No theme, typography, layout redesign, production deployment or paid Actions.

## Retained Step 6 proof and scope boundaries

The checkpoint records fresh self-host installation, separate protected local/
shared identities, role and tenant isolation, compatibility rejection, optional
bounded metadata-only cache, native core export/import with explicit identity
mapping, exact bytes/hashes and accepted decisions, wrong-password/tamper denial,
recoverable orphan quarantine, full PostgreSQL/files/Redis restore and worker
recovery, populated application-version upgrade, and packaged approval/restart
journeys. Those unchanged implementations are not rerun for each provider update.

Transfer remains explicitly **core-only**, not a full workspace export. Caching is
off by default and metadata-only when enabled; no offline shared writes. The
populated upgrade proof is 0.0.3 to 0.0.4 with unchanged schema, not a signed or
interrupted updater proof. Physical sleep and two-machine behavior are not inferred
from controlled native wake events. Step 7 owns signing, broader fault/performance
qualification and updates; Step 8 owns publication.

Operator caveats: use separate Google clients to avoid cross-revocation, restore
Slack app membership after revocation, and renew the short-lived localhost test
certificate after expiry. See infra/self-host/v1/PROVIDERS.md. No production keys
or customer data are bundled or copied.

## Final packaged check

Internal Mac package `14af2f09-b73d-4a3b-8a73-d3e3fe015c5f` passed three real
rendered journeys against the final shared server: protected login/explicit
workspace selection, the GitHub repository picker/link/reload through native
transport, and the real Drive document viewer with the exact seven-reviewer fact.
No page exceptions or simulated API/provider responses. Screenshot and private
evidence: `/private/tmp/orchestra-transfer-ui-FxbIyW/shared-github-final.json`.
The first harness attempted to click a login form after successful session
restoration had already navigated away; the harness now accepts the verified
workspace chooser or performs the real login. A later run exposed the genuine
native route gap above; the final run passed after its tested repair.

Packaging initially encountered stale duplicate generated assets. Those generated
output directories were preserved in ignored backups and replaced with the exact
clean-worktree build outputs. Unrelated source duplicates were not deleted or
committed. The package remains internal/ad-hoc, not a signed public release.
