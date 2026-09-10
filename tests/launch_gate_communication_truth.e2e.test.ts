import { beforeAll, describe, expect, it, vi } from "vitest";
import { AuditService } from "../src/modules/audit/service.js";
import { BrainService } from "../src/modules/brain/service.js";
import { ChangeProposalService } from "../src/modules/changes/service.js";
import { CommunicationProposalsService } from "../src/modules/communications/communication-proposals.service.js";
import { MessageIngestionService } from "../src/modules/communications/message-ingestion.service.js";
import { MessageInsightsService } from "../src/modules/communications/message-insights.service.js";
import { DashboardService } from "../src/modules/dashboard/service.js";
import { DocumentService } from "../src/modules/documents/service.js";
import { ProjectService } from "../src/modules/projects/service.js";
import { hybridRetrieve } from "../src/lib/retrieval/hybrid.js";

// ─── Fixture IDs ──────────────────────────────────────────────────────────────
const P_ID = "proj-launch";
const ORG_ID = "org-launch";
const MANAGER_ID = "user-manager";
const DEV_ID = "user-dev";
const DOC_ID = "doc-prd-1";
const DOC_VER_ID = "doc-ver-1";
const SECTION_ID = "section-auth-1";
const BRAIN_NODE_ID = "node-auth-approval";
const BRAIN_V1_ID = "brain-v1";
const CONNECTOR_ID = "connector-fireflies";
const PROVIDER_THREAD_ID = "fireflies:transcript:ff-launch-001";
const PROVIDER_MSG_ID = "fireflies:transcript:ff-launch-001:full";
const BRAIN_V2_ID = "brain-v2";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function createStore() {
  return {
    projects: new Map<string, any>(),
    projectMembers: new Map<string, any>(),
    documents: new Map<string, any>(),
    documentVersions: new Map<string, any>(),
    documentSections: new Map<string, any>(),
    communicationConnectors: new Map<string, any>(),
    communicationThreads: new Map<string, any>(),
    communicationMessages: new Map<string, any>(),
    communicationMessageRevisions: new Map<string, any>(),
    communicationMessageChunks: new Map<string, any>(),
    messageInsights: new Map<string, any>(),
    specChangeProposals: new Map<string, any>(),
    specChangeLinks: new Map<string, any>(),
    artifactVersions: new Map<string, any>(),
    brainNodes: new Map<string, any>(),
    decisionRecords: new Map<string, any>(),
    dashboardSnapshots: new Map<string, any>(),
    jobRuns: new Map<string, any>(),
    auditEvents: [] as any[]
  };
}

function seedStore(store: ReturnType<typeof createStore>) {
  store.projects.set(P_ID, {
    id: P_ID,
    orgId: ORG_ID,
    name: "Launch Project",
    slug: "launch-project",
    status: "active",
    description: null,
    previewUrl: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z")
  });

  store.projectMembers.set(`${P_ID}:${MANAGER_ID}`, {
    id: "pm-manager",
    projectId: P_ID,
    userId: MANAGER_ID,
    projectRole: "manager",
    isActive: true,
    roleInProject: "Lead",
    allocationPercent: 100,
    weeklyCapacityHours: 40,
    user: { id: MANAGER_ID, displayName: "Manager", workspaceRoleDefault: "manager", isActive: true }
  });

  store.projectMembers.set(`${P_ID}:${DEV_ID}`, {
    id: "pm-dev",
    projectId: P_ID,
    userId: DEV_ID,
    projectRole: "dev",
    isActive: true,
    roleInProject: "Engineer",
    allocationPercent: 100,
    weeklyCapacityHours: 40,
    user: { id: DEV_ID, displayName: "Dev", workspaceRoleDefault: "dev", isActive: true }
  });

  store.documents.set(DOC_ID, {
    id: DOC_ID,
    projectId: P_ID,
    orgId: ORG_ID,
    title: "Product Requirements Document",
    kind: "prd",
    currentVersionId: DOC_VER_ID,
    status: "active",
    isClientVisible: false,
    createdAt: new Date("2026-04-10T09:00:00.000Z"),
    updatedAt: new Date("2026-04-10T09:00:00.000Z")
  });

  store.documentVersions.set(DOC_VER_ID, {
    id: DOC_VER_ID,
    documentId: DOC_ID,
    projectId: P_ID,
    orgId: ORG_ID,
    versionNumber: 1,
    status: "ready",
    parseRevision: 1,
    processedAt: new Date("2026-04-10T10:00:00.000Z"),
    createdAt: new Date("2026-04-10T09:00:00.000Z")
  });

  store.documentSections.set(SECTION_ID, {
    id: SECTION_ID,
    documentVersionId: DOC_VER_ID,
    projectId: P_ID,
    parseRevision: 1,
    orderIndex: 5,
    anchorId: "anchor-auth",
    pageNumber: 2,
    headingPath: ["Authentication", "Approval Flow"],
    normalizedText: "Users must receive approval from two managers before account activation."
  });

  store.artifactVersions.set(BRAIN_V1_ID, {
    id: BRAIN_V1_ID,
    projectId: P_ID,
    orgId: ORG_ID,
    artifactType: "product_brain",
    status: "accepted",
    versionNumber: 1,
    payloadJson: { whatTheProductIs: "A product management brain", mainFlows: ["Auth"], modules: [], constraints: [], integrations: [] },
    acceptedAt: new Date("2026-04-10T12:00:00.000Z"),
    createdAt: new Date("2026-04-10T11:00:00.000Z")
  });

  store.brainNodes.set(BRAIN_NODE_ID, {
    id: BRAIN_NODE_ID,
    projectId: P_ID,
    orgId: ORG_ID,
    artifactVersionId: BRAIN_V1_ID,
    nodeKey: "auth-approval",
    nodeType: "feature",
    title: "Auth Approval Flow",
    status: "accepted",
    bodyText: "Two-manager approval required before account activation."
  });

  store.communicationConnectors.set(CONNECTOR_ID, {
    id: CONNECTOR_ID,
    projectId: P_ID,
    provider: "fireflies_ai",
    status: "connected",
    lastSyncedAt: null,
    lastError: null
  });
}

