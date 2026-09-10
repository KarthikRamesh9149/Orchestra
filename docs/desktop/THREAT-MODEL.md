# Desktop threat model and data flows

Status: design baseline, not a completed security audit.

## Flows and trust boundaries

1. User selects files/repositories or provider resources → native bridge/provider adapter → authenticated backend → private source storage → parser/index worker → PostgreSQL evidence index.
2. UI question → authenticated service → actor/project-authorized retrieval → optional external AI with selected evidence → citation validation → persisted conversation → streamed UI.
3. Evidence → interpretation → proposal → explicit authorized human decision → transactional Product Brain/Live Doc update. Agent output cannot skip review.
4. Preflight creates a scoped context pack → separately authenticated MCP client retrieves exact pack ID → agent records Postflight linked to that pack → human reviews implementation evidence.
5. Shared mode uses TLS to one explicit server. The renderer cannot carry local credentials into shared mode or accept cached permissions for a shared approval.
6. Backup/export → explicit authorization → encrypted backup or scoped portable export → validated restore/import with identity mapping. Secrets are never exported as project context.

## Risks, controls and required verification

| Boundary/risk | Control requirement | Owner step / acceptance |
| --- | --- | --- |
| Renderer XSS → host execution | sandbox, context isolation, no Node, validated narrow IPC, trusted packaged assets | 3/7: malicious renderer cannot read arbitrary files, execute commands or fetch with runtime authority |
| Hostile local process → loopback API | installation secret, authenticated API, safe bind/origin handling, no unauthenticated bootstrap | 2/3/7: foreign origin/process requests denied; do not claim defense against a fully compromised OS account |
| Imported files → parser exploitation | traversal/symlink bounds, parser resource limits, private atomic writes | 2/5/7: zip bombs, oversized input, path escape, disk-full and crash tests |
| Worker crash → duplicate effects | atomic claims, ownership leases, fencing, heartbeat, bounded retries/cancellation | 2/7: kill after durable claim, reclaim safely, reject stale worker completion |
| Local secret exposure | OS-protected storage; no renderer persistence, logs, bundles or context-pack secrets | 3/5/7: denied vault access, log scans, revoke and key-rotation tests |
| Prompt injection → false truth/data leak | untrusted source separation, scoped retrieval, citation validation, explicit approval | 4/5/7: cross-project/private data and injected-tool-action tests |
| Shared tenant/role bypass | server authority, separate identities/cache namespaces, compatibility checks | 6/7: two-user/two-server isolation, revoked access, offline expiry |
| Provider credentials in installer | supported native OAuth or disclosed self-hostable bridge; no confidential shared installer secret | 5/7: authorization, scope, reconnect, revoke and package scan |
| Model change corrupts retrieval | record identity/dimensions, transactional reindex state, honest unavailable status | 5: embedding transition and interrupted reindex tests |
| Update or backup tampering | signed/verifiable artifacts, migration-aware recovery, authenticated encrypted backups | 6/7: tamper rejection, interrupted update, populated restore; no unsafe schema downgrade promise |
| Accidental hosted production access | no inherited deployment workflows/configuration; explicit runtime profiles and server selection | 1–3: source/deployment boundary checks; never use staging flag as a local bypass |

Release Step 7 must test these controls against actual packaged binaries. This table is not evidence that the controls already exist.
