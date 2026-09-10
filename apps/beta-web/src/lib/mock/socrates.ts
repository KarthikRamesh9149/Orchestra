// Mock Socrates answers for the side panel in dev/demo mode.
// Keyword-matched, grounded in the same BloomFast synthetic universe used by
// mock/dashboard.ts, mock/timeline.ts, mock/suggestions.ts, and mock/github.ts.

export interface MockSocratesAnswer {
  answer_md: string;
  citations: Array<{ label: string; refId: string }>;
  open_targets: Array<{ targetType: string; targetRef: Record<string, unknown> }>;
}

function docTarget(anchorId: string) {
  return { targetType: "document_section", targetRef: { documentId: "1", anchorId } };
}

const ANSWERS: Array<{ match: (q: string) => boolean; answer: MockSocratesAnswer }> = [
  {
    // "How do I connect VS Code?", "Can VS Code ask from uploaded docs?", "What does the connector access?"
    match: (q) => /vs ?code|connector|pair|extension|access/.test(q),
    answer: {
      answer_md:
        "**VS Code connector** pairs your editor with this workspace in read-only mode.\n\n" +
        "1. Open the **Integrations** page and click *Connect* on the VS Code card.\n" +
        "2. Copy the 8-character pairing code (valid for 10 minutes).\n" +
        "3. In VS Code, run `Orchestra: Pair Workspace` from the command palette and paste the code.\n\n" +
        "Once paired, the extension can **ask Socrates questions against uploaded project memory** — PRD v2, the SRS, and indexed Slack threads — directly from the editor. The connector token is read-only: it can query memory but cannot modify documents, timeline entries, or Product Brain truth.",
      citations: [
        { label: "BloomFast PRD v2 · §1 Overview", refId: "chunk-overview" },
        { label: "#engineering · Slack", refId: "slack-vscode" }
      ],
      open_targets: [docTarget("overview"), docTarget("summary")]
    }
  },
  {
    // "Compare source docs and Slack discussions"
    match: (q) => /compare|drift|contradict|conflict|versus|differ/.test(q),
    answer: {
      answer_md:
        "I found **2 places where Slack consensus and source docs disagree**:\n\n" +
        "1. **OAuth scope drift** — PRD v2 §2.1 says *\"v1 ships with magic-link only; OAuth deferred to v2\"*, but PR #47 (in review) implements OAuth flows with Google + GitHub providers. Either the PRD needs updating or the PR needs scoping back.\n" +
        "2. **Pro tier conflict** — the #product thread on May 12 agreed to defer the Pro subscription tier to v2, yet PR #38 (merged, `a3f9c21`) added Stripe Pro tier logic to main.\n\n" +
        "Everything else is aligned: Stripe Connect as payment provider, Supabase as database, and the June 15 launch date all match across docs, Slack, and the timeline.",
      citations: [
        { label: "BloomFast PRD v2 · §2.1 Auth", refId: "chunk-auth" },
        { label: "#product · Slack · May 12", refId: "slack-pro-tier" },
        { label: "PR #47 · feature/magic-link-auth", refId: "pr-47" }
      ],
      open_targets: [docTarget("auth-detail"), docTarget("scope-detail")]
    }
  },
  {
    // "What should a PM review next?"
    match: (q) => /review next|should .*review|pm |product manager|pending|priorit/.test(q),
    answer: {
      answer_md:
        "Based on pending items across the timeline and suggestions, here is what needs **manager attention first**:\n\n" +
        "1. **Promo code system scope** — requested by the product team for the launch campaign, still awaiting scope review and an engineering estimate (pending 2 days).\n" +
        "2. **PR #43 is stalled** — Devraj's soft-delete migration has had no activity for 7 days and is blocked on review by Sarah Chen.\n" +
        "3. **Driver Assignment coverage gap** — PRD v2 §3.2 has had no engineering activity in 18 days; it was scoped for sprint 4 and we are now in sprint 5.\n" +
        "4. **OAuth spec drift** — PR #47 implements OAuth despite the PRD scoping v1 to magic-link only.\n\n" +
        "Items 1 and 4 block the **June 15 launch** decision path, so I'd start there.",
      citations: [
        { label: "Timeline · Promo code system requested", refId: "timeline-t1" },
        { label: "Suggestions · Stalled work", refId: "suggestion-s4" },
        { label: "BloomFast PRD v2 · §3.2 Driver Assignment", refId: "chunk-driver" }
      ],
      open_targets: [docTarget("driver-detail"), docTarget("scope")]
    }
  },
  {
    // "What requirements are in project memory?"
    match: (q) => /requirement|spec|srs|scope of v1|what.*memory/.test(q),
    answer: {
      answer_md:
        "Project memory currently holds **4 indexed documents** covering these requirement groups:\n\n" +
        "- **Buyer ordering flow** — browse local florists, cart, checkout with Stripe Connect (PRD v2 §2).\n" +
        "- **Authentication** — magic-link only for v1, refresh-token rotation, 5 requests / 15 min rate limit (PRD v2 §2.1, SRS §3).\n" +
        "- **Florist order management** — accept/decline orders, inventory flags, payout dashboard at a 70/30 revenue split (PRD v2 §3.1).\n" +
        "- **Driver assignment** — proximity-based matching with availability windows and ETA calculation (Driver Assignment Spec, PRD v2 §3.2).\n" +
        "- **Payments** — Stripe Connect split payments; promo codes are *requested but not yet scoped*.\n\n" +
        "Out of scope for v1: OAuth, the Pro subscription tier, and push notifications beyond Firebase basics.",
      citations: [
        { label: "BloomFast PRD v2 · §2 Scope", refId: "chunk-scope" },
        { label: "BloomFast SRS v1 · §3 Auth", refId: "chunk-srs-auth" },
        { label: "Driver Assignment Spec", refId: "chunk-driver-spec" }
      ],
      open_targets: [docTarget("scope-detail"), docTarget("auth-detail"), docTarget("driver-detail")]
    }
  },
  {
    // "Which uploaded document supports this?"
    match: (q) => /which.*(document|doc|source)|supports|provenance|where.*from|evidence/.test(q),
    answer: {
      answer_md:
        "The strongest source for that is **BloomFast PRD v2** (uploaded by Sarah Chen, Apr 18). Section §2.1 covers the auth scope decision, §3.2 covers driver assignment, and §4 covers the Stripe Connect payment split.\n\n" +
        "Two supporting sources:\n" +
        "- **BloomFast SRS v1** — system-level requirements for auth, order flow, and payment integration.\n" +
        "- **OAuth Removal RFC** — Devraj's RFC proposing magic-link as the sole v1 auth mechanism (still indexing).\n\n" +
        "Click any citation below to open the exact section in the document viewer.",
      citations: [
        { label: "BloomFast PRD v2 · §2.1", refId: "chunk-auth" },
        { label: "BloomFast SRS v1", refId: "chunk-srs" },
        { label: "OAuth Removal RFC", refId: "chunk-rfc" }
      ],
      open_targets: [docTarget("auth"), docTarget("summary"), docTarget("scope")]
    }
  },
  {
    // CI / PR health ("Why did PR #43 fail CI?", "Explain recent failed checks")
    match: (q) => /ci\b|fail|check|pr ?#?\d+|merge|blocking|build/.test(q),
    answer: {
      answer_md:
        "**CI on main is passing** (last commit `a3f9c21`, 2h ago), but there is **1 failing check** in the history: commit `3e4f112` — *\"fix: session rotation edge case\"* by Devraj — failed on the session-rotation integration suite.\n\n" +
        "PR health right now:\n" +
        "- **PR #47** (magic-link auth refactor, Maya) — open, conflicts with **PR #52** in `auth.ts`, `session.ts`, and `middleware/auth.ts`. Whichever merges first forces the other to rebase.\n" +
        "- **PR #43** (soft-delete migration, Devraj) — **stalled 7 days**, blocked on review by Sarah Chen. No CI failures; it simply needs a reviewer.\n" +
        "- **PR #49** and **PR #50** — green and ready to merge.\n\n" +
        "Test coverage is at **78%**, up 2 points this week.",
      citations: [
        { label: "Commit 3e4f112 · main", refId: "commit-3e4f112" },
        { label: "PR #47 · feature/magic-link-auth", refId: "pr-47" },
        { label: "PR #43 · migration", refId: "pr-43" }
      ],
      open_targets: [docTarget("auth-detail"), docTarget("overview")]
    }
  },
  {
    // auth deep-dive
    match: (q) => /auth|login|magic.?link|token|oauth|session/.test(q),
    answer: {
      answer_md:
        "**Auth in BloomFast v1 is magic-link only** — OAuth was removed from scope on May 27 after a cost and timeline review.\n\n" +
        "- Magic-link request → email with one-time link → session with **refresh-token rotation** (PR #47, merged May 28, 24 files).\n" +
        "- Rate limited to **5 magic-link requests per email per 15 minutes** via a BullMQ-backed limiter (commit `8b2e445`).\n" +
        "- Refresh tokens live in httpOnly cookies; access tokens rotate on every refresh.\n\n" +
        "The module is owned by **Devraj** (18 of 23 commits to `src/modules/auth/`), with Sarah Chen reviewing all auth PRs. Watch out: PR #47 and PR #52 both touch `auth.ts`, `session.ts`, and `middleware/auth.ts` — merging either first forces the other to rebase.",
      citations: [
        { label: "BloomFast PRD v2 · §2.1 Auth", refId: "chunk-auth" },
        { label: "PR #47 · main", refId: "pr-47" },
        { label: "Timeline · OAuth removed from v1", refId: "timeline-t5" }
      ],
      open_targets: [docTarget("auth-detail"), docTarget("auth")]
    }
  },
  {
    // driver assignment
    match: (q) => /driver|assignment|delivery|eta/.test(q),
    answer: {
      answer_md:
        "**Driver assignment is the biggest risk area right now.** The spec (PRD v2 §3.2 + the dedicated Driver Assignment Spec) defines proximity-based matching, availability windows, and ETA calculation — but there has been **no engineering activity against it for 18 days**.\n\n" +
        "It was scoped for sprint 4; we are now in sprint 5, with the June 15 launch six weeks out. No branch, PR, or commit references §3.2 in that window.\n\n" +
        "Suggested next step: confirm with Sarah whether driver assignment stays in the v1 launch or moves to a fast-follow.",
      citations: [
        { label: "BloomFast PRD v2 · §3.2 Driver Assignment", refId: "chunk-driver" },
        { label: "Driver Assignment Spec · Apr 22", refId: "chunk-driver-spec" },
        { label: "Suggestions · Coverage gap", refId: "suggestion-s7" }
      ],
      open_targets: [docTarget("driver-detail"), docTarget("driver")]
    }
  },
  {
    // payments / stripe / promo
    match: (q) => /stripe|payment|promo|billing|subscription|revenue/.test(q),
    answer: {
      answer_md:
        "**Stripe Connect is the confirmed payment provider** (decision logged May 22 by Sarah Chen, after evaluating Stripe, Braintree, and PayPal). Split payments run at a **70% florist / 30% platform** revenue share.\n\n" +
        "Current payment workstreams:\n" +
        "- **Promo codes** — PR #51 by Priya adds Stripe-backed promo endpoints; scope review still pending. Note it conflicts with PR #54 (rate limiter) in `routes/api/index.ts`.\n" +
        "- **Pro subscription tier** — deferred to v2 by #product consensus, but PR #38 already merged Pro tier logic to main; this needs reconciling.\n\n" +
        "Monthly tooling spend including Stripe usage pricing sits at **$506/mo** across AWS, Supabase, Firebase, Vercel, and Sentry.",
      citations: [
        { label: "Timeline · Stripe selected", refId: "timeline-t12" },
        { label: "BloomFast PRD v2 · §4 Payments", refId: "chunk-payments" },
        { label: "#product · Slack · May 12", refId: "slack-pro-tier" }
      ],
      open_targets: [docTarget("payments-detail"), docTarget("payments")]
    }
  },
  {
    // launch / scope / deadline
    match: (q) => /launch|deadline|june|ship|release|v1|v2|timeline/.test(q),
    answer: {
      answer_md:
        "**Target launch is June 15, 2026** — revised from June 1 after the auth sprint ran 4 days over on refresh-token edge cases.\n\n" +
        "v1 scope (confirmed): buyer ordering, florist management, magic-link auth, Stripe Connect payments.\n" +
        "Deferred to v2: OAuth, Pro subscription tier, advanced notifications.\n\n" +
        "Open risks against the date: the driver assignment coverage gap (18 days idle), the PR #47/#52 auth merge conflict, and the unscoped promo code request. Sprint velocity is healthy at **32 pts/sprint** (up from 24).",
      citations: [
        { label: "Timeline · Launch date revised", refId: "timeline-t18" },
        { label: "BloomFast PRD v2 · §2 Scope", refId: "chunk-scope" }
      ],
      open_targets: [docTarget("scope-detail"), docTarget("overview")]
    }
  },
  {
    // "Summarize the uploaded project docs" / "Summarize this workspace memory" — keep near-last so
    // more specific matches above win when both apply.
    match: (q) => /summar|overview|digest|catch me up|what.*project|tell me about/.test(q),
    answer: {
      answer_md:
        "**BloomFast** is an on-demand flower delivery marketplace connecting buyers to local florists. Project memory holds 4 docs, 47 commits, and 12 indexed Slack threads. The big picture:\n\n" +
        "- **Product** — three core flows: buyer ordering, florist order management, driver assignment (PRD v2, 47 pages).\n" +
        "- **Auth** — magic-link only for v1; OAuth deferred to v2. Merged to main in PR #47 with refresh-token rotation.\n" +
        "- **Payments** — Stripe Connect with a 70/30 florist/platform split; promo code system requested but unscoped.\n" +
        "- **Infra** — Supabase (Postgres), BullMQ + Redis workers, Vercel Pro hosting, S3 storage.\n" +
        "- **Launch** — June 15, 2026, revised from June 1. Velocity 32 pts/sprint.\n\n" +
        "Most urgent: the driver assignment spec has had no engineering activity in 18 days, and two auth PRs (#47, #52) are heading for a merge conflict.",
      citations: [
        { label: "BloomFast PRD v2 · §1 Overview", refId: "chunk-overview" },
        { label: "BloomFast SRS v1", refId: "chunk-srs" },
        { label: "Timeline · 21 events", refId: "timeline-all" }
      ],
      open_targets: [docTarget("overview"), docTarget("summary")]
    }
  }
];

