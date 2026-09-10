/**
 * CHR-RAG Layer 4: Query-intent routing.
 *
 * Classifies user queries into one of 10 intent types so that retrieval
 * domains and source-precedence rules can be applied deterministically.
 * This is intentionally lexical-first (no LLM call) to keep the hot path
 * cheap. The heavier reasoning model in answer generation will surface any
 * nuance that simple classification misses.
 */

export type QueryIntent =
  | "current_truth"
  | "original_source"
  | "change_history"
  | "decision_history"
  | "doc_local"
  | "brain_local"
  | "dashboard_status"
  | "team_responsibility"
  | "manual_context"
  | "diagram_lookup"
  | "coding_requirements"
  | "communication_lookup"
  | "comparison_or_diff"
  | "explain_for_role";

// Ordered from highest-confidence heuristics to lowest.
// NOTE: comparison_or_diff must precede original_source because "original vs"
// would otherwise match the \boriginal\b pattern in original_source.
const INTENT_PATTERNS: Array<{ intent: QueryIntent; patterns: RegExp[] }> = [
  {
    intent: "comparison_or_diff",
    patterns: [
      /\b(compare|comparison|diff|difference|versus)\b/i,
      /\bvs\.?\s/i,
      /\bwhat (changed|is different) (between|from|since)\b/i,
      /\bbefore (and|vs) after\b/i,
      /\boriginal (vs|versus|and current)\b/i,
    ],
  },
  {
    intent: "change_history",
    patterns: [
      /\bwhat changed\b/i,
      /\bhow (has|did|was) (this|it|the) (change|evolve|update)\b/i,
      /\bchange (history|log|record|proposal|request)\b/i,
      /\baccept(ed)? change\b/i,
      /\bspec change\b/i,
      /\bmodif(ied|ication)\b/i,
      /\b(list|show|give) all (accepted |recent |new )?changes\b/i,
      /\bwhat (is|are) the (recent|latest|new) change\b/i,
    ],
  },
  {
    intent: "decision_history",
    patterns: [
      /\bdecision record\b/i,
      /\bwas (it|this) decided\b/i,
      /\bwhy (was|is|did) .{0,20}(decided|chosen|selected)\b/i,
      /\bwho decided\b/i,
      /\bshow decision\b/i,
      /\blist decision\b/i,
    ],
  },
  {
    intent: "original_source",
    patterns: [
      /\bfirst (mentioned|said|written|stated|defined)\b/i,
      /\bwhere (was|did|is) (this|it) (come from|introduced|start)\b/i,
      /\bwhat did the (original|initial|first)(?:\s+\w+){0,2}\s+(prd|srs|doc|document|brief|requirement)\b/i,
      /\bwhat did .{0,40}\boriginally (say|state|define)\b/i,
      /\bwhich (slack|clickup|gmail|email|fireflies|transcript|meeting|message|thread|task|comment)(\s+\w+)? (introduced|said|created|triggered)\b/i,
      /\bprovenance\b/i,
      /\bsource (of|for) (this|that|the)\b/i,
      /\bwhere was (this|it) originally\b/i,
    ],
  },
  {
    intent: "coding_requirements",
    patterns: [
      /\bwhat needs to be (built|coded|implemented)\b/i,
      /\bwhat should (developers|engineering|we) build first\b/i,
      /\bimplementation flow\b/i,
      /\bimplementation unknowns\b/i,
      /\bbackend modules?\b/i,
      /\bfrontend modules?\b/i,
      /\bmodule dependencies\b/i,
      /\bmain coding flow\b/i,
      /\bcoding requirements\b/i
    ],
  },
  {
    intent: "diagram_lookup",
    patterns: [
      /\bdiagrams?\b/i,
      /\bmermaid\b/i,
      /\bflowchart\b/i,
      /\bsequence diagram\b/i,
      /\bcoding flow\b/i,
      /\brequirement flow\b/i,
      /\barchitecture diagram\b/i,
      /\bmodule dependenc(y|ies)\b/i,
      /\bshow me .* flow\b/i,
      /\bwhich live doc section contains .*diagram\b/i,
    ],
  },
  {
    intent: "manual_context",
    patterns: [
      /\bmanual (context|note|notes|transcript|transcripts|record|recorded|decision|decisions)\b/i,
      /\bwhat did we manually (record|add|capture)\b/i,
      /\b(manually added|added manually)\b/i,
      /\bwho said\b/i,
      /\bchat export\b/i,
      /\bmeeting note\b/i,
      /\b(chart|screenshot) caption\b/i,
      /\bteam notes?\b/i,
      /\btask context\b/i,
    ],
  },
  {
    intent: "communication_lookup",
    patterns: [
      /\bwhich (message|thread)\b/i,
      /\bslack\b/i,
      /\bclickup\b/i,
      /\bgmail\b/i,
      /\bfireflies\b/i,
      /\btranscript\b/i,
      /\bmeeting segment\b/i,
      /\bemail\b/i,
      /\bthread\b/i,
      /\btask (comment|update|status|history)\b/i,
      /\bcomment(s)? (mention|from|on)\b/i,
      /\bmessage from\b/i,
      /\bsomeone (said|mentioned|wrote)\b/i,
      /\bconversation\b/i,
      /\bclient (said|mentioned|asked|wrote)\b/i,
    ],
  },
  {
    intent: "team_responsibility",
    patterns: [
      /\bwho (owns|owner|responsible for|is responsible for)\b/i,
      /\b(responsible|responsibility|responsibilities|task|tasks|working on|assigned to|assignee)\b/i,
      /\bwhich (tasks|responsibilities) are (blocked|open|in progress|done)\b/i,
      /\bwhat is .{0,40}\bworking on\b/i,
      /\b(frontend|backend|api|ai|design|qa|docs|devops|product) owner\b/i,
    ],
  },
  {
    intent: "dashboard_status",
    patterns: [
      /\bdashboard\b/i,
      /\b(project|team) (status|summary|state|health|overview)\b/i,
      /\bheadcount\b/i,
      /\bworkload\b/i,
      /\bpressure\b/i,
      /\bneed(s)? attention\b/i,
      /\bprogress (of|on|for)\b/i,
      /\bhow (are|is) (the|a) (project|team)\b/i,
    ],
  },
  {
    intent: "brain_local",
    patterns: [
      /\bbrain\b/i,
      /\bgraph (node|edge)\b/i,
      /\bmodule\b/i,
      /\bflow\b/i,
      /\bdepend(s|ency|encies) on\b/i,
      /\bconnect(ed|ion) to\b/i,
      /\barchitecture\b/i,
      /\bstructure of\b/i,
    ],
  },
  {
    intent: "doc_local",
    patterns: [
      /\b(this|the) (section|paragraph|clause|requirement)\b/i,
      /\bin (this|the) (doc|document|prd|srs|spec|brief)\b/i,
      /\bsection\s+\d/i,
      /\bpage\s+\d/i,
      /\banchor\b/i,
    ],
  },
  {
    intent: "explain_for_role",
    patterns: [
      /\bexplain (to|for) (a |the )?(client|stakeholder|manager|dev|developer|engineer|engineering|non-tech)\b/i,
      /\bexplain (this|it|that) for (a |the )?(client|stakeholder|manager|dev|developer|engineer|engineering|non-tech)\b/i,
      /\bsimpl(y|ify|ification)\b/i,
      /\bplain language\b/i,
      /\bhow should (i|we) explain\b/i,
      /\bfor (client|stakeholder) review\b/i,
    ],
  },
  {
    intent: "current_truth",
    // Fallback — almost any "what is / what are / what does" question.
    patterns: [
      /\bwhat (is|are|does|should)\b/i,
      /\bcurrent(ly)?\b/i,
      /\bnow\b/i,
      /\blatest\b/i,
      /\baccept(ed)?\b/i,
      /\btoday\b/i,
    ],
  },
];

/**
 * Classify the user query into the best-matching intent.
 * Returns `current_truth` when no specific pattern matches.
 */
export function classifyIntent(query: string): QueryIntent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(query))) {
      return intent;
    }
  }
  return "current_truth";
}
