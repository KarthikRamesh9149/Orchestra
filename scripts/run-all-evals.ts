import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function run(scriptPath: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", scriptPath], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptPath} exited with ${code}`));
      }
    });
  });
}

async function main() {
  await run("scripts/run-socrates-evals.ts");
  await run("scripts/run-message-intelligence-evals.ts");
  await run("scripts/run-agent-files-evals.ts");
  await run("scripts/run-github-integration-evals.ts");
  await run("scripts/run-engineering-evidence-evals.ts");
  await run("scripts/run-fde-readiness-evals.ts");

  const socrates = JSON.parse(await readFile(path.resolve("evals", "outputs", "socrates-report.json"), "utf8"));
  const messages = JSON.parse(await readFile(path.resolve("evals", "outputs", "message-intelligence-report.json"), "utf8"));
  const agentFiles = JSON.parse(await readFile(path.resolve("evals", "outputs", "agent-files-report.json"), "utf8"));
  const githubIntegration = JSON.parse(
    await readFile(path.resolve("evals", "outputs", "github-integration-report.json"), "utf8")
  );
  const engineeringEvidence = JSON.parse(
    await readFile(path.resolve("evals", "outputs", "engineering-evidence-report.json"), "utf8")
  );
  const fdeReadiness = JSON.parse(await readFile(path.resolve("evals", "outputs", "fde-readiness-report.json"), "utf8"));
  const summary = {
    suite: "all",
    evaluationMode: "deterministic_contract",
    generatedAt: new Date().toISOString(),
    reports: {
      socrates: socrates.summary,
      message_intelligence: messages.summary,
      agent_files: agentFiles.summary,
      github_integration: githubIntegration.summary,
      engineering_evidence: engineeringEvidence.summary,
      fde_readiness: fdeReadiness.summary
    },
    gate: {
      scope: "deterministic_contract",
      passed: Boolean(
        socrates.gate?.passed &&
          messages.gate?.passed &&
          agentFiles.gate?.passed &&
          githubIntegration.gate?.passed &&
          engineeringEvidence.gate?.passed &&
          fdeReadiness.gate?.passed
      ),
      reasons: [
        ...(socrates.gate?.reasons ?? []),
        ...(messages.gate?.reasons ?? []),
        ...(agentFiles.gate?.reasons ?? []),
        ...(githubIntegration.gate?.reasons ?? []),
        ...(engineeringEvidence.gate?.reasons ?? []),
        ...(fdeReadiness.gate?.reasons ?? [])
      ]
    },
    productionAiCertification: {
      passed: false,
      reason: "These suites use deterministic/mock providers. Production AI certification requires a credential-backed live runtime journey with citations and open targets."
    }
  };
  await writeFile(path.resolve("evals", "outputs", "eval-summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(
    path.resolve("evals", "outputs", "eval-summary.md"),
    [
      "# Eval summary",
      "",
      `Generated at: ${summary.generatedAt}`,
      "",
      `- Evaluation mode: ${summary.evaluationMode}`,
      `- Socrates: ${socrates.summary.passed}/${socrates.summary.total}`,
      `- Message intelligence: ${messages.summary.passed}/${messages.summary.total}`,
      `- Agent Files: ${agentFiles.summary.passed}/${agentFiles.summary.total}`,
      `- GitHub Integration: ${githubIntegration.summary.passed}/${githubIntegration.summary.total}`,
      `- Engineering Evidence: ${engineeringEvidence.summary.passed}/${engineeringEvidence.summary.total}`,
      `- FDE Readiness: ${fdeReadiness.summary.passed}/${fdeReadiness.summary.total}`,
      `- Deterministic contract gate passed: ${summary.gate.passed ? "yes" : "no"}`,
      `- Gate reasons: ${summary.gate.reasons.length > 0 ? summary.gate.reasons.join("; ") : "None"}`,
      `- Production AI certified: ${summary.productionAiCertification.passed ? "yes" : "no"}`,
      `- Production certification note: ${summary.productionAiCertification.reason}`
    ].join("\n")
  );
  console.log(`Deterministic contract eval gate: ${summary.gate.passed ? "passed" : "failed"}`);
  console.log("Production AI certification: not claimed; credential-backed live proof is required.");
  if (!summary.gate.passed) {
    process.exitCode = 1;
  }
}

void main();
