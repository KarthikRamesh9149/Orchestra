# Step 6 checkpoint: implementation in progress

Branch: `codex/desktop-step-6`, based on verified Step 5 commit `243cd1b80c4262c0fc9c2f6e50804a7f744d2394` in private Orchestra/main. Production orchestrav2 remains outside scope.

## Completed foundation

- ADR-005 defines separate local/remote identity, encrypted grants, exact-origin transport, packaged UI and cache boundaries.
- Added strict HTTPS connection descriptors that reject credentials and ambiguous API URLs.
- Added protocol-range and persistent server-ID compatibility validation, to be wired before credentials are sent.
- Added disabled-by-default bounded read-only cache policy contract. No shared cache or remote capability is enabled by this foundation alone.
- Eleven focused regression cases and backend TypeScript validation pass.

## Remaining implementation

1. Server manifest endpoint and protected native remote transport/session lifecycle.
2. Shared workspace onboarding, roles, server indication and isolated renderer state.
3. Versioned self-hosting, TLS/operator bootstrap and provider/email configuration.
4. Authorized export/import with source hashes, provenance, accepted decisions and explicit identity mapping; exclude credentials and unauthorized private chats.
5. Packaged normal/failure/offline journeys, tenant/private-chat isolation, backup/restore and populated upgrades.
6. Actual two-computer role/authority qualification.

The user confirmed on 12 September that only one Mac is available. Two isolated profiles/processes on that Mac can supply development evidence, but do not satisfy item 6. This hardware limitation does not block the remaining implementation and is not permission to weaken the gate. Step 6 is not complete and must not be merged into private main yet.
