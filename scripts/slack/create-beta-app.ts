import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type SlackManifestCreateResponse = {
  ok: boolean;
  error?: string;
  app_id?: string;
  credentials?: {
    client_id?: string;
    client_secret?: string;
    signing_secret?: string;
    verification_token?: string;
  };
  oauth_authorize_url?: string;
};

const token = process.env.SLACK_APP_CONFIG_TOKEN;
if (!token) {
  console.error("SLACK_APP_CONFIG_TOKEN is not set. Create the Slack app manually or provide an app configuration token.");
  process.exit(2);
}

const manifestPath = resolve("slack/apps/orchestra-beta/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const body: Record<string, unknown> = { manifest };
if (process.env.SLACK_APP_CREATE_TEAM_ID) {
  body.team_id = process.env.SLACK_APP_CREATE_TEAM_ID;
}

const response = await fetch("https://slack.com/api/apps.manifest.create", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json; charset=utf-8"
  },
  body: JSON.stringify(body)
});

const payload = (await response.json()) as SlackManifestCreateResponse;
if (!response.ok || payload.ok !== true) {
  console.error(`Slack app manifest create failed: ${payload.error ?? response.status}`);
  process.exit(1);
}

console.log("Slack app created.");
console.log(`app_id=${payload.app_id ?? "[not returned]"}`);
console.log(`client_id=${payload.credentials?.client_id ? "[returned]" : "[not returned]"}`);
console.log(`client_secret=${payload.credentials?.client_secret ? "[returned redacted]" : "[not returned]"}`);
console.log(`signing_secret=${payload.credentials?.signing_secret ? "[returned redacted]" : "[not returned]"}`);
console.log(`oauth_authorize_url=${payload.oauth_authorize_url ? "[returned]" : "[not returned]"}`);
