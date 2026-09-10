import { defineConfig } from "vitest/config";

// These source-retained tests assert the old repository's deployment evidence,
// credentials templates, CI workflows or documentation. They are NOT desktop
// application certification. `npm test` deliberately still runs the upstream suite.
// See docs/desktop/upstream-checks.json for the explicit scope and replacement gate.
import checks from "./docs/desktop/upstream-checks.json" with { type: "json" };

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: checks.tests.map((entry) => entry.file),
  },
});
