import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { socratesEvalCaseSchema } from "../evals/helpers/schemas.js";

const MVP_TOTAL_MINIMUM = 85;

const MVP_MINIMUMS = {
  mvp_generated_prd_srs_quality: 8,
  mvp_manual_context_retrieval: 8,
  mvp_image_caption_retrieval: 8,
  mvp_coding_requirements_extraction: 10,
  mvp_mermaid_diagram_safety: 10,
  mvp_responsibility_task_qa: 8,
  mvp_socrates_action_suggestions: 10,
  mvp_fireflies_transcript_retrieval: 8,
  mvp_provider_gating: 5,
  mvp_low_evidence_honesty: 10
} as const;

type MvpCategory = keyof typeof MVP_MINIMUMS;

function readJsonl(filePath: string) {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = socratesEvalCaseSchema.safeParse(JSON.parse(line));
      expect(parsed.success, `${filePath}:${index + 1} parses with socratesEvalCaseSchema`).toBe(true);
      if (!parsed.success) {
        throw parsed.error;
      }
      return parsed.data;
    });
}

describe("MVP Socrates eval coverage", () => {
  it("meets category and total minimums, validates cases, and keeps case ids unique", () => {
    const evalDir = path.resolve(process.cwd(), "evals", "socrates");
    const cases = (Object.keys(MVP_MINIMUMS) as MvpCategory[]).flatMap((category) => {
      const filePath = path.join(evalDir, `${category}.jsonl`);
      expect(existsSync(filePath), `${category}.jsonl exists`).toBe(true);
      return readJsonl(filePath);
    });
    const ids = new Set<string>();
    const counts = new Map<MvpCategory, number>();

    for (const testCase of cases) {
      expect(ids.has(testCase.id), `duplicate eval id ${testCase.id}`).toBe(false);
      ids.add(testCase.id);
      expect(testCase.title).toBeTruthy();
      expect(testCase.query).toBeTruthy();
      expect(testCase.setup).toBeTruthy();
      expect(testCase.expectations).toBeTruthy();
      if (testCase.category in MVP_MINIMUMS) {
        const category = testCase.category as MvpCategory;
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }

    for (const [category, minimum] of Object.entries(MVP_MINIMUMS) as Array<[MvpCategory, number]>) {
      expect(counts.get(category) ?? 0, `${category} case count`).toBeGreaterThanOrEqual(minimum);
    }

    const totalMvpCaseCount = cases.length;
    const sumMinimums = Object.values(MVP_MINIMUMS).reduce((sum, minimum) => sum + minimum, 0);

    expect(totalMvpCaseCount, "total MVP Socrates eval case count").toBeGreaterThanOrEqual(MVP_TOTAL_MINIMUM);
    expect(sumMinimums, "sum of MVP category minimums").toBeGreaterThanOrEqual(MVP_TOTAL_MINIMUM);
  });

  it("keeps every MVP eval file wired into the Socrates runner", () => {
    const runner = readFileSync(path.resolve(process.cwd(), "scripts", "run-socrates-evals.ts"), "utf8");

    for (const category of Object.keys(MVP_MINIMUMS)) {
      expect(runner).toContain(`${category}.jsonl`);
    }
  });

  it("keeps docs aligned with the 85-case MVP Socrates eval floor", () => {
    const evalDocs = readFileSync(path.resolve(process.cwd(), "docs", "EVALS.md"), "utf8");
    const docs = [
      path.resolve(process.cwd(), "docs", "EVALS.md"),
      path.resolve(process.cwd(), "docs", "MVP_RELEASE_CHECKLIST.md"),
      path.resolve(process.cwd(), "docs", "MVP_SMOKE.md")
    ];

    for (const docPath of docs) {
      const text = readFileSync(docPath, "utf8");
      expect(text, `${path.basename(docPath)} mentions the MVP eval floor`).toMatch(
        /MVP Socrates eval (?:floor|minimum|release floor)[^\n]*85|85-case MVP Socrates eval floor/i
      );
    }

    for (const [category, minimum] of Object.entries(MVP_MINIMUMS) as Array<[MvpCategory, number]>) {
      expect(evalDocs, `EVALS.md lists ${category} minimum ${minimum}`).toContain(`| \`${category}\` | ${minimum} |`);
    }
  });
});
