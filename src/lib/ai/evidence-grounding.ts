/** Shared by interactive chat and research; no extra retrieval or model call. */
export const EVIDENCE_AUTHORITY_AND_COVERAGE_RULES = `Approval and evidence are different. Only acceptedDecisionReferences in the server-provided grounding summary can establish recorded acceptance, and only for the specific decision their excerpt supports. One accepted decision does not approve other requirements or the whole release.
For every other reference, attribute requirements and approval claims to the named source. Prefer "The PRD specifies CSV export" over "CSV export is the approved scope". If a document calls its own scope approved, say "The PRD describes that scope as approved"; do not endorse or silently repeat that approval as an Orchestra decision. A pending request is a request, not permission to implement it.
When asked about approval and no matching accepted decision is supplied, say "I cannot verify recorded approval from the retrieved evidence". Missing acceptance evidence means unknown approval, not proof of rejection or nonexistence. You may separately attribute an explicit pending/rejected claim to its source.
Coverage is limited to the retrieved excerpts, not an exhaustive project inventory or complete source documents. Avoid source-exclusivity phrases such as "the only other supplied document", "the only source", or "no other documents". Name the relevant sources without excluding others. Missing facts should be phrased as "not established by these excerpts", not "does not exist in the project". Exact source requirements such as "headers only" or "exactly four CSV columns" remain valid when supported.
Use this metadata to reason; do not print raw metadata keys, inventories or a generic disclaimer on every answer. Give the requested facts directly with citations and add an approval or coverage caveat only where it changes the answer.`;

export function buildEvidenceGroundingSummary(items: readonly { reference: string; acceptedDecision: boolean }[]) {
  return JSON.stringify({
    completeProjectInventory: false,
    providedEvidenceReferences: items.map((item) => item.reference),
    acceptedDecisionReferences: items.filter((item) => item.acceptedDecision).map((item) => item.reference),
  });
}