const DEFAULT_ANSWER: MockSocratesAnswer = {
  answer_md:
    "From project memory — **BloomFast PRD v2**, the SRS, and recent Slack activity — the team is in the final sprint before the **June 15 launch**, with auth and integrations merged to main.\n\n" +
    "I can go deeper on any of these:\n" +
    "- *Summarize the uploaded project docs*\n" +
    "- *What requirements are in project memory?*\n" +
    "- *Compare source docs and Slack discussions*\n" +
    "- *What should a PM review next?*",
  citations: [
    { label: "BloomFast PRD v2 · §1 Overview", refId: "chunk-overview" },
    { label: "#product · Slack", refId: "slack-pro-tier" }
  ],
  open_targets: [docTarget("overview"), docTarget("summary")]
};

export function getMockSocratesAnswer(content: string): MockSocratesAnswer {
  const q = content.toLowerCase();
  for (const entry of ANSWERS) {
    if (entry.match(q)) return entry.answer;
  }
  return DEFAULT_ANSWER;
}

export function buildMockDeepResearchResults() {
  return {
    executiveSummary:
      "The project is healthy but carries avoidable execution risk in auth, scope control, and review flow. Spec drift around OAuth and an unreviewed PR are the most urgent items.",
    findings: [
      {
        category: "SPEC DRIFT",
        severity: "HIGH" as const,
        title: "OAuth shipping despite PRD saying v1 is magic-link only",
        description: "PR #47 introduces full OAuth while the PRD defers OAuth to v2. Resolve scope before merge.",
        sources: "PR #47 · PRD v2 §2.1 · Slack #engineering"
      },
      {
        category: "STALLED WORK",
        severity: "MEDIUM" as const,
        title: "PR #43 unreviewed for 11 days",
        description: "A sizable change has had no reviewer activity for over a week.",
        sources: "GitHub PR #43"
      }
    ],
    marketContext: [
      { title: "OAuth vs magic-link in B2B SaaS", body: "Magic-link remains a defensible v1 choice for focused beta launches." }
    ],
    expansionOpportunities: [
      "40% of commits are in the auth module — an auth architecture map would help onboarding.",
      "Several unresolved product decisions sit in Slack and could be promoted to the timeline."
    ],
    recommendedActions: [
      { priority: "IMMEDIATE" as const, action: "Resolve whether OAuth is in or out of v1 before PR #47 merges.", source: "PR #47 · PRD §2.1" },
      { priority: "THIS WEEK" as const, action: "Assign a reviewer to PR #43 today.", source: "GitHub PR #43" }
    ],
    stats: { totalSources: 12, slackMessages: 847, commits: 91, docs: 4, webSources: 38, duration: "0m 6s" },
    sources: [
      { provider: "GitHub", label: "Authentication pull request", kind: "internal" as const, href: "/timeline?source=github" },
      { provider: "Documents", label: "Product requirements", kind: "internal" as const, href: "/memory" }
    ]
  };
}
