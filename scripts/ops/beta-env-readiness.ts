import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

type CheckStatus = "passed" | "warning" | "failed";

interface EnvCheck {
  name: string;
  status: CheckStatus;
  message: string;
}

const secretPlaceholders = [
  "replace",
  "placeholder",
  "change_me",
  "changeme",
  "example",
  "password",
  "secret",
  "dev_",
  "local"
];

const disabledProviderFlags = [
  "CLICKUP_CONNECTOR_ENABLED",
  "FIREFLIES_CONNECTOR_ENABLED",
  "GRANOLA_CONNECTOR_ENABLED",
  "MICROSOFT_TEAMS_CONNECTOR_ENABLED"
];

const args = parseArgs(process.argv.slice(2));
if (args.envFile) {
  if (!existsSync(args.envFile)) {
    console.error(`Env file not found: ${args.envFile}`);
    process.exit(1);
  }
  loadEnv({ path: args.envFile, override: true });
} else {
  loadEnv();
}

const checks = runChecks(process.env);
const status: CheckStatus = checks.some((check) => check.status === "failed")
  ? "failed"
  : checks.some((check) => check.status === "warning")
    ? "warning"
    : "passed";

const report = {
  ok: status === "passed",
  status,
  envFile: args.envFile ? "provided" : "process",
  secretsPrinted: false,
  checks
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Beta env readiness: ${status}`);
  for (const check of checks) {
    console.log(`- ${check.status.toUpperCase()}: ${check.name} - ${check.message}`);
  }
}

if (status === "failed") {
  process.exitCode = 1;
}

function parseArgs(argv: string[]) {
  return {
    json: argv.includes("--json"),
    envFile: argv.find((arg) => arg.startsWith("--env-file="))?.slice("--env-file=".length)
  };
}

function runChecks(env: NodeJS.ProcessEnv): EnvCheck[] {
  const checks: EnvCheck[] = [];
  const add = (name: string, condition: unknown, message: string, failedMessage = message) => {
    checks.push({ name, status: condition ? "passed" : "failed", message: condition ? message : failedMessage });
  };
  const warn = (name: string, condition: unknown, message: string, warningMessage = message) => {
    checks.push({ name, status: condition ? "passed" : "warning", message: condition ? message : warningMessage });
  };

  add("ORCHESTRA_PROFILE", env.ORCHESTRA_PROFILE === "mvp_beta", "mvp_beta profile is set", "set ORCHESTRA_PROFILE=mvp_beta");
  add("MVP_BETA_MODE", env.MVP_BETA_MODE === "true", "MVP_BETA_MODE is true", "set MVP_BETA_MODE=true");
  add("NODE_ENV", env.NODE_ENV === "production", "NODE_ENV is production", "set NODE_ENV=production; use DEPLOYMENT_ENV=staging for staging");
  add(
    "DEPLOYMENT_ENV",
    env.DEPLOYMENT_ENV === "staging" || env.DEPLOYMENT_ENV === "production",
    "DEPLOYMENT_ENV is staging or production",
    "set DEPLOYMENT_ENV=staging or DEPLOYMENT_ENV=production"
  );

  for (const key of ["APP_BASE_URL", "FRONTEND_BASE_URL"] as const) {
    add(`${key} https`, isHttpsNonPlaceholderUrl(env[key]), `${key} is a non-placeholder HTTPS URL`, `${key} must be a real HTTPS URL`);
  }
  add(
    "CORS_ALLOWED_ORIGINS",
    corsMatchesFrontend(env.CORS_ALLOWED_ORIGINS, env.FRONTEND_BASE_URL),
    "CORS allows the beta frontend origin",
    "CORS_ALLOWED_ORIGINS must include FRONTEND_BASE_URL and must not contain '*'"
  );

  add("DATABASE_URL", isPostgresUrl(env.DATABASE_URL), "DATABASE_URL is present", "DATABASE_URL must be the real Supabase pooled/runtime URL");
  warn("DIRECT_URL", isPostgresUrl(env.DIRECT_URL), "DIRECT_URL is present", "DIRECT_URL is recommended for direct migration connections");

  add("JWT_ACCESS_SECRET", isStrongSecret(env.JWT_ACCESS_SECRET), "JWT_ACCESS_SECRET is strong", "JWT_ACCESS_SECRET must be unique, non-placeholder, and at least 32 chars");
  add("JWT_REFRESH_SECRET", isStrongSecret(env.JWT_REFRESH_SECRET), "JWT_REFRESH_SECRET is strong", "JWT_REFRESH_SECRET must be unique, non-placeholder, and at least 32 chars");
  add(
    "VSCODE_CONNECTOR_TOKEN_SECRET",
    isStrongSecret(env.VSCODE_CONNECTOR_TOKEN_SECRET),
    "VSCODE_CONNECTOR_TOKEN_SECRET is strong",
    "VSCODE_CONNECTOR_TOKEN_SECRET must be unique, non-placeholder, and at least 32 chars"
  );
  add(
    "secret separation",
    areDistinct([env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET, env.VSCODE_CONNECTOR_TOKEN_SECRET]),
    "JWT and VS Code connector secrets are distinct",
    "JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, and VSCODE_CONNECTOR_TOKEN_SECRET must all be different"
  );

  const storageDriver = env.STORAGE_DRIVER;
  const isProductionDeployment = env.DEPLOYMENT_ENV === "production";
  const isApprovedFreeTierBeta =
    isProductionDeployment &&
    env.ORCHESTRA_PROFILE === "mvp_beta" &&
    env.MVP_BETA_MODE === "true" &&
    env.MVP_BETA_FREE_TIER_MODE === "true";
  const hasRailwayVolumeStorage =
    storageDriver === "local" &&
    isPathInside(env.RAILWAY_VOLUME_MOUNT_PATH, env.STORAGE_LOCAL_ROOT);

  if (isProductionDeployment) {
    add(
      "STORAGE_DRIVER",
      storageDriver === "s3" || (isApprovedFreeTierBeta && hasRailwayVolumeStorage),
      storageDriver === "s3"
        ? "durable S3-compatible storage is selected"
        : "approved free-tier beta storage resolves inside the Railway persistent volume",
      "set STORAGE_DRIVER=s3, or use the explicitly approved free-tier beta profile with volume-contained local storage"
    );
  } else {
    add(
      "STORAGE_DRIVER",
      storageDriver === "s3" || hasRailwayVolumeStorage,
      storageDriver === "s3" ? "durable S3-compatible storage is selected" : "Railway volume-backed local storage is configured for private beta",
      "set STORAGE_DRIVER=s3 or configure RAILWAY_VOLUME_MOUNT_PATH plus STORAGE_LOCAL_ROOT for private-beta staging"
    );
  }
  if (env.STORAGE_DRIVER === "s3") {
    for (const key of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      add(`${key}`, isSet(env[key]) && !isPlaceholder(env[key]), `${key} is set`, `${key} is required when STORAGE_DRIVER=s3 and cannot be a placeholder`);
    }
  }

  add(
    "OpenAI provider",
    isProviderKeySet(env.OPENAI_API_KEY),
    "OPENAI_API_KEY is set for beta generation and embeddings",
    "set OPENAI_API_KEY"
  );

  add("SLACK_CONNECTOR_ENABLED", env.SLACK_CONNECTOR_ENABLED === "true", "SLACK_CONNECTOR_ENABLED=true", "SLACK_CONNECTOR_ENABLED must be true for beta Slack integration");

  for (const key of disabledProviderFlags) {
    add(key, env[key] === "false", `${key}=false`, `${key} must be false for beta scope`);
  }

  warn(
    "live beta HTTP smoke env",
    isHttpsNonPlaceholderUrl(env.BETA_SMOKE_BASE_URL)
      && ((isSet(env.BETA_SMOKE_MANAGER_EMAIL) && isSet(env.BETA_SMOKE_MANAGER_PASSWORD)) || isTrue(env.BETA_SMOKE_ALLOW_SIGNUP)),
    "live beta HTTP smoke env is present",
    "set BETA_SMOKE_BASE_URL plus either BETA_SMOKE_MANAGER_EMAIL/BETA_SMOKE_MANAGER_PASSWORD or BETA_SMOKE_ALLOW_SIGNUP=true before launch proof"
  );

  return checks;
}

function isSet(value: string | undefined) {
  return Boolean(value?.trim());
}

function isPathInside(parentPath: string | undefined, candidatePath: string | undefined) {
  if (!parentPath || !candidatePath || !path.isAbsolute(parentPath)) return false;
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isProviderKeySet(value: string | undefined) {
  return isSet(value) && !isPlaceholder(value);
}

function isPostgresUrl(value: string | undefined) {
  if (!value) return false;
  return /^postgres(?:ql)?:\/\//i.test(value.trim()) && !isPlaceholder(value);
}

function isHttpsNonPlaceholderUrl(value: string | undefined) {
  if (!value || isPlaceholder(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function corsMatchesFrontend(cors: string | undefined, frontend: string | undefined) {
  if (!cors || !frontend || cors.includes("*")) return false;
  return cors.split(",").map((item) => item.trim()).includes(frontend.trim());
}

function isStrongSecret(value: string | undefined) {
  return Boolean(value && value.length >= 32 && !isPlaceholder(value));
}

function isPlaceholder(value: string | undefined) {
  const normalized = value?.toLowerCase() ?? "";
  return secretPlaceholders.some((placeholder) => normalized.includes(placeholder));
}

function areDistinct(values: Array<string | undefined>) {
  if (values.some((value) => !value)) return false;
  return new Set(values).size === values.length;
}

function isTrue(value: string | undefined) {
  return ["1", "true", "yes", "y", "on"].includes(value?.trim().toLowerCase() ?? "");
}