let idSeq = 0;
function genId(prefix: string) {
  return `${prefix}-${++idSeq}`;
}

function buildMockPrisma(store: ReturnType<typeof createStore>): any {
  const self: any = {};

  self.$transaction = async (cb: (tx: any) => Promise<any>) => cb(self);
  self.$queryRawUnsafe = vi.fn().mockResolvedValue([]);
  self.$executeRawUnsafe = vi.fn().mockResolvedValue(1);

  self.auditEvent = {
    create: async (args: any) => {
      const ev = { id: genId("audit"), createdAt: new Date(), ...args.data };
      store.auditEvents.push(ev);
      return ev;
    }
  };

  self.project = {
    findUniqueOrThrow: async (args: any) => {
      const id = args?.where?.id;
      const p = store.projects.get(id);
      if (!p) throw new Error(`Project ${id} not found`);
      if (!args?.include) return p;
      const result = { ...p };
      if (args.include.members !== undefined) {
        const whereIsActive = args.include.members?.where?.isActive;
        let members = Array.from(store.projectMembers.values()).filter((m: any) => m.projectId === id);
        if (whereIsActive !== undefined) members = members.filter((m: any) => m.isActive === whereIsActive);
        result.members = members;
      }
      if (args.include.documents !== undefined) {
        const docs = Array.from(store.documents.values()).filter((d: any) => d.projectId === id);
        result.documents = docs.map((doc: any) => ({
          ...doc,
          versions: args.include.documents?.include?.versions
            ? Array.from(store.documentVersions.values())
                .filter((v: any) => v.documentId === doc.id)
                .sort((a: any, b: any) => b.createdAt - a.createdAt)
            : []
        }));
      }
      if (args.include.changeProposals !== undefined) {
        const statusFilter = args.include.changeProposals?.where?.status?.in;
        let proposals = Array.from(store.specChangeProposals.values()).filter((p: any) => p.projectId === id);
        if (statusFilter) proposals = proposals.filter((p: any) => statusFilter.includes(p.status));
        proposals.sort((a: any, b: any) => (b.updatedAt?.getTime?.() ?? 0) - (a.updatedAt?.getTime?.() ?? 0));
        result.changeProposals = proposals;
      }
      if (args.include.decisions !== undefined) {
        const statusFilter = args.include.decisions?.where?.status?.in;
        let decisions = Array.from(store.decisionRecords.values()).filter((d: any) => d.projectId === id);
        if (statusFilter) decisions = decisions.filter((d: any) => statusFilter.includes(d.status));
        result.decisions = decisions;
      }
      if (args.include.artifacts !== undefined) {
        const where = args.include.artifacts?.where ?? {};
        let artifacts = Array.from(store.artifactVersions.values()).filter((a: any) => a.projectId === id);
        if (where.artifactType) artifacts = artifacts.filter((a: any) => a.artifactType === where.artifactType);
        if (where.status) artifacts = artifacts.filter((a: any) => a.status === where.status);
        if (args.include.artifacts?.orderBy?.versionNumber === "desc") {
          artifacts.sort((a: any, b: any) => b.versionNumber - a.versionNumber);
        }
        const take = args.include.artifacts?.take;
        if (take) artifacts = artifacts.slice(0, take);
        result.artifacts = artifacts;
      }
      if (args.include.communicationConnectors !== undefined) {
        result.communicationConnectors = Array.from(store.communicationConnectors.values()).filter((c: any) => c.projectId === id);
      }
      if (args.include.messageInsights !== undefined) {
        const statusFilter = args.include.messageInsights?.where?.status?.in;
        let insights = Array.from(store.messageInsights.values()).filter((i: any) => i.projectId === id);
        if (statusFilter) insights = insights.filter((i: any) => statusFilter.includes(i.status));
        result.messageInsights = insights;
      }
      return result;
    },
    findUnique: async (args: any) => {
      const id = args?.where?.id;
      const p = store.projects.get(id);
      if (!p) return null;
      if (args?.select) {
        const result: any = {};
        for (const key of Object.keys(args.select)) {
          result[key] = p[key];
        }
        return result;
      }
      return p;
    },
    findFirstOrThrow: async (args: any) => {
      const id = args?.where?.id;
      const p = store.projects.get(id);
      if (!p) throw new Error(`Project not found`);
      return p;
    }
  };

  self.projectMember = {
    findFirst: async (args: any) => {
      const where = args?.where ?? {};
      for (const m of store.projectMembers.values()) {
        if (where.projectId && m.projectId !== where.projectId) continue;
        if (where.userId && m.userId !== where.userId) continue;
        if (where.isActive !== undefined && m.isActive !== where.isActive) continue;
        return m;
      }
      return null;
    }
  };

  self.communicationConnector = {
    findFirst: async (args: any) => {
      const where = args?.where ?? {};
      for (const c of store.communicationConnectors.values()) {
        if (where.id && c.id !== where.id) continue;
        if (where.projectId && c.projectId !== where.projectId) continue;
        if (where.provider && c.provider !== where.provider) continue;
        return c;
      }
      return null;
    }
  };

  self.communicationThread = {
    upsert: async (args: any) => {
      const key = args.where.connectorId_providerThreadId;
      for (const t of store.communicationThreads.values()) {
        if (t.connectorId === key.connectorId && t.providerThreadId === key.providerThreadId) {
          Object.assign(t, args.update);
          return t;
        }
      }
      const id = genId("thread");
      const thread = { id, ...args.create };
      store.communicationThreads.set(id, thread);
      return thread;
    },
    update: async (args: any) => {
      const t = store.communicationThreads.get(args.where.id);
      if (t) Object.assign(t, args.data);
      return t;
    },
    findMany: async (args: any) => {
      const where = args?.where ?? {};
      let threads = Array.from(store.communicationThreads.values());
      if (where.projectId) threads = threads.filter((t: any) => t.projectId === where.projectId);
      if (where.id?.in) threads = threads.filter((t: any) => where.id.in.includes(t.id));
      return threads;
    },
    count: async (args: any) => {
      const where = args?.where ?? {};
      let threads = Array.from(store.communicationThreads.values());
      if (where.projectId) threads = threads.filter((t: any) => t.projectId === where.projectId);
      if (where.id?.in) threads = threads.filter((t: any) => where.id.in.includes(t.id));
      else if (where.id) threads = threads.filter((t: any) => t.id === where.id);
      return threads.length;
    }
  };

  self.communicationMessage = {
    findUnique: async (args: any) => {
      const where = args?.where ?? {};
      if (where.connectorId_providerMessageId) {
        const { connectorId, providerMessageId } = where.connectorId_providerMessageId;
        for (const m of store.communicationMessages.values()) {
          if (m.connectorId === connectorId && m.providerMessageId === providerMessageId) return m;
        }
        return null;
      }
      return store.communicationMessages.get(where.id) ?? null;
    },
    findUniqueOrThrow: async (args: any) => {
      const where = args?.where ?? {};
      const m = store.communicationMessages.get(where.id);
      if (!m) throw new Error(`Message ${where.id} not found`);
      if (args?.include?.thread) {
        return { ...m, thread: store.communicationThreads.get(m.threadId) ?? null, attachments: [] };
      }
      return m;
    },
    create: async (args: any) => {
      const id = genId("msg");
      const m = { id, isDeletedByProvider: false, isEdited: false, ...args.data };
      store.communicationMessages.set(id, m);
      return m;
    },
    update: async (args: any) => {
      const m = store.communicationMessages.get(args.where.id);
      if (m) Object.assign(m, args.data);
      return m;
    },
    findMany: async (args: any) => {
      const where = args?.where ?? {};
      let msgs = Array.from(store.communicationMessages.values());
      if (where.projectId) msgs = msgs.filter((m: any) => m.projectId === where.projectId);
      if (where.id?.in) msgs = msgs.filter((m: any) => where.id.in.includes(m.id));
      if (where.isDeletedByProvider !== undefined) msgs = msgs.filter((m: any) => m.isDeletedByProvider === where.isDeletedByProvider);
      if (args?.include?.thread) {
        return msgs.map((m: any) => ({
          ...m,
          sentAt: m.sentAt instanceof Date ? m.sentAt : new Date(m.sentAt),
          thread: store.communicationThreads.get(m.threadId) ?? null,
          attachments: []
        }));
      }
      return msgs.map((m: any) => ({ ...m, sentAt: m.sentAt instanceof Date ? m.sentAt : new Date(m.sentAt) }));
    },
    count: async (args: any) => {
      const where = args?.where ?? {};
      let msgs = Array.from(store.communicationMessages.values());
      if (where.projectId) msgs = msgs.filter((m: any) => m.projectId === where.projectId);
      if (where.id?.in) msgs = msgs.filter((m: any) => where.id.in.includes(m.id));
      return msgs.length;
    }
  };

  self.communicationMessageRevision = {
    findFirst: async () => null,
    create: async (args: any) => {
      const id = genId("rev");
      const rev = { id, ...args.data };
      store.communicationMessageRevisions.set(id, rev);
      return rev;
    }
  };

  self.communicationAttachment = {
    upsert: vi.fn().mockResolvedValue({ id: genId("att") })
  };

  self.communicationMessageChunk = {
    findMany: vi.fn().mockResolvedValue([]),
    create: async (args: any) => {
      const id = genId("chunk");
      const chunk = { id, ...args.data };
      store.communicationMessageChunks.set(id, chunk);
      return chunk;
    }
  };

  self.messageInsight = {
    upsert: async (args: any) => {
      const { messageId, bodyHash } = args.where.messageId_bodyHash;
      for (const insight of store.messageInsights.values()) {
        if (insight.messageId === messageId && insight.bodyHash === bodyHash) {
          Object.assign(insight, args.update);
          return insight;
        }
      }
      const id = genId("insight");
      const insight = { id, generatedProposalId: null, generatedDecisionId: null, ...args.create };
      store.messageInsights.set(id, insight);
      return insight;
    },
    findFirstOrThrow: async (args: any) => {
      const where = args?.where ?? {};
      for (const insight of store.messageInsights.values()) {
        if (where.id && insight.id !== where.id) continue;
        if (where.projectId && insight.projectId !== where.projectId) continue;
        if (!args?.include) return insight;
        const result = { ...insight };
        if (args.include.message) result.message = store.communicationMessages.get(insight.messageId) ?? null;
        if (args.include.thread) result.thread = store.communicationThreads.get(insight.threadId) ?? null;
        if (args.include.generatedProposal !== undefined) {
          const p = insight.generatedProposalId ? store.specChangeProposals.get(insight.generatedProposalId) : null;
          if (p && args.include.generatedProposal?.include?.links) {
            result.generatedProposal = {
              ...p,
              links: Array.from(store.specChangeLinks.values()).filter((l: any) => l.specChangeProposalId === p.id),
              decisionRecord: p.decisionRecordId ? store.decisionRecords.get(p.decisionRecordId) ?? null : null
            };
          } else {
            result.generatedProposal = p ?? null;
          }
        }
        if (args.include.generatedDecision !== undefined) {
          result.generatedDecision = insight.generatedDecisionId
            ? store.decisionRecords.get(insight.generatedDecisionId) ?? null
            : null;
        }
        return result;
      }
      throw new Error(`MessageInsight not found: ${JSON.stringify(where)}`);
    },
    update: async (args: any) => {
      const insight = store.messageInsights.get(args.where.id);
      if (insight) Object.assign(insight, args.data);
      return insight;
    },
    updateMany: async (args: any) => {
      const where = args?.where ?? {};
      let count = 0;
      for (const insight of store.messageInsights.values()) {
        if (where.id && insight.id !== where.id) continue;
        if (where.projectId && insight.projectId !== where.projectId) continue;
        Object.assign(insight, args.data);
        count += 1;
      }
      return { count };
    }
  };

  self.specChangeProposal = {
    create: async (args: any) => {
      const id = genId("proposal");
      const proposal = {
        id,
        status: "needs_review",
        acceptedAt: null,
        acceptedBy: null,
        decisionRecordId: null,
        acceptedBrainVersionId: null,
        externalEvidenceRefsJson: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.data
      };
      store.specChangeProposals.set(id, proposal);
      return proposal;
    },
    findFirstOrThrow: async (args: any) => {
      const where = args?.where ?? {};
      for (const p of store.specChangeProposals.values()) {
        if (where.id && p.id !== where.id) continue;
        if (where.projectId && p.projectId !== where.projectId) continue;
        if (!args?.include) return p;
        const links = Array.from(store.specChangeLinks.values()).filter((l: any) => l.specChangeProposalId === p.id);
        const decisionRecord = p.decisionRecordId ? (store.decisionRecords.get(p.decisionRecordId) ?? null) : null;
        return { ...p, links, decisionRecord };
      }
      throw new Error(`SpecChangeProposal not found: ${JSON.stringify(where)}`);
    },
    findFirst: async (args: any) => {
      const where = args?.where ?? {};
      for (const p of store.specChangeProposals.values()) {
        if (where.id && p.id !== where.id) continue;
        if (where.projectId && p.projectId !== where.projectId) continue;
        if (where.status && p.status !== where.status) continue;
        if (!args?.include) return p;
        const links = Array.from(store.specChangeLinks.values()).filter((l: any) => l.specChangeProposalId === p.id);
        return { ...p, links };
      }
      return null;
    },
    findMany: async (args: any) => {
      const where = args?.where ?? {};
      let proposals = Array.from(store.specChangeProposals.values());
      if (where.projectId) proposals = proposals.filter((p: any) => p.projectId === where.projectId);
      if (where.proposalType) proposals = proposals.filter((p: any) => p.proposalType === where.proposalType);
      if (where.status?.in) proposals = proposals.filter((p: any) => where.status.in.includes(p.status));
      if (where.OR) {
        proposals = proposals.filter((p: any) =>
          where.OR.some((condition: any) => {
            if (condition.title?.contains) return p.title?.toLowerCase().includes(condition.title.contains.toLowerCase());
            if (condition.summary?.contains) return p.summary?.toLowerCase().includes(condition.summary.contains.toLowerCase());
            return false;
          })
        );
      }
      return proposals.map((p: any) => {
        if (!args?.include?.links) return p;
        return { ...p, links: Array.from(store.specChangeLinks.values()).filter((l: any) => l.specChangeProposalId === p.id) };
      });
    },
    update: async (args: any) => {
      const p = store.specChangeProposals.get(args.where.id);
      if (p) {
        Object.assign(p, args.data);
        p.updatedAt = new Date();
      }
      return p;
    },
    updateMany: async (args: any) => {
      let count = 0;
      for (const p of store.specChangeProposals.values()) {
        if (args.where.id && p.id !== args.where.id) continue;
        if (args.where.projectId && p.projectId !== args.where.projectId) continue;
        if (args.where.status && p.status !== args.where.status) continue;
        if (args.where.updatedAt && p.updatedAt?.getTime() !== args.where.updatedAt.getTime()) continue;
        Object.assign(p, args.data);
        p.updatedAt = new Date();
        count += 1;
      }
      return { count };
    }
  };

  self.specChangeLink = {
    createMany: async (args: any) => {
      for (const data of args.data) {
        const id = genId("link");
        store.specChangeLinks.set(id, { id, ...data });
      }
      return { count: args.data.length };
    },
    findMany: async (args: any) => {
      const where = args?.where ?? {};
      let links = Array.from(store.specChangeLinks.values());
      if (where.projectId) links = links.filter((l: any) => l.projectId === where.projectId);
      if (where.linkType && typeof where.linkType === "string") links = links.filter((l: any) => l.linkType === where.linkType);
      if (where.linkType?.in) links = links.filter((l: any) => where.linkType.in.includes(l.linkType));
      if (where.linkRefId?.in) links = links.filter((l: any) => where.linkRefId.in.includes(l.linkRefId));
      if (where.specChangeProposalId?.in) links = links.filter((l: any) => where.specChangeProposalId.in.includes(l.specChangeProposalId));
      if (where.proposal?.status) {
        links = links.filter((l: any) => {
          const p = store.specChangeProposals.get(l.specChangeProposalId);
          return p?.status === where.proposal.status;
        });
      }
      if (!args?.include?.proposal) return links;
      return links.map((link: any) => {
        const p = store.specChangeProposals.get(link.specChangeProposalId);
        if (!p) return link;
        const decisionRecord =
          args.include.proposal?.include?.decisionRecord && p.decisionRecordId
            ? (store.decisionRecords.get(p.decisionRecordId) ?? null)
            : null;
        return { ...link, proposal: { ...p, decisionRecord } };
      });
    }
  };

  self.artifactVersion = {
    findFirst: async (args: any) => {
      const where = args?.where ?? {};
      for (const a of store.artifactVersions.values()) {
        if (where.projectId && a.projectId !== where.projectId) continue;
        if (where.artifactType && a.artifactType !== where.artifactType) continue;
        if (where.status && a.status !== where.status) continue;
        return a;
      }
      return null;
    },
    findUnique: async (args: any) => store.artifactVersions.get(args?.where?.id) ?? null,
    create: async (args: any) => {
      const id = genId("artifact");
      const a = { id, createdAt: new Date(), ...args.data };
      store.artifactVersions.set(id, a);
      return a;
    },
    updateMany: async (args: any) => {
      const where = args?.where ?? {};
      let count = 0;
      for (const a of store.artifactVersions.values()) {
        if (where.projectId && a.projectId !== where.projectId) continue;
        if (where.artifactType && a.artifactType !== where.artifactType) continue;
        if (where.status && a.status !== where.status) continue;
        Object.assign(a, args.data);
        count++;
      }
      return { count };
    }
  };

  self.brainNode = {
    findMany: async (args: any) => {
      const where = args?.where ?? {};
      let nodes = Array.from(store.brainNodes.values());
      if (where.projectId) nodes = nodes.filter((n: any) => n.projectId === where.projectId);
      if (where.artifactVersionId) nodes = nodes.filter((n: any) => n.artifactVersionId === where.artifactVersionId);
      return nodes;
    },
    count: async (args: any) => {
      const where = args?.where ?? {};
      let nodes = Array.from(store.brainNodes.values());
      if (where.projectId) nodes = nodes.filter((n: any) => n.projectId === where.projectId);
      if (where.id?.in) nodes = nodes.filter((n: any) => where.id.in.includes(n.id));
      return nodes.length;
    },
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 })
  };

  self.document = {
    findFirstOrThrow: async (args: any) => {
      const where = args?.where ?? {};
      for (const d of store.documents.values()) {
        if (where.id && d.id !== where.id) continue;
        if (where.projectId && d.projectId !== where.projectId) continue;
        return d;
      }
      throw new Error("Document not found");
    }
  };

  self.documentVersion = {
    findFirstOrThrow: async (args: any) => {
      const where = args?.where ?? {};
      for (const v of store.documentVersions.values()) {
        if (where.id && v.id !== where.id) continue;
        if (where.documentId && v.documentId !== where.documentId) continue;
        if (where.projectId && v.projectId !== where.projectId) continue;
        return v;
      }
      throw new Error("DocumentVersion not found");
    },
    findFirst: async (args: any) => {
      const where = args?.where ?? {};
      for (const v of store.documentVersions.values()) {
        if (where.documentId && v.documentId !== where.documentId) continue;
        if (where.projectId && v.projectId !== where.projectId) continue;
        if (where.status?.in && !where.status.in.includes(v.status)) continue;
        return v;
      }
      return null;
    }
  };

  self.documentSection = {
    count: async (args: any) => {
      const where = args?.where ?? {};
      let sections = Array.from(store.documentSections.values());
      if (where.projectId) sections = sections.filter((s: any) => s.projectId === where.projectId);
      if (where.id?.in) sections = sections.filter((s: any) => where.id.in.includes(s.id));
      if (where.documentVersionId) sections = sections.filter((s: any) => s.documentVersionId === where.documentVersionId);
      if (where.parseRevision !== undefined) sections = sections.filter((s: any) => s.parseRevision === where.parseRevision);
      return sections.length;
    },
    findMany: async (args: any) => {
      const where = args?.where ?? {};
      let sections = Array.from(store.documentSections.values());
      if (where.documentVersionId) sections = sections.filter((s: any) => s.documentVersionId === where.documentVersionId);
      if (where.parseRevision !== undefined) sections = sections.filter((s: any) => s.parseRevision === where.parseRevision);
      sections.sort((a: any, b: any) => a.orderIndex - b.orderIndex);
      const skip = args?.skip ?? 0;
      const take = args?.take ?? sections.length;
      return sections.slice(skip, skip + take);
    }
  };

  self.decisionRecord = {
    findFirst: async () => null,
    create: async (args: any) => {
      const id = genId("decision");
      const d = { id, createdAt: new Date(), ...args.data };
      store.decisionRecords.set(id, d);
      return d;
    },
    update: async (args: any) => {
      const d = store.decisionRecords.get(args.where.id);
      if (d) Object.assign(d, args.data);
      return d;
    }
  };

  self.dashboardSnapshot = {
    findFirst: async () => null,
    create: async (args: any) => {
      const id = genId("snapshot");
      const s = { id, computedAt: new Date(), ...args.data };
      store.dashboardSnapshots.set(id, s);
      return s;
    },
    update: async (args: any) => {
      const s = store.dashboardSnapshots.get(args.where.id);
      if (s) Object.assign(s, args.data);
      return s;
    }
  };

  self.liveDocSectionDraft = {
    findFirst: async () => null,
    update: async () => null,
    updateMany: async () => ({ count: 0 })
  };

  self.liveDocSectionRevision = {
    upsert: async () => null
  };

  self.jobRun = {
    upsert: async (args: any) => {
      const key = args.where.idempotencyKey;
      const existing = store.jobRuns.get(key);
      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }
      const newRun = { id: genId("job"), ...args.create };
      store.jobRuns.set(key, newRun);
      return newRun;
    },
    update: async (args: any) => {
      const key = args.where.idempotencyKey;
      const run = store.jobRuns.get(key);
      if (run) Object.assign(run, args.data);
      return run;
    }
  };

  return self;
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("Launch-gate loop: Ingest → Classify → Propose → Accept → Apply → Overlay → Retrieve → Dashboard", () => {
  let store: ReturnType<typeof createStore>;
  let prisma: any;

  let ingestionSvc: MessageIngestionService;
  let insightsSvc: MessageInsightsService;
  let proposalsSvc: CommunicationProposalsService;
  let changeSvc: ChangeProposalService;
  let documentSvc: DocumentService;
  let dashboardSvc: DashboardService;

  let threadId: string;
  let messageId: string;
  let insightId: string;
  let proposalId: string;

  beforeAll(() => {
    idSeq = 0;
    store = createStore();
    seedStore(store);
    prisma = buildMockPrisma(store);

    const jobs = { enqueue: vi.fn() };
    const auditSvc = new AuditService(prisma);
    const projectSvc = new ProjectService(prisma, auditSvc, jobs);

    const mockBrainSvc = {
      generateBrainGraph: vi.fn().mockResolvedValue(undefined),
      generateProductBrain: vi.fn().mockImplementation(async () => {
        // Supersede brain v1
        const v1 = store.artifactVersions.get(BRAIN_V1_ID);
        if (v1) v1.status = "superseded";
        // Create brain v2
        const v2 = {
          id: BRAIN_V2_ID,
          projectId: P_ID,
          orgId: ORG_ID,
          artifactType: "product_brain",
          status: "accepted",
          versionNumber: 2,
          payloadJson: { whatTheProductIs: "Updated product brain v2", mainFlows: [], modules: [], constraints: [], integrations: [] },
          acceptedAt: new Date(),
          createdAt: new Date()
        };
        store.artifactVersions.set(BRAIN_V2_ID, v2);
        return v2;
      })
    } as unknown as BrainService;

    const mockImpactResolver = {
      buildMessageContext: vi.fn().mockImplementation(async (_projectId: string, msgId: string) => {
        const msg = store.communicationMessages.get(msgId);
        const thread = msg ? store.communicationThreads.get(msg.threadId) : null;
        return {
          target: {
            id: msgId,
            bodyText: msg?.bodyText ?? "",
            bodyHash: msg?.bodyHash ?? "hash-1",
            connectorId: msg?.connectorId ?? CONNECTOR_ID,
            provider: msg?.provider ?? "fireflies_ai"
          },
          thread: { id: thread?.id ?? "t-unknown", subject: thread?.subject ?? "Weekly Sync" },
          threadMessages: [
            {
              senderLabel: msg?.senderLabel ?? "PM",
              sentAt: msg?.sentAt instanceof Date ? msg.sentAt : new Date(msg?.sentAt ?? Date.now()),
              bodyText: msg?.bodyText ?? ""
            }
          ],
          acceptedProductBrainSummary: "A product management brain for client-facing teams",
          candidateSections: [{ id: SECTION_ID, documentVersionId: DOC_VER_ID, normalizedText: "Auth approval flow", headingPath: ["Authentication"] }],
          candidateBrainNodes: [{ id: BRAIN_NODE_ID, nodeKey: "auth-approval", title: "Auth Approval Flow", bodyText: "Two-manager approval required" }],
          acceptedChanges: [],
          acceptedDecisions: [],
          unresolvedProposals: [],
          threadStateHash: "thread-state-hash-001"
        };
      })
    };

    const mockGenerationProvider = {
      generateObject: vi.fn().mockResolvedValue({
        insightType: "requirement_change",
        confidence: 0.9,
        proposalType: "requirement_change",
        summary: "Auth approval flow should require explicit manager sign-off before account activation",
        shouldCreateProposal: true,
        shouldCreateDecision: false,
        decisionStatement: null,
        affectedDocumentSections: [{ id: SECTION_ID, confidence: 0.9 }],
        affectedBrainNodes: [{ id: BRAIN_NODE_ID, confidence: 0.88 }],
        oldUnderstanding: { text: "Two-manager approval on activation" },
        newUnderstanding: { text: "Explicit manager sign-off required during approval flow" },
        impactSummary: { scope: "auth", severity: "medium" },
        uncertainty: []
      }),
      constructor: { name: "MockGenerationProvider" }
    };

    const mockTelemetry = { increment: vi.fn(), observeDuration: vi.fn() };

    proposalsSvc = new CommunicationProposalsService(prisma, projectSvc, auditSvc, jobs);

    insightsSvc = new MessageInsightsService(
      prisma,
      mockGenerationProvider as any,
      projectSvc,
      auditSvc,
      jobs,
      mockImpactResolver as any,
      proposalsSvc,
      mockTelemetry as any,
      {
        SOCRATES_MAX_CLASSIFICATION_JOBS_PER_PROJECT: 2_000,
        BETA_COMMUNICATION_AUTO_CANDIDATES_ENABLED: true,
        BETA_COMMUNICATION_AUTO_PROPOSALS_ENABLED: true
      } as any
    );

    ingestionSvc = new MessageIngestionService(prisma, jobs);

    changeSvc = new ChangeProposalService(prisma, jobs, projectSvc, mockBrainSvc, auditSvc);

    documentSvc = new DocumentService(
      prisma,
      { upload: vi.fn(), getSignedUrl: vi.fn() } as any,
      jobs,
      { embedText: vi.fn().mockResolvedValue([0.1, 0.2]) } as any,
      { transcribe: vi.fn() } as any,
      projectSvc,
      auditSvc,
      mockTelemetry as any
    );

    dashboardSvc = new DashboardService(prisma, projectSvc, auditSvc, mockTelemetry as any);
  });

  // ─── Stage C: Ingest ─────────────────────────────────────────────────────────
  it("Stage C: Fireflies transcript ingest normalizes evidence into thread + message, marking non-deleted", async () => {
    const result = await ingestionSvc.ingestNormalizedBatch({
      projectId: P_ID,
      connectorId: CONNECTOR_ID,
      provider: "fireflies_ai",
      threads: [
        {
          providerThreadId: PROVIDER_THREAD_ID,
          subject: "Client Kickoff Transcript",
          participants: [{ label: "Sarah Client", email: "sarah@example.com" }],
          startedAt: "2026-04-15T10:00:00.000Z",
          lastMessageAt: "2026-04-15T10:30:00.000Z"
        }
      ],
      messages: [
        {
          providerMessageId: PROVIDER_MSG_ID,
          senderLabel: "Fireflies.ai transcript",
          senderEmail: null,
          sentAt: "2026-04-15T10:15:00.000Z",
          bodyText:
            "[00:12:04] Sarah Client: Final decision: require explicit manager sign-off before any account activation in the auth flow.",
          bodyHtml: null,
          messageType: "note",
          replyToProviderMessageId: null,
          rawMetadata: {
            fireflies: {
              transcriptId: "ff-launch-001",
              meetingTitle: "Client Kickoff Transcript",
              aiGenerated: {
                notTruth: true,
                summary: "Fireflies summary says manager sign-off was discussed.",
                actionItems: ["Update launch auth flow"]
              },
              segments: [
                {
                  transcriptId: "ff-launch-001",
                  meetingTitle: "Client Kickoff Transcript",
                  speakerName: "Sarah Client",
                  speakerEmail: "sarah@example.com",
                  startMs: 724000,
                  endMs: 741000,
                  segmentIndex: 0,
                  text: "Final decision: require explicit manager sign-off before any account activation in the auth flow."
                }
              ]
            }
          }
        }
      ]
    });

    expect(result.createdMessageCount).toBe(1);
    expect(result.threadId).toBeTruthy();
    expect(result.messageIds).toHaveLength(1);

    threadId = result.threadId;
    messageId = result.messageIds[0];

    const storedMessage = store.communicationMessages.get(messageId);
    expect(storedMessage).toBeDefined();
    expect(storedMessage.isDeletedByProvider).toBe(false);
    expect(storedMessage.bodyText).toContain("explicit manager sign-off");
    expect(storedMessage.provider).toBe("fireflies_ai");
    expect(JSON.stringify(storedMessage.rawMetadataJson)).toContain("\"notTruth\":true");

    const storedThread = store.communicationThreads.get(threadId);
    expect(storedThread).toBeDefined();
    expect(storedThread.subject).toBe("Client Kickoff Transcript");
  });

  // ─── Stage D: Classify ───────────────────────────────────────────────────────
  it("Stage D: classifyMessage produces spec_change insight pointing at seeded section and brain node", async () => {
    const result = await insightsSvc.classifyMessage(P_ID, messageId, MANAGER_ID);

    expect(result.insightType).toBe("requirement_change");
    expect(Number(result.confidence)).toBeGreaterThan(0.8);

    insightId = result.id;
    const stored = store.messageInsights.get(insightId);
    expect(stored).toBeDefined();
    expect(stored.status).toBe("detected");
    expect(stored.shouldCreateProposal).toBe(true);
    expect((stored.affectedRefsJson as any).documentSectionIds).toContain(SECTION_ID);
    expect((stored.affectedRefsJson as any).brainNodeIds).toContain(BRAIN_NODE_ID);
  });

  // ─── Stage E: Create proposal ────────────────────────────────────────────────
  it("Stage E: autoCreateProposal creates proposal with sourceMessageCount=1 and all 4 link types", async () => {
    const result = await insightsSvc.autoCreateProposal(P_ID, insightId);
    expect(result.proposalId).toBeTruthy();

    if (!result.proposalId) {
      throw new Error("Expected autoCreateProposal to create a proposal in the launch gate fixture");
    }
    proposalId = result.proposalId;
    const storedProposal = store.specChangeProposals.get(proposalId);
    expect(storedProposal).toBeDefined();
    expect(storedProposal.status).toBe("needs_review");
    expect(storedProposal.sourceMessageCount).toBe(1);

    const links = Array.from(store.specChangeLinks.values()).filter((l: any) => l.specChangeProposalId === proposalId);
    const linkTypes = links.map((l: any) => l.linkType);
    expect(linkTypes).toContain("message");
    expect(linkTypes).toContain("thread");
    expect(linkTypes).toContain("document_section");
    expect(linkTypes).toContain("brain_node");

    const sectionLink = links.find((l: any) => l.linkType === "document_section");
    expect(sectionLink?.linkRefId).toBe(SECTION_ID);

    const nodeLink = links.find((l: any) => l.linkType === "brain_node");
    expect(nodeLink?.linkRefId).toBe(BRAIN_NODE_ID);

    const messageLink = links.find((l: any) => l.linkType === "message");
    expect(messageLink?.linkRefId).toBe(messageId);

    // Insight should now reference the proposal
    const storedInsight = store.messageInsights.get(insightId);
    expect(storedInsight?.generatedProposalId).toBe(proposalId);
  });

  // ─── Stage F security: dev rejected ──────────────────────────────────────────
  it("Stage F security: dev user accept() is rejected with 403", async () => {
    await expect(changeSvc.accept(P_ID, proposalId, DEV_ID)).rejects.toMatchObject({
      statusCode: 403
    });
    // Proposal still needs_review
    expect(store.specChangeProposals.get(proposalId)?.status).toBe("needs_review");
  });

  // ─── Stage F: Accept ──────────────────────────────────────────────────────────
  it("Stage F: manager accept() marks proposal accepted and passes provenance validation", async () => {
    const result = await changeSvc.accept(P_ID, proposalId, MANAGER_ID);

    expect(result.status).toBe("accepted");
    expect(result.acceptedBy).toBe(MANAGER_ID);
    expect(result.acceptedAt).toBeTruthy();

    const storedProposal = store.specChangeProposals.get(proposalId);
    expect(storedProposal?.status).toBe("accepted");
    expect(storedProposal?.acceptedBy).toBe(MANAGER_ID);
  });

  // ─── Stage G: Apply ───────────────────────────────────────────────────────────
  it("Stage G: applyAcceptedProposal generates brain v2, supersedes v1, sets acceptedBrainVersionId", async () => {
    await changeSvc.applyAcceptedProposal(P_ID, proposalId);

    const brainV1 = store.artifactVersions.get(BRAIN_V1_ID);
    const brainV2 = store.artifactVersions.get(BRAIN_V2_ID);

    expect(brainV1?.status).toBe("superseded");
    expect(brainV2).toBeDefined();
    expect(brainV2?.status).toBe("accepted");
    expect(brainV2?.versionNumber).toBe(2);

    const storedProposal = store.specChangeProposals.get(proposalId);
    expect(storedProposal?.acceptedBrainVersionId).toBe(BRAIN_V2_ID);
  });

  // ─── Stage G immutability ─────────────────────────────────────────────────────
  it("Stage G immutability: original document version raw text is unchanged", () => {
    const section = store.documentSections.get(SECTION_ID);
    expect(section?.normalizedText).toContain("two managers");
  });

  // ─── Stage H: Viewer overlay ──────────────────────────────────────────────────
  it("Stage H: getViewerPayload returns change markers with proposalId for the affected section", async () => {
    const payload = await documentSvc.getViewerPayload(P_ID, DOC_ID, MANAGER_ID, {});

    expect(payload.sections).toBeDefined();
    expect(payload.sections.length).toBeGreaterThan(0);

    const authSection = payload.sections.find((s: any) => s.sectionId === SECTION_ID);
    expect(authSection).toBeDefined();
    expect(authSection!.changeMarkers.length).toBeGreaterThan(0);
    expect(authSection!.changeMarkers[0].changeProposalId).toBe(proposalId);
    expect(authSection!.hasCurrentTruthOverlay).toBe(true);

    // Manager should see message refs, not client-blocked
    expect(authSection!.linkedMessageRefs).toBeDefined();
  });

  // ─── Stage I: Socrates retrieval ──────────────────────────────────────────────
  it("Stage I: hybridRetrieve with includeCommunications returns the ingested message", async () => {
    // Set up chunk query mock to return our message
    const chunkSql = `message_id = '${messageId}'`;
    prisma.$queryRawUnsafe = vi.fn().mockResolvedValue([
      {
        message_id: messageId,
        thread_id: threadId,
        content: "Final decision from Fireflies transcript: explicit manager sign-off before account activation",
        contextual_content: "Client Kickoff Transcript Sarah Client 00:12:04 explicit manager sign-off before account activation",
        lexical_content: "Client Kickoff Transcript Sarah Client 00:12:04 explicit manager sign-off before account activation",
        sender_label: "Fireflies.ai transcript",
        subject: "Client Kickoff Transcript",
        vec_dist: 0.07
      }
    ]);

    const embedProvider = { embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };

    const results = await hybridRetrieve(prisma, embedProvider as any, ORG_ID, {
      projectId: P_ID,
      query: "Does the auth flow require manager approval?",
      queryEmbedding: [0.1, 0.2, 0.3],
      intent: "original_source",
      domains: {
        includeDocuments: false,
        includeBrainNodes: false,
        includeProductBrain: false,
        includeChanges: false,
        includeDecisions: false,
        includeDashboard: false,
        includeCommunications: true
      },
      topK: 5,
      minScore: 0,
      isClientContext: false,
      acceptedTruthBoost: 1.2,
      docWeight: 1,
      commWeight: 0.8
    });

    expect(results.length).toBeGreaterThan(0);
    const commResult = results.find((r: any) => r.id === messageId);
    expect(commResult).toBeDefined();
    expect(commResult!.sourceType).toBe("communication_message");
  });

  // ─── Stage J: Dashboard ───────────────────────────────────────────────────────
  it("Stage J: getProjectDashboard shows accepted change and fresh brain", async () => {
    const dashboard = await dashboardSvc.getProjectDashboard(P_ID, MANAGER_ID, { forceRefresh: true });

    expect(dashboard.changes.acceptedRecentCount).toBeGreaterThan(0);
    expect(dashboard.brain.latestVersionId).toBe(BRAIN_V2_ID);
    expect(dashboard.brain.freshnessState).toBe("current");
  });
});
