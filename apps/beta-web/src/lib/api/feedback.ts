import { apiJson } from "./client";

export type SocratesFeedbackReason = "helpful" | "incorrect" | "outdated" | "missing_evidence" | "wrong_source" | "wrong_current_truth";
export type SocratesFeedback = { id: string; reason: SocratesFeedbackReason; correctionText: string | null; needsHumanReview: boolean; productBrainVersionId: string | null; updatedAt: string; acceptedTruthChanged: false };

export const saveSocratesFeedback = (projectId: string, sessionId: string, assistantMessageId: string, input: { reason: SocratesFeedbackReason; correctionText?: string | null }) => apiJson<SocratesFeedback>(
  `/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages/${assistantMessageId}/feedback`,
  { method: "POST", body: JSON.stringify(input) }
);
