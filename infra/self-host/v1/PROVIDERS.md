# Operator-owned email and provider setup

Use dedicated **server** registrations and test accounts. Desktop OAuth grants,
desktop application registrations and managed Orchestra credentials are not
server credentials and must not be copied here. Put string configuration values
in the private `application.json`, then recreate the API and worker. Never put
keys into frontend builds or installer assets.

Callback paths below are relative to the server's exact HTTPS origin and include
the API's `/v1` prefix. Register the exact URI with the provider. Keep browser
origin, frontend origin, TLS certificate and callback host consistent.

| Service | Private configuration | Server callback |
| --- | --- | --- |
| Gmail invitation sender | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | `/v1/oauth/google/callback` |
| Google Drive | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REDIRECT_URI` | `/v1/oauth/google/drive/callback` |
| Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI` | `/v1/oauth/slack/callback` |
| GitHub App | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_CALLBACK_URL`, `GITHUB_APP_SETUP_URL` | `/v1/github/callback` for installation; user linking has its separate `/v1/github/user-link/callback` |

The listed values are configuration, not proof of a working integration. Check
the app's returned readiness/capabilities; never override a failure with an empty
result or call an unconnected provider operational.

## Invitation delivery

An email-bound invitation can be redeemed using its code even when delivery is
`manual_required`. Give that code privately to the intended recipient; do not
say an email was sent. Creating an invitation never verifies the recipient's email.

For automatic delivery, connect an operator-controlled Gmail account to the
intended project with the invitation-sender purpose and `gmail.send` consent.
Enable the Gmail API (`gmail.googleapis.com`) in that registration's Google
Cloud project first. OAuth consent alone does not enable the API; a valid
send-only grant can otherwise receive HTTP 403 when sending an invitation.
In beta mode set `BETA_GMAIL_INVITE_SENDER_ENABLED` to `true` to expose the sender
capability. Verify the OAuth consent really is appropriate before approving it;
do not grant mailbox-reading permission merely to send invitations.

The sender account and tokens stay in the server's encrypted credential vault.
Delivery is confirmed only by a successful Gmail message ID; errors and absent
consent stay `failed` or `manual_required`. Test an invitation to an address the
operator controls, receipt, email-bound redemption, replay rejection, expiry and
revocation before inviting a real team. This repository does not provide a
shared sender, free email service, or founder credentials. SMTP is not implemented.

## Ingestion providers

- **Slack:** start with a dedicated test channel and minimal read permissions.
  Disable private-channel and DM ingestion unless explicitly required. Webhooks
  additionally require `SLACK_SIGNING_SECRET` and the webhook enable flags; do not
  expose an unsigned receiver. Keep write actions disabled.
- **Drive:** select and document the access mode and sync roots. Full-drive access
  is not selected-files access. Configure and validate the Picker separately when
  using selected-files mode. Keep writes and optional webhooks disabled until
  independently configured and tested.
- **GitHub:** explicitly enable `GITHUB_INTEGRATION_ENABLED`, install the server
  app only on selected repositories, and keep `GITHUB_READ_ONLY_MODE=true` and
  `GITHUB_WRITE_ACTIONS_ENABLED=false`. Enable backfill/content scanning only for
  intended sources. Webhooks require their dedicated secret and configuration.

`PROVIDER_RELEASE_VALIDATED_PROVIDERS` applies to the production beta profile;
it is not a substitute for credential validation and is not a universal gate in
the full self-hosted profile. Do not call a provider certified solely because its
name appears in that setting.

## Per-installation acceptance

Record the app registration, server revision, resource selection and test date
without secrets. For each enabled provider verify connect → selected-resource
sync → source/citation → repeated sync without duplicates → offline/retry →
remote revocation and reconnect. Confirm unrelated resources are excluded and
logs contain no tokens. Each operator must qualify their own registrations;
Step 5's local desktop-provider evidence does not certify server registrations.

The 13 September 2026 isolated server test recorded Gmail accepting a real
invitation after API activation, with `sent` persisted in PostgreSQL. This proves
provider acceptance, not inbox receipt or completion of the invitation journey.
Server ingestion-provider certification remains pending; see the Step 6 checkpoint.
