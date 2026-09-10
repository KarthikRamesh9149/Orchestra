import { AppError } from "../../app/errors.js";

export type DemoFixtureMode = "test" | "smoke" | "dev_seed";

export type DemoFixtureEnv = {
  DEMO_FIXTURES_ENABLED?: boolean;
  DEMO_FIXTURE_MODE?: DemoFixtureMode | string | null;
  DEPLOYMENT_ENV?: string | null;
  NODE_ENV?: string | null;
};

const allowedModes = new Set<DemoFixtureMode>(["test", "smoke", "dev_seed"]);

export function assertDemoFixturesAllowed(env: DemoFixtureEnv) {
  const deploymentEnv = env.DEPLOYMENT_ENV ?? env.NODE_ENV ?? "development";
  if (!env.DEMO_FIXTURES_ENABLED) {
    throw new AppError(403, "Demo fixtures are disabled", "demo_fixtures_disabled");
  }
  if (deploymentEnv === "production" || deploymentEnv === "staging") {
    throw new AppError(403, "Demo fixtures are blocked outside local/test/smoke environments", "demo_fixtures_blocked");
  }
  if (!allowedModes.has(env.DEMO_FIXTURE_MODE as DemoFixtureMode)) {
    throw new AppError(400, "Demo fixture mode must be test, smoke, or dev_seed", "demo_fixture_mode_invalid");
  }
}

export function notionTeamsDemoFixtureManifest() {
  return {
    name: "notion-teams-product-intelligence",
    productionSafe: false,
    providers: ["notion", "microsoft_teams"] as const,
    resources: [
      { provider: "notion", resourceId: "demo-notion-prd-page", resourceType: "page" },
      { provider: "notion", resourceId: "demo-notion-architecture-page", resourceType: "page" },
      { provider: "notion", resourceId: "demo-notion-feature-decision-page", resourceType: "page" },
      { provider: "notion", resourceId: "demo-notion-customer-request-database", resourceType: "database" },
      { provider: "notion", resourceId: "demo-notion-livedoc-contradiction-page", resourceType: "page" },
      { provider: "microsoft_teams", resourceId: "demo-teams-blocked-thread", resourceType: "thread" },
      { provider: "microsoft_teams", resourceId: "demo-teams-client-approval-thread", resourceType: "thread" },
      { provider: "microsoft_teams", resourceId: "demo-teams-brainstorming-no-proposal-thread", resourceType: "thread" },
      { provider: "microsoft_teams", resourceId: "demo-teams-requirement-change-thread", resourceType: "thread" },
      { provider: "microsoft_teams", resourceId: "demo-teams-action-item-missing-timeline-thread", resourceType: "thread" }
    ],
    surfaces: ["project_memory", "socrates", "timeline", "dashboard", "suggestions"] as const
  };
}
