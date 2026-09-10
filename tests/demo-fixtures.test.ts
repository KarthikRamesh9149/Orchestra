import { describe, expect, it } from "vitest";
import { assertDemoFixturesAllowed, notionTeamsDemoFixtureManifest } from "../src/lib/demo-fixtures/guard.js";

describe("demo fixture guard", () => {
  it("allows explicit local test fixtures for Notion and Teams demos", () => {
    expect(() =>
      assertDemoFixturesAllowed({
        DEMO_FIXTURES_ENABLED: true,
        DEMO_FIXTURE_MODE: "test",
        DEPLOYMENT_ENV: "test"
      })
    ).not.toThrow();
    expect(notionTeamsDemoFixtureManifest()).toMatchObject({
      providers: ["notion", "microsoft_teams"],
      surfaces: ["project_memory", "socrates", "timeline", "dashboard", "suggestions"],
      productionSafe: false
    });
    expect(notionTeamsDemoFixtureManifest().resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "notion", resourceType: "page" }),
        expect.objectContaining({ provider: "notion", resourceType: "database" }),
        expect.objectContaining({ provider: "microsoft_teams", resourceType: "thread" })
      ])
    );
  });

  it("blocks disabled, invalid, and production fixture modes", () => {
    expect(() => assertDemoFixturesAllowed({ DEMO_FIXTURES_ENABLED: false, DEMO_FIXTURE_MODE: "test", DEPLOYMENT_ENV: "test" }))
      .toThrow(/Demo fixtures are disabled/);
    expect(() => assertDemoFixturesAllowed({ DEMO_FIXTURES_ENABLED: true, DEMO_FIXTURE_MODE: "pilot", DEPLOYMENT_ENV: "test" }))
      .toThrow(/mode must be/);
    expect(() => assertDemoFixturesAllowed({ DEMO_FIXTURES_ENABLED: true, DEMO_FIXTURE_MODE: "smoke", DEPLOYMENT_ENV: "production" }))
      .toThrow(/blocked/);
  });
});
