import { describe, expect, it } from "vitest";
import {
  assertStagingAtRepositoryHead,
  validateStagingIsolation
} from "../scripts/ops/validate-staging-isolation.js";

describe("isolated staging manifest", () => {
  it("proves the recorded database, services, secrets, data, OAuth, and persistence snapshot is isolated", () => {
    const manifest = validateStagingIsolation();
    expect(manifest.status).toBe("verified");
  });

  it("proves the verified staging database is at the feature candidate migration head", () => {
    expect(assertStagingAtRepositoryHead().contractProof.supabasePendingCanonicalMigrations).toBe(0);
  });
});
