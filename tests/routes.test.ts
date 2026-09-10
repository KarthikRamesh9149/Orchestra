import jwt from "jsonwebtoken";
import pino from "pino";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp, redactSensitiveUrlForLogging } from "../src/app/build-app.js";
import { AppError } from "../src/app/errors.js";
import type { AppContext } from "../src/types/index.js";

const VALID_CLIENT_SHARE_TOKEN = `cs_${"a".repeat(43)}`;
const PROJECT_ID = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";

function normalizeSetCookie(value: string | string[] | undefined) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cookieHeader(value: string | string[] | undefined) {
  return normalizeSetCookie(value)
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

function createToken(role: "manager" | "dev" | "client") {
  const userIdByRole = {
    manager: "user-1",
    dev: "dev-user-1",
    client: "client-user-1"
  } satisfies Record<"manager" | "dev" | "client", string>;
  return jwt.sign(
    {
      userId: userIdByRole[role],
      orgId: "org-1",
      workspaceRoleDefault: role,
      globalRole: "owner",
      typ: "access"
    },
    "test-access-secret"
  );
}

function createContext() {
  const authService = {
    signup: vi.fn(async () => ({
      user: {
        id: "user-1",
        orgId: "org-1",
        email: "manager@example.com",
        displayName: "Manager",
        globalRole: "owner",
        workspaceRoleDefault: "manager"
      },
      accessToken: "access",
      refreshToken: "refresh"
    })),
    login: vi.fn(async () => ({
      user: {
        id: "user-1",
        orgId: "org-1",
        email: "manager@example.com",
        displayName: "Manager",
        globalRole: "owner",
        workspaceRoleDefault: "manager"
      },
      accessToken: "access",
      refreshToken: "refresh"
    })),
    completeInvitationAccount: vi.fn(async () => ({
      user: {
        id: "invitee-1",
        orgId: "org-1",
        email: "invitee@example.com",
        displayName: "Invitee",
        globalRole: "member",
        workspaceRoleDefault: "dev"
      },
      invitation: {
        redemptionId: "redemption-1",
        organizationId: "org-1",
        projectId: PROJECT_ID,
        projectName: "Beta Project"
      },
      accessToken: "invite-access",
      refreshToken: "invite-refresh"
    })),
    redeemInvitationForExistingAccount: vi.fn(async () => ({
      user: {
        id: "invitee-1",
        orgId: "org-1",
        email: "invitee@example.com",
        displayName: "Invitee",
        globalRole: "member",
        workspaceRoleDefault: "dev"
      },
      invitation: {
        redemptionId: "redemption-1",
        organizationId: "org-1",
        projectId: PROJECT_ID,
        projectName: "Beta Project"
      },
      accessToken: "invite-access",
      refreshToken: "invite-refresh"
    })),
    joinWorkspace: vi.fn(async (input: any) => ({
      user: {
        id: "invitee-1",
        orgId: "org-1",
        email: input.email,
        displayName: input.displayName,
        globalRole: "member",
        workspaceRoleDefault: "dev"
      },
      invitation: {
        redemptionId: "redemption-1",
        organizationId: "org-1",
        projectId: PROJECT_ID,
        projectName: "Beta Project"
      },
      accessToken: "invite-access",
      refreshToken: "invite-refresh"
    })),
    refresh: vi.fn(async () => ({ accessToken: "access-2", refreshToken: "refresh-2" })),
    logout: vi.fn(async () => undefined),
    assertSessionActive: vi.fn(async () => undefined),
    authorizeSessionContext: vi.fn(async () => ({
      organizationMembershipId: "org-membership-1",
      userId: "user-1",
      orgId: "org-1",
      globalRole: "owner",
      workspaceRoleDefault: "manager"
    })),
    getMe: vi.fn(async () => ({ id: "user-1", orgId: "org-1" })),
    requestEmailVerification: vi.fn(async () => ({ status: "sent", provider: "gmail", errorCode: null, expiresAt: new Date("2026-08-25T04:00:00.000Z") })),
    confirmEmailVerification: vi.fn(async () => ({ verified: true, emailVerifiedAt: new Date("2026-08-25T03:00:00.000Z") })),
    changePassword: vi.fn(async () => ({ changed: true, sessionsRevoked: true })),
    switchSessionContext: vi.fn(async () => ({
      accessToken: "switched-access",
      refreshToken: "switched-refresh",
      clientType: "bearer",
      user: {
        id: "user-1",
        orgId: "org-1",
        email: "manager@example.com",
        displayName: "Manager",
        globalRole: "owner",
        workspaceRoleDefault: "manager",
        emailVerified: false
      }
    }))
  };

  const projectService = {
    createProject: vi.fn(async () => ({ id: "project-1", name: "Project" })),
    listProjects: vi.fn(async () => [{ id: "project-1" }]),
    getProject: vi.fn(async () => ({ id: "project-1" })),
    getProjectSettings: vi.fn(async () => ({
      projectId: PROJECT_ID,
      organizationId: "org-1",
      name: "Beta Project",
      slug: "beta-project",
      description: "Private pilot workspace",
      status: "active",
      planLabel: "Private pilot",
      avatarUrl: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      owner: { memberId: "member-1", userId: "user-1", displayName: "Manager", email: "manager@example.com" },
      managerSummary: { count: 1, labels: ["Manager"] },
      featureFlags: { privatePilot: true, billing: false }
    })),
    getProjectSettingsBundle: vi.fn(async () => ({
      settings: {
        projectId: PROJECT_ID,
        organizationId: "org-1",
        name: "Beta Project",
        slug: "beta-project",
        description: "Private pilot workspace",
        status: "active",
        planLabel: "Private pilot",
        avatarUrl: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
        owner: { memberId: "member-1", userId: "user-1", displayName: "Manager", email: "manager@example.com" },
        managerSummary: { count: 1, labels: ["Manager"] },
        featureFlags: { privatePilot: true, billing: false }
      },
      members: [],
      joinCodes: [],
      approvers: [{ id: "member-1", projectRole: "manager", canApproveTruthChanges: true }]
    })),
    updateProjectSettings: vi.fn(async () => ({
      projectId: PROJECT_ID,
      organizationId: "org-1",
      name: "Updated Beta Project",
      slug: "updated-beta-project",
      description: "Updated private pilot workspace",
      status: "active",
      planLabel: "Private pilot",
      avatarUrl: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      owner: { memberId: "member-1", userId: "user-1", displayName: "Manager", email: "manager@example.com" },
      managerSummary: { count: 1, labels: ["Manager"] },
      featureFlags: { privatePilot: true, billing: false }
    })),
    getMembers: vi.fn(async () => ({ members: [], summary: { headcount: 0, roleSummary: {} } })),
    createJoinCode: vi.fn(async () => ({
      id: "11111111-2222-4333-8444-555555555555",
      projectId: PROJECT_ID,
      code: "ORCH-ABC123-DEF456",
      codePrefix: "ORCH-ABC123",
      projectRole: "dev",
      invitedEmail: "dev@example.com",
      maxUses: 1,
      useCount: 0,
      expiresAt: "2026-06-01T00:00:00.000Z",
      revokedAt: null,
      createdAt: "2026-05-01T00:00:00.000Z"
    })),
    listJoinCodes: vi.fn(async () => [
      {
        id: "11111111-2222-4333-8444-555555555555",
        projectId: PROJECT_ID,
        codePrefix: "ORCH-ABC123",
        projectRole: "dev",
        invitedEmail: "dev@example.com",
        maxUses: 1,
        useCount: 0,
        expiresAt: "2026-06-01T00:00:00.000Z",
        revokedAt: null,
        createdAt: "2026-05-01T00:00:00.000Z"
      }
    ]),
    revokeJoinCode: vi.fn(async () => ({
      id: "11111111-2222-4333-8444-555555555555",
      projectId: PROJECT_ID,
      codePrefix: "ORCH-ABC123",
      projectRole: "dev",
      invitedEmail: "dev@example.com",
      maxUses: 1,
      useCount: 0,
      expiresAt: "2026-06-01T00:00:00.000Z",
      revokedAt: "2026-05-02T00:00:00.000Z",
      createdAt: "2026-05-01T00:00:00.000Z"
    })),
    addMember: vi.fn(async () => ({ id: "member-1", projectRole: "dev", isActive: true })),
    updateMember: vi.fn(async () => ({ id: "member-1", projectRole: "dev", isActive: false })),
    listTruthApprovers: vi.fn(async () => [{ id: "member-1", projectRole: "manager", canApproveTruthChanges: true }]),
    grantTruthApprover: vi.fn(async () => ({ id: "member-2", projectRole: "dev", canApproveTruthChanges: true })),
    revokeTruthApprover: vi.fn(async () => ({ id: "member-2", projectRole: "dev", canApproveTruthChanges: false })),
    ensureProjectMemberCanViewProjectAudit: vi.fn(async () => ({ projectRole: "manager", isActive: true })),
    ensureProjectMemberCanMutate: vi.fn(async () => ({ projectRole: "manager", isActive: true })),
    ensureProjectMemberCanUploadContext: vi.fn(async () => ({ projectRole: "manager", isActive: true })),
    ensureProjectMemberCanUseSocrates: vi.fn(async () => ({ projectRole: "manager", isActive: true })),
    ensureProjectMemberCanManageTeamContext: vi.fn(async () => ({ projectRole: "manager", isActive: true })),
    ensureProjectTruthApprover: vi.fn(async (_projectId: string, userId: string) => {
      if (userId === "dev-user-1" || userId === "client-user-1") {
        throw new AppError(403, "Truth approval access required", "forbidden");
      }
      return { projectRole: "manager", isActive: true, canApproveTruthChanges: true };
    })
  };

  const projectResponsibilitiesService = {
    listResponsibilities: vi.fn(async () => ({
      items: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
          memberId: "3322717f-2c10-4239-b525-6fbc9158f4fb",
          assigneeName: null,
          title: "Own frontend",
          description: "Build the MVP frontend shell.",
          area: "frontend",
          status: "open",
          source: "manual",
          assignee: {
            memberId: "3322717f-2c10-4239-b525-6fbc9158f4fb",
            userId: "dev-user-1",
            displayName: "Dev",
            email: "dev@example.com",
            roleInProject: "Frontend"
          },
          createdByUserId: "user-1",
          updatedByUserId: "user-1",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      ],
      meta: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 }
    })),
    createResponsibility: vi.fn(async () => ({
      id: "11111111-1111-1111-1111-111111111111",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      memberId: null,
      assigneeName: "Sara",
      title: "Own frontend",
      description: null,
      area: "frontend",
      status: "open",
      source: "manual",
      assignee: null,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    })),
    getResponsibility: vi.fn(async () => ({
      id: "11111111-1111-1111-1111-111111111111",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      memberId: null,
      assigneeName: "Sara",
      title: "Own frontend",
      description: null,
      area: "frontend",
      status: "open",
      source: "manual",
      assignee: null,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    })),
    updateResponsibility: vi.fn(async () => ({
      id: "11111111-1111-1111-1111-111111111111",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      memberId: null,
      assigneeName: "Sara",
      title: "Own frontend",
      description: null,
      area: "frontend",
      status: "blocked",
      source: "manual",
      assignee: null,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z"
    })),
    deleteResponsibility: vi.fn(async () => ({
      ok: true,
      deletedId: "11111111-1111-1111-1111-111111111111"
    }))
  };

  const projectContextService = {
    listContext: vi.fn(async () => ({
      items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
          type: "decision_note",
          title: "KYC onboarding decision",
          body: "Client PM said onboarding must support KYC before payment setup.",
          sourceDate: null,
          participants: ["Client PM"],
          tags: ["kyc"],
          linkedMemberId: null,
          linkedMember: null,
          importance: "high",
          source: "manual",
          status: "active",
          createdByUserId: "user-1",
          updatedByUserId: "user-1",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
          deletedAt: null,
          attachments: [],
          chunksSummary: { count: 1, lastIndexedAt: "2026-05-01T00:00:00.000Z" }
        }
      ],
      meta: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 }
    })),
    createContext: vi.fn(async () => ({
      id: "22222222-2222-4222-8222-222222222222",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      type: "decision_note",
      title: "KYC onboarding decision",
      body: "Client PM said onboarding must support KYC before payment setup.",
      sourceDate: null,
      participants: ["Client PM"],
      tags: ["kyc"],
      linkedMemberId: null,
      linkedMember: null,
      importance: "high",
      source: "manual",
      status: "active",
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      deletedAt: null,
      attachments: [],
      chunksSummary: { count: 0, lastIndexedAt: null }
    })),
    createContextFromUpload: vi.fn(async () => ({
      id: "22222222-2222-4222-8222-222222222222",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      type: "screenshot_caption",
      title: "WhatsApp onboarding screenshot",
      body: "Caption: WhatsApp screenshot showing onboarding feedback.",
      sourceDate: null,
      participants: [],
      tags: ["whatsapp"],
      linkedMemberId: null,
      linkedMember: null,
      importance: "normal",
      source: "manual",
      status: "active",
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      deletedAt: null,
      attachments: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          attachmentKind: "image",
          originalFilename: "whatsapp.png",
          safeFilename: "whatsapp.png",
          mimeType: "image/png",
          fileSize: "9",
          checksumSha256: "hash",
          caption: "WhatsApp screenshot showing onboarding feedback.",
          description: null,
          storageStatus: "stored"
        }
      ],
      chunksSummary: { count: 0, lastIndexedAt: null }
    })),
    getContext: vi.fn(async () => ({
      id: "22222222-2222-4222-8222-222222222222",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      type: "decision_note",
      title: "KYC onboarding decision",
      body: "Client PM said onboarding must support KYC before payment setup.",
      sourceDate: null,
      participants: ["Client PM"],
      tags: ["kyc"],
      linkedMemberId: null,
      linkedMember: null,
      importance: "high",
      source: "manual",
      status: "active",
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      deletedAt: null,
      attachments: [],
      chunksSummary: { count: 1, lastIndexedAt: "2026-05-01T00:00:00.000Z" }
    })),
    updateContext: vi.fn(async () => ({
      ok: true,
      id: "22222222-2222-4222-8222-222222222222",
      title: "Updated decision"
    })),
    deleteContext: vi.fn(async () => ({ ok: true, deletedId: "22222222-2222-4222-8222-222222222222" })),
    reindexContext: vi.fn(async () => ({ ok: true, contextId: "22222222-2222-4222-8222-222222222222", status: "queued" })),
    getContextAttachmentSignedUrl: vi.fn(async () => ({
      attachmentId: "33333333-3333-4333-8333-333333333333",
      contextId: "22222222-2222-4222-8222-222222222222",
      url: "signed://context-attachment",
      expiresInSeconds: 3600,
      mimeType: "image/png",
      originalFilename: "whatsapp.png"
    })),
    getContextAttachmentFile: vi.fn(async () => ({
      attachmentId: "33333333-3333-4333-8333-333333333333",
      contextId: "22222222-2222-4222-8222-222222222222",
      stream: Readable.from(Buffer.from("synthetic-image")),
      size: 15,
      mimeType: "image/png",
      originalFilename: "whatsapp.png"
    }))
  };

  const documentService = {
    uploadFile: vi.fn(async () => ({ documentId: "doc-1", documentVersionId: "ver-1", status: "pending" })),
    getUploadOperation: vi.fn(async () => ({ documentId: "doc-1", documentVersionId: "ver-1", status: "pending", parseRevision: 1, operationId: "11111111-1111-4111-8111-111111111111" })),
    listDocuments: vi.fn(async () => ({
      items: [{ id: "doc-1" }],
      meta: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1, hasMore: false }
    })),
    getDocument: vi.fn(async () => ({
      id: "doc-1",
      currentVersion: { id: "ver-1", status: "ready", isCurrent: true },
      versions: [{ id: "ver-1", status: "ready", isCurrent: true }]
    })),
    getViewerPayload: vi.fn(async () => ({
      document: { id: "doc-1", title: "Core PRD", kind: "prd", currentVersionId: "ver-1" },
      version: { id: "ver-1", status: "ready" },
      viewerState: { documentId: "doc-1", documentVersionId: "ver-1", anchorId: "overview-1", pageNumber: 1 },
      selected: { source: "anchor", documentId: "doc-1", documentVersionId: "ver-1", sectionId: "sec-1", anchorId: "overview-1", pageNumber: 1, chunkId: null },
      highlight: null,
      sections: [{ sectionId: "sec-1", anchorId: "overview-1", text: "Hello", changeMarkers: [] }],
      meta: { page: 1, pageSize: 50, totalCount: 1, totalPages: 1, hasMore: false }
    })),
    getAnchor: vi.fn(async () => ({
      viewerState: { documentId: "doc-1", documentVersionId: "ver-1", anchorId: "overview-1", pageNumber: 1 },
      selected: { source: "anchor", documentId: "doc-1", documentVersionId: "ver-1", sectionId: "sec-1", anchorId: "overview-1", pageNumber: 1, chunkId: null },
      section: { anchorId: "overview-1" }
    })),
    searchDocument: vi.fn(async () => ({
      items: [{ sectionId: "sec-1", anchorId: "overview-1", snippet: "hello", openTarget: { targetType: "document_section", targetRef: { documentId: "doc-1", documentVersionId: "ver-1", anchorId: "overview-1" } } }],
      meta: { query: "hello", count: 1, versionId: "ver-1", limited: false }
    })),
    getAnchorProvenance: vi.fn(async () => ({
      selectedSection: { anchorId: "overview-1", hasCurrentTruthOverlay: true, currentTruthSummary: ["Updated by accepted change"] },
      supportingSections: [],
      linkedChanges: [],
      linkedBrainNodes: [],
      linkedDecisions: [],
      linkedMessageRefs: [],
      currentTruth: { differsFromSource: true, summaries: ["Updated by accepted change"] },
      openTargets: { selectedSection: { targetType: "document_section", targetRef: { documentId: "doc-1", documentVersionId: "ver-1", anchorId: "overview-1" } }, supportingSections: [] }
    })),
    getMessageEvidence: vi.fn(async () => ({
      message: { id: "msg-1", threadId: "thread-1", bodyText: "Need this change" },
      thread: { id: "thread-1", subject: "Client request" },
      linkedDocuments: [{ sectionId: "sec-1", anchorId: "overview-1" }],
      linkedChanges: [],
      linkedDecisions: [],
      openTargets: { thread: { targetType: "thread", targetRef: { threadId: "thread-1" } }, documents: [] }
    })),
    reprocess: vi.fn(async () => ({ ok: true }))
  };

  const projectDiagramService = {
    generateDiagram: vi.fn(async ({}, actorUserId?: string) => ({
      proposed: {
        title: "Onboarding flow",
        description: "Generated diagram",
        diagramType: "flowchart",
        mermaidSource: "flowchart TD\n  A[Start] --> B[Done]",
        source: "socrates_generated",
        linkedRefs: []
      },
      validation: { ok: true },
      next: { canSave: true },
      actorUserId
    })),
    createDiagram: vi.fn(async () => ({
      id: "44444444-4444-4444-8444-444444444444",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      title: "Onboarding flow",
      description: null,
      diagramType: "flowchart",
      mermaidSource: "flowchart TD\n  A[Start] --> B[Done]",
      source: "user_created",
      status: "active",
      linkedDocumentSectionIds: [],
      linkedBrainNodeIds: [],
      linkedContextEntryIds: [],
      linkedArtifactVersionId: null,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      deletedAt: null,
      embeddedInLiveDoc: []
    })),
    listDiagrams: vi.fn(async () => ({
      items: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
          title: "Onboarding flow",
          description: null,
          diagramType: "flowchart",
          mermaidSource: "flowchart TD\n  A[Start] --> B[Done]",
          source: "user_created",
          status: "active",
          linkedDocumentSectionIds: [],
          linkedBrainNodeIds: [],
          linkedContextEntryIds: [],
          linkedArtifactVersionId: null,
          createdByUserId: "user-1",
          updatedByUserId: "user-1",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
          deletedAt: null,
          embeddedInLiveDoc: []
        }
      ],
      meta: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 }
    })),
    getDiagram: vi.fn(async () => ({
      id: "44444444-4444-4444-8444-444444444444",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      title: "Onboarding flow",
      diagramType: "flowchart",
      mermaidSource: "flowchart TD\n  A[Start] --> B[Done]",
      status: "active"
    })),
    updateDiagram: vi.fn(async () => ({ id: "44444444-4444-4444-8444-444444444444", title: "Updated flow" })),
    deleteDiagram: vi.fn(async () => ({ ok: true, deletedId: "44444444-4444-4444-8444-444444444444" })),
    embedDiagramInLiveDoc: vi.fn(async () => ({
      id: "55555555-5555-4555-8555-555555555555",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      sectionKey: "overview",
      diagramId: "44444444-4444-4444-8444-444444444444",
      sortOrder: 1,
      embeddedAt: "2026-05-01T00:00:00.000Z"
    })),
    removeDiagramFromLiveDoc: vi.fn(async () => ({
      ok: true,
      diagramId: "44444444-4444-4444-8444-444444444444",
      sectionKey: "overview"
    }))
  };

  const codingRequirementsService = {
    generate: vi.fn(async () => ({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      artifactVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      artifactVersionNumber: 1,
      mermaidDiagramId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      generatedByUserId: "user-1",
      createdAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:00.000Z",
      moduleCount: 2,
      unknownCount: 1,
      lowEvidence: false,
      flowchartAvailable: true,
      payload: {
        summary: "Build authentication and dashboard modules.",
        modules: [],
        globalRequirements: [],
        integrationPoints: [],
        assumptions: [],
        unknowns: ["Confirm deployment target."],
        suggestedBuildOrder: [],
        mermaid: "flowchart TD\n  auth[Authentication] --> dashboard[Dashboard]",
        citations: [],
        openTargets: [],
        generatedAt: "2026-05-19T00:00:00.000Z",
        evidenceSummary: { sourceCounts: {}, lowEvidence: false, limitations: [] }
      },
      next: {
        flowchartPath: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/coding-requirements/flowchart",
        liveDocRecommendedSections: ["coding_requirements", "main_coding_flowchart", "module_breakdown", "implementation_unknowns"]
      }
    })),
    getCurrent: vi.fn(async () => ({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      artifactVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      artifactVersionNumber: 1,
      mermaidDiagramId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      moduleCount: 2,
      unknownCount: 1,
      lowEvidence: false,
      flowchartAvailable: true,
      payload: { summary: "Build authentication and dashboard modules." }
    })),
    getHistory: vi.fn(async () => ({
      items: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", artifactVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
      meta: { page: 1, pageSize: 20, totalCount: 1, totalPages: 1 }
    })),
    getFlowchart: vi.fn(async () => ({
      mermaid: "flowchart TD\n  auth[Authentication] --> dashboard[Dashboard]",
      diagram: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        title: "Main Coding Flowchart",
        diagramType: "coding_flow",
        mermaidSource: "flowchart TD\n  auth[Authentication] --> dashboard[Dashboard]"
      },
      artifactVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      generatedAt: "2026-05-19T00:00:00.000Z"
    })),
    buildEngineeringSummary: vi.fn(async () => ({
      hasCodingRequirements: true,
      latestGeneratedAt: "2026-05-19T00:00:00.000Z",
      moduleCount: 2,
      unknownCount: 1,
      flowchartAvailable: true,
      quickLinks: {
        codingRequirementsPath: "/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/coding-requirements",
        flowchartPath: "/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/coding-requirements/flowchart"
      }
    }))
  };

  const documentGenerationService = {
    listGenerationTemplates: vi.fn(() => [
      {
        id: "basic_mvp",
        kind: "prd",
        label: "Basic MVP PRD",
        description: "Plain-language MVP PRD for early product scoping.",
        sections: ["Title", "Project Summary", "Assumptions", "Open Questions", "Coding Hints"]
      },
      {
        id: "basic_srs",
        kind: "srs",
        label: "Basic SRS",
        description: "Simple software requirements specification.",
        sections: ["Title", "Purpose", "Assumptions", "Open Questions", "Implementation Notes"]
      }
    ]),
    generateDocument: vi.fn(async () => ({
      documentId: "doc-1",
      documentVersionId: "ver-1",
      status: "queued",
      title: "Generated PRD",
      kind: "prd",
      next: {
        viewerUrl: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/doc-1/view",
        rebuildBrainRecommended: true,
        brainRebuildQueued: false
      }
    }))
  };

  const brainService = {
    rebuild: vi.fn(async () => ({ queued: true })),
    getCurrentBrain: vi.fn(async () => ({ currentBrain: { id: "brain-1" } })),
    getBrainVersions: vi.fn(async () => [{ id: "brain-1", versionNumber: 1 }]),
    getCurrentGraph: vi.fn(async () => ({ artifact: { id: "graph-1" }, nodes: [], edges: [] }))
  };

  const changeProposalService = {
    list: vi.fn(async () => [{ id: "proposal-1" }]),
    create: vi.fn(async () => ({ id: "proposal-1", status: "needs_review" })),
    get: vi.fn(async () => ({ id: "proposal-1" })),
    accept: vi.fn(async () => ({ id: "proposal-1", status: "accepted" })),
    reject: vi.fn(async () => ({ id: "proposal-1", status: "rejected" })),
    applyAcceptedProposal: vi.fn(async () => undefined)
  };

  const socratesService = {
    createSession: vi.fn(async () => ({
      id: "session-1",
      projectId: "project-1",
      userId: "user-1",
      pageContext: "brain_overview"
    })),
    patchContext: vi.fn(async () => ({
      id: "session-1",
      pageContext: "brain_overview"
    })),
    getSuggestions: vi.fn(async () => ({ suggestions: [], cached: false })),
    streamAnswer: vi.fn(async () => undefined),
    askBetaProjectMemory: vi.fn(async () => ({
      sessionId: "session-beta-1",
      assistantMessageId: "message-beta-1",
      answer_md: "Answer from uploaded docs.",
      citations: [{ type: "document_chunk", refId: "chunk-1", label: "Core PRD", confidence: 0.9 }],
      open_targets: [{ targetType: "document_section", targetRef: { documentId: "doc-1", anchorId: "overview-1" } }],
      suggested_prompts: [],
      suggested_actions: [],
      confidence: "medium",
      limitations: ["Uses uploaded project documents only."]
    })),
    getMessages: vi.fn(async () => []),
    precomputeSuggestions: vi.fn(async () => undefined)
  };

  const editorConnectorService = {
    createVsCodePairing: vi.fn(async () => ({
      id: "connector-1",
      pairingCode: "ORCH-ABC123-DEF456",
      expiresAt: "2026-05-28T00:10:00.000Z",
      status: "pairing_pending"
    })),
    getVsCodeStatus: vi.fn(async () => ({ connectors: [], scopes: ["project_memory:read", "socrates:ask"] })),
    revokeVsCodeConnector: vi.fn(async () => ({ revoked: 1 })),
    exchangeVsCodePairing: vi.fn(async () => ({
      token: "orch_vscode_test_token",
      project: { id: PROJECT_ID, name: "Beta" },
      scopes: ["project_memory:read", "socrates:ask"],
      webAppBaseUrl: "https://beta.example.com"
    })),
    askSocratesWithVsCodeToken: vi.fn(async () => ({
      answer_md: "Answer from VS Code token.",
      citations: [{ type: "document_chunk", refId: "chunk-1", label: "Core PRD", confidence: 0.9 }],
      open_targets: [{ targetType: "document_section", targetRef: { documentId: "doc-1", anchorId: "overview-1" } }],
      suggested_prompts: [],
      suggested_actions: [],
      confidence: "medium",
      limitations: []
    })),
    revokeVsCodeConnectorToken: vi.fn(async () => ({ revoked: 1 }))
  };

  const socratesAction = {
    id: "99999999-9999-4999-8999-999999999999",
    projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
    sessionId: "77777777-7777-4777-8777-777777777777",
    proposedByMessageId: null,
    actionType: "assign_task",
    label: "Assign auth to Ali",
    payload: {
      assigneeName: "Ali",
      taskTitle: "Build authentication",
      taskDescription: "Implement login",
      area: "backend",
      status: "open"
    },
    status: "proposed",
    result: null,
    failureReason: null,
    createdByUserId: "user-1",
    appliedByUserId: null,
    rejectedByUserId: null,
    createdAt: "2026-05-19T00:00:00.000Z",
    appliedAt: null,
    rejectedAt: null,
    updatedAt: "2026-05-19T00:00:00.000Z",
    openTargets: []
  };

  const socratesActionService = {
    createAction: vi.fn(async () => socratesAction),
    listActions: vi.fn(async () => ({
      items: [socratesAction],
      meta: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 }
    })),
    getAction: vi.fn(async () => socratesAction),
    applyAction: vi.fn(async () => ({
      ...socratesAction,
      status: "applied",
      result: {
        entityType: "project_responsibility",
        entityId: "11111111-1111-1111-1111-111111111111",
        openTargets: [
          {
            targetType: "project_responsibility",
            targetRef: {
              projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
              responsibilityId: "11111111-1111-1111-1111-111111111111"
            }
          }
        ]
      },
      appliedByUserId: "user-1",
      appliedAt: "2026-05-19T00:00:00.000Z"
    })),
    rejectAction: vi.fn(async () => ({
      ...socratesAction,
      status: "rejected",
      rejectedByUserId: "user-1",
      rejectedAt: "2026-05-19T00:00:00.000Z"
    })),
    createActionsFromSocratesAnswer: vi.fn(async () => [])
  };

  const dashboardService = {
    getGeneralDashboard: vi.fn(async () => ({
      scope: "general",
      summary: {
        activeProjectCount: 1,
        orgHeadcount: 2,
        projectsNeedingAttention: [],
        communication: {
          connectedProviderCount: 1,
          needsReviewCount: 1,
          blockerCount: 0,
          contradictionCount: 0,
          lastSyncedAt: null
        }
      }
    })),
    getProjectDashboard: vi.fn(async () => ({
      scope: "project",
      project: { id: "project-1", orgId: "org-1", name: "Project", slug: "project" },
      teamSummary: { headcount: 1, roleBreakdown: { manager: 1 }, members: [], workload: { label: "healthy", overloadedCount: 0, watchCount: 0, unknownCount: 0 } },
      documents: { totalCount: 1, readinessState: "ready", counts: { pending: 0, processing: 0, ready: 1, partial: 0, failed: 0 }, latestProcessedAt: null, documents: [] },
      brain: { freshnessState: "current", latestVersionId: "brain-1", latestVersionNumber: 1, acceptedAt: null, latestAcceptedChangeAt: null, latestAcceptedDecisionAt: null },
      changes: { pendingCount: 0, acceptedRecentCount: 0, latestAcceptedAt: null, pendingSummaries: [], recentAccepted: [] },
      decisions: { openCount: 0, latestAcceptedAt: null, openItems: [] },
      communication: { connectedProviders: ["manual_import"], providerCount: 1, lastSyncedAt: null, insightCount: 1, needsReviewCount: 1, blockerCount: 0, contradictionCount: 0, connectorStatuses: [] },
      attention: { score: 0, label: "healthy", reasons: [] },
      quickLinks: { dashboardPath: "/projects/project-1/dashboard", brainPath: "/projects/project-1/brain/current", documentsPath: "/projects/project-1/documents", docViewerPath: null, docViewerState: null, brainViewerState: { pageContext: "brain_overview", selectedRefType: "dashboard_scope", selectedRefId: "project-1" } },
      recentActivity: { latestAcceptedChangeAt: null, latestDecisionAt: null, latestDocumentProcessedAt: null }
    })),
    getMissionControl: vi.fn(async () => ({
      stats: [{ id: "slack-today", label: "Slack today", value: 0, numericValue: 0, state: "not_connected", source: "slack" }],
      team: [],
      teamSummary: { totalActive: 0, managers: 0, devs: 0, clients: 0, approvers: 0, inactive: 0 },
      recentChanges: [],
      calendarEvents: [],
      slackMessages: [],
      gitCommits: [],
      githubPreview: { state: "not_connected", repositoryLabel: null, lastSyncedAt: null, openPrs: null, commitsThisWeek: null, commits: [] },
      activity: [],
      socratesQueries: [],
      subscriptions: [],
      subscriptionSummary: { monthlyTotalCents: 0, currency: "USD", activeCount: 0, usageBasedCount: 0, renewalCount: 0 },
      featureStates: {
        missionControl: "ready",
        slack: "not_connected",
        github: "not_connected",
        subscriptions: "empty",
        calendar: "empty",
        activity: "empty",
        socrates: "empty"
      },
      updatedAt: "2026-05-30T00:00:00.000Z"
    })),
    getActivityFeed: vi.fn(async () => [
      { id: "activity-1", source: "manual", text: "Project event created", createdAt: "2026-05-30T00:00:00.000Z" }
    ]),
    getRecentChanges: vi.fn(async () => [
      { id: "change-1", title: "Scope changed", status: "needs_review", source: "slack", createdAt: "2026-05-30T00:00:00.000Z" }
    ]),
    getRecentSocratesQueries: vi.fn(async () => [
      { id: "query-1", query: "What changed?", askedBy: "Manager", createdAt: "2026-05-30T00:00:00.000Z" }
    ]),
    getCalendarEvents: vi.fn(async () => [
      { id: "event-1", title: "Standup", startsAt: "2026-05-31T09:00:00.000Z", source: "manual" }
    ]),
    createCalendarEvent: vi.fn(async () => ({
      id: "event-2",
      title: "Review",
      startsAt: "2026-05-31T10:00:00.000Z",
      source: "manual"
    })),
    getGithubPreview: vi.fn(async () => ({
      state: "not_connected",
      repositoryLabel: null,
      lastSyncedAt: null,
      openPrs: null,
      commitsThisWeek: null,
      commits: []
    })),
    getProjectTeamSummary: vi.fn(async () => ({
      headcount: 2,
      roleBreakdown: { manager: 1, dev: 1 },
      members: [],
      workload: { label: "watch", overloadedCount: 0, watchCount: 1, unknownCount: 0 }
    })),
    refreshProjectDashboard: vi.fn(async () => ({
      queued: false,
      scope: "project",
      snapshotId: "snap-1",
      computedAt: new Date("2026-01-01T00:00:00.000Z").toISOString()
    })),
    refreshSnapshotJob: vi.fn(async () => undefined)
  };

  const betaTimelineService = {
    listTimeline: vi.fn(async () => ({
      items: [
        {
          id: "manual:event-1",
          source: "manual",
          type: "note",
          title: "Manual event",
          description: "Persisted project note",
          timestamp: "2026-05-30T00:00:00.000Z",
          status: "informational",
          tier: "atomic"
        }
      ],
      updatedAt: "2026-05-30T00:00:00.000Z"
    })),
    createManualEvent: vi.fn(async () => ({
      id: "manual:event-2",
      source: "manual",
      type: "note",
      title: "Created event",
      description: null,
      timestamp: "2026-05-30T00:00:00.000Z",
      status: "informational",
      tier: "atomic"
    })),
    getTimelineEvent: vi.fn(async () => ({
      id: "manual:event-1",
      source: "manual",
      type: "note",
      title: "Manual event",
      description: "Persisted project note",
      timestamp: "2026-05-30T00:00:00.000Z",
      status: "informational",
      tier: "atomic"
    }))
  };

  const liveDocService = {
    getCurrent: vi.fn(async () => ({
      projectName: "Project",
      docType: "LIVE_DOC",
      version: { artifactVersionId: "live-doc-artifact-1", versionNumber: 1, generatedAt: "2026-01-01T00:00:00.000Z" },
      status: "accepted",
      sections: [
        {
          id: "overview",
          anchorId: "overview",
          sectionLabel: "Product Overview",
          type: "highlighted",
          content: "Manager approval is required.",
          highlight: "Current accepted product truth",
          sourceIds: ["sec-1"],
          openTargets: [{ targetType: "document_section", targetRef: { documentId: "doc-1", documentVersionId: "ver-1", anchorId: "overview-1" } }],
          hasPendingDraft: false,
          acceptedChangeSummaries: [],
          lastEditedAt: null,
          lastEditedBy: null,
          hasHistory: true
        }
      ],
      comments: [],
      recentEdits: []
    })),
    patchSection: vi.fn(async () => ({
      draft: {
        id: "draft-1",
        sectionKey: "overview",
        sectionLabel: "Product Overview",
        status: "needs_review",
        proposedContent: "Manager approval is required and logged.",
        linkedProposalId: "proposal-1",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      linkedProposal: { id: "proposal-1", status: "needs_review" },
      latestHistory: { revisionId: "revision-1", eventType: "draft_created" },
      comment: null,
      status: "review"
    })),
    listComments: vi.fn(async () => []),
    createComment: vi.fn(async () => ({
      id: "comment-1",
      sectionKey: "overview",
      bodyText: "Please tighten this wording.",
      commentType: "review"
    })),
    getSectionHistory: vi.fn(async () => ({
      section: { sectionKey: "overview", sectionLabel: "Product Overview", anchorId: "overview", currentContent: "Manager approval is required." },
      revisions: [{ revisionId: "revision-1", eventType: "draft_created" }]
    })),
    getSectionProvenance: vi.fn(async () => ({
      section: { sectionKey: "overview", sectionLabel: "Product Overview", content: "Manager approval is required." },
      supportingSections: [{ sectionId: "sec-1", anchorId: "overview-1" }],
      linkedChanges: [],
      linkedDecisions: [],
      linkedMessageRefs: [],
      openTargets: { section: { targetType: "live_doc_section", targetRef: { sectionKey: "overview" } }, supportingSections: [], messages: [], changes: [] }
    })),
    generateDiagram: vi.fn(async () => ({
      kind: "flowchart",
      mermaid: "flowchart TD\n  A-->B",
      generatedFromArtifactVersionId: "live-doc-artifact-1",
      citations: [{ type: "live_doc_section", refId: "overview", label: "Product Overview" }],
      openTargets: [{ targetType: "live_doc_section", targetRef: { sectionKey: "overview" } }]
    })),
    listReviewItems: vi.fn(async () => []),
    listChangeMarkers: vi.fn(async () => []),
    acceptReviewItem: vi.fn(async () => ({ proposal: { id: "proposal-1", status: "accepted" }, reviewStatus: "accepted" })),
    rejectReviewItem: vi.fn(async () => ({ proposal: { id: "proposal-1", status: "rejected" }, reviewStatus: "rejected" })),
    refreshCurrentArtifact: vi.fn(async () => ({ id: "live-doc-artifact-1" }))
  };

  const projectOpsService = {
    getCalendar: vi.fn(async () => ({
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-30T23:59:59.999Z",
      days: []
    })),
    listMeetings: vi.fn(async () => []),
    getMeeting: vi.fn(async () => ({ id: "meeting-1", title: "Sprint Planning" })),
    createMeeting: vi.fn(async () => ({ id: "meeting-1", title: "Sprint Planning" })),
    createMeetingFromSocratesAction: vi.fn(async () => ({ id: "meeting-1", title: "Sprint Planning" })),
    updateMeeting: vi.fn(async () => ({ id: "meeting-1", title: "Sprint Planning Updated" })),
    deleteMeeting: vi.fn(async () => ({ ok: true })),
    listDeadlines: vi.fn(async () => []),
    getDeadline: vi.fn(async () => ({ id: "deadline-1", title: "Client Demo" })),
    createDeadline: vi.fn(async () => ({ id: "deadline-1", title: "Client Demo" })),
    updateDeadline: vi.fn(async () => ({ id: "deadline-1", title: "Client Demo Updated" })),
    deleteDeadline: vi.fn(async () => ({ ok: true })),
    getFinancialSummary: vi.fn(async () => ({
      projectId: "project-1",
      currency: "USD",
      budgetAmount: 85000,
      spentAmount: 28900,
      remainingAmount: 56100,
      notes: null,
      updatedAt: "2026-01-01T00:00:00.000Z"
    })),
    updateFinancialSummary: vi.fn(async () => ({
      projectId: "project-1",
      currency: "USD",
      budgetAmount: 85000,
      spentAmount: 30000,
      remainingAmount: 55000,
      notes: "Updated",
      updatedAt: "2026-01-02T00:00:00.000Z"
    })),
    listSubscriptions: vi.fn(async () => []),
    getSubscription: vi.fn(async () => ({ id: "sub-1", name: "AWS" })),
    createSubscription: vi.fn(async () => ({ id: "sub-1", name: "AWS" })),
    updateSubscription: vi.fn(async () => ({ id: "sub-1", name: "AWS Updated" })),
    deleteSubscription: vi.fn(async () => ({ ok: true })),
    buildProjectSummary: vi.fn(async () => ({
      meetings: { upcoming: [], todayCount: 0, thisWeekCount: 0 },
      deadlines: { upcoming: [], urgentCount: 0, criticalCount: 0, completedCount: 0 },
      financials: {
        projectId: "project-1",
        currency: "USD",
        budgetAmount: null,
        spentAmount: 0,
        remainingAmount: null,
        notes: null,
        updatedAt: null
      },
      subscriptions: { activeCount: 0, monthlyCost: 0, annualCost: 0, items: [] }
    })),
    buildGeneralSummary: vi.fn(async () => ({
      meetings: { upcoming: [], upcomingCount: 0, todayCount: 0, thisWeekCount: 0 },
      deadlines: { upcoming: [], urgentCount: 0, criticalCount: 0 }
    }))
  };

  const calendarConnectionsService = {
    listConnections: vi.fn(async () => []),
    getConnection: vi.fn(async () => ({
      id: "11111111-2222-4333-8444-555555555555",
      projectId: PROJECT_ID,
      provider: "google_calendar",
      accountLabel: "manager@example.com",
      status: "connected",
      lastSyncedAt: null,
      lastError: null,
      createdAt: "2026-05-01T00:00:00.000Z"
    })),
    initiateConnect: vi.fn(async () => ({
      connectionId: "11111111-2222-4333-8444-555555555555",
      redirectUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test"
    })),
    getGoogleCalendarStatus: vi.fn(async () => ({
      enabled: true,
      configured: true,
      connected: true,
      connection: {
        id: "11111111-2222-4333-8444-555555555555",
        projectId: PROJECT_ID,
        provider: "google_calendar",
        accountLabel: "manager@example.com",
        status: "connected",
        lastSyncedAt: null,
        lastError: null,
        selectedCalendarIds: ["primary"],
        syncMode: "manual",
        webhookState: {
          mode: "manual_sync",
          status: "disabled",
          reason: "Webhook registration has not run yet; manual sync remains available.",
          updatedAt: "2026-05-01T00:00:00.000Z"
        },
        createdAt: "2026-05-01T00:00:00.000Z"
      },
      calendars: [],
      selectedCalendarIds: ["primary"],
      syncMode: "manual",
      webhookState: {
        mode: "manual_sync",
        status: "disabled",
        reason: "Webhook registration has not run yet; manual sync remains available.",
        updatedAt: "2026-05-01T00:00:00.000Z"
      },
      lastSyncedAt: null,
      error: null
    })),
    listGoogleCalendars: vi.fn(async () => [
      {
        id: "primary",
        summary: "Primary",
        description: null,
        timeZone: "UTC",
        primary: true,
        accessRole: "owner",
        selected: true
      }
    ]),
    updateSelectedGoogleCalendars: vi.fn(async () => ({
      enabled: true,
      configured: true,
      connected: true,
      connection: null,
      calendars: [],
      selectedCalendarIds: ["primary"],
      syncMode: "manual",
      webhookState: {
        mode: "manual_sync",
        status: "disabled",
        reason: null,
        updatedAt: "2026-05-01T00:00:00.000Z"
      },
      lastSyncedAt: null,
      error: null
    })),
    triggerGoogleCalendarSync: vi.fn(async () => ({
      id: "22222222-2222-4333-8444-555555555555",
      connectionId: "11111111-2222-4333-8444-555555555555",
      provider: "google_calendar",
      syncType: "manual",
      status: "queued",
      summaryJson: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-05-01T00:00:00.000Z"
    })),
    disconnectGoogleCalendar: vi.fn(async () => ({ ok: true })),
    handleGoogleCalendarWebhook: vi.fn(async () => ({ ok: true, ignored: false, syncQueued: true, reason: null })),
    triggerSync: vi.fn(async () => ({
      id: "22222222-2222-4333-8444-555555555555",
      connectionId: "11111111-2222-4333-8444-555555555555",
      provider: "google_calendar",
      syncType: "manual",
      status: "queued",
      summaryJson: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-05-01T00:00:00.000Z"
    })),
    revokeConnection: vi.fn(async () => ({ ok: true })),
    listSyncRuns: vi.fn(async () => []),
    handleOAuthCallback: vi.fn(async () => ({ projectId: PROJECT_ID, connectionId: "11111111-2222-4333-8444-555555555555" }))
  };

  const githubIntegrationService = {
    getReadiness: vi.fn(() => ({
      enabled: true,
      configured: true,
      missingConfiguration: [],
      webhooksEnabled: false,
      backfillEnabled: true,
      userLinkingEnabled: false,
      readOnlyMode: true,
      writeActionsEnabled: false,
      contentScanEnabled: false
    })),
    getInstallUrl: vi.fn(() => ({
      enabled: true,
      installUrl: "https://github.com/apps/orchestra/installations/new?state=test",
      callbackUrl: "https://api.example.com/v1/github/callback",
      readOnlyMode: true,
      writeActionsEnabled: false,
      message: "Install the Orchestra GitHub App on selected repositories."
    })),
    handleInstallationCallbackFromState: vi.fn(async () => ({ id: "installation-1", status: "active" })),
    listInstallations: vi.fn(async () => [
      {
        id: "11111111-2222-4333-8444-555555555555",
        githubInstallationId: "123",
        githubAccountLogin: "orchestra",
        githubAccountType: "Organization",
        repositorySelection: "selected",
        status: "active",
        installedAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      }
    ]),
    listInstallationRepositories: vi.fn(async () => [
      {
        id: "22222222-2222-4333-8444-555555555555",
        installationId: "11111111-2222-4333-8444-555555555555",
        githubRepositoryId: "987",
        owner: "orchestra",
        name: "app",
        fullName: "orchestra/app",
        defaultBranch: "main",
        private: true,
        fork: false,
        htmlUrl: "https://github.com/orchestra/app",
        status: "active",
        lastSyncedAt: null
      }
    ]),
    getProjectIntegration: vi.fn(async () => ({
      readiness: githubIntegrationService.getReadiness(),
      projectId: PROJECT_ID,
      readOnlyMode: true,
      writeActionsEnabled: false,
      linkedRepositories: [],
      latestSyncRuns: []
    })),
    linkRepository: vi.fn(async () => ({ id: "repo-link-1", status: "active", readOnlyMode: true, writeActionsEnabled: false })),
    triggerBackfill: vi.fn(async () => ({ id: "sync-1", status: "completed", mode: "incremental" })),
    listSyncRuns: vi.fn(async () => []),
    getCodeStatus: vi.fn(async () => ({
      state: "not_connected",
      repositoryLabel: null,
      repositoryOwner: null,
      repositoryName: null,
      defaultBranch: null,
      lastSyncedAt: null,
      openPrCount: 0,
      readyToMergeCount: 0,
      failingChecksCount: 0,
      latestMainCommitSha: null,
      latestMainCommitAt: null,
      testCoverage: null,
      conflictRiskCount: 0,
      setupUrl: null,
      installUrl: null,
      sourceStates: { github: { state: "not_connected", detail: "No GitHub repository is linked." } },
      limitations: ["No fake GitHub data."],
      readOnlyMode: true,
      writeActionsEnabled: false
    })),
    getCodeStatusBundle: vi.fn(async () => ({
      projectId: PROJECT_ID,
      status: {
        state: "not_connected",
        repositoryLabel: null,
        repositoryOwner: null,
        repositoryName: null,
        defaultBranch: null,
        lastSyncedAt: null,
        openPrCount: 0,
        readyToMergeCount: 0,
        failingChecksCount: 0,
        latestMainCommitSha: null,
        latestMainCommitAt: null,
        testCoverage: null,
        conflictRiskCount: 0,
        setupUrl: null,
        installUrl: null,
        sourceStates: { github: { state: "not_connected", detail: "No GitHub repository is linked." } },
        limitations: ["No fake GitHub data."],
        readOnlyMode: true,
        writeActionsEnabled: false
      },
      pullRequests: [],
      conflicts: [],
      activity: [],
      branches: [],
      latestSyncRun: null,
      latestSyncRuns: [],
      linkedRepositories: [],
      readOnlyMode: true,
      writeActionsEnabled: false
    })),
    listCodePullRequests: vi.fn(async () => []),
    listCodeConflicts: vi.fn(async () => []),
    listCodeActivity: vi.fn(async () => []),
    listCodeBranches: vi.fn(async () => []),
    archiveRepositoryLink: vi.fn(async () => ({ id: "repo-link-1", status: "archived" })),
    handleWebhook: vi.fn(async () => ({ status: "processed", deliveryId: "delivery-1", eventType: "push" }))
  };

  const suggestionsService = {
    list: vi.fn(async () => ({
      items: [],
      sourceStates: {
        slack: { state: "empty", label: "Slack", detail: null },
        livedoc: { state: "empty", label: "LiveDoc", detail: null },
        timeline: { state: "empty", label: "Timeline", detail: null },
        calendar: { state: "not_connected", label: "Google Calendar", detail: null },
        documents: { state: "empty", label: "Uploaded docs", detail: null },
        socrates: { state: "empty", label: "Socrates", detail: null },
        github: { state: "not_connected", label: "GitHub", detail: null },
        vscode: { state: "empty", label: "VS Code", detail: null }
      },
      countsByCategory: {},
      countsBySeverity: {},
      generatedAt: "2026-05-01T00:00:00.000Z",
      limitations: ["No fake data."]
    })),
    get: vi.fn(async () => ({ id: "sug_abc123456789", status: "active" })),
    dismiss: vi.fn(async () => ({ suggestion: { id: "sug_abc123456789", status: "dismissed" } })),
    promoteToTimeline: vi.fn(async () => ({ suggestion: { id: "sug_abc123456789" }, timelineEvent: { id: "manual:event-1" } })),
    createReviewItem: vi.fn(async () => ({ suggestion: { id: "sug_abc123456789" }, proposal: { id: "proposal-1", status: "needs_review" } })),
    askSocrates: vi.fn(async () => ({ suggestion: { id: "sug_abc123456789" }, answer: { answer_md: "Evidence-only answer." } }))
  };

  const truthInboxService = {
    list: vi.fn(async () => ({
      items: [],
      members: [],
      summary: { active: 0, critical: 0, awaitingDecision: 0, assignedToMe: 0 },
      countsByCategory: {},
      countsByStatus: {},
      sourceStates: {},
      page: { limit: 30, hasMore: false, nextCursor: null },
      generatedAt: "2026-08-23T00:00:00.000Z",
      cached: false,
      limitations: ["Evidence is not accepted truth."]
    })),
    get: vi.fn(async () => ({ id: "suggestion:sug_abc123456789", status: "active" })),
    act: vi.fn(async () => ({ item: { id: "suggestion:sug_abc123456789", status: "deferred" }, outcome: null, action: "defer" }))
  };

  const truthChangePacketService = {
    get: vi.fn(async () => ({
      id: "packet:suggestion:sug_abc123456789",
      projectId: PROJECT_ID,
      packetKind: "review_signal",
      readiness: "review_only",
      newEvidence: [],
      currentAcceptedTruth: [],
      recordedPriorUnderstanding: [],
      proposedChange: null,
      potentialConflict: null,
      affected: { productAreas: [], engineering: [], owners: [] },
      confidence: { score: 0.5, label: "low", basis: [] },
      decision: { required: false, options: [], blockers: [] },
      boundaries: [],
      generatedAt: "2026-08-23T00:00:00.000Z",
      limitations: []
    }))
  };

  const meService = {
    getProfile: vi.fn(async () => ({
      userId: "user-1",
      email: "manager@example.com",
      displayName: "Manager",
      avatarUrl: null,
      timezone: "Australia/Sydney",
      locale: "en-AU",
      emailVerified: true,
      emailVerifiedAt: "2026-05-01T00:00:00.000Z",
      globalRole: "owner",
      workspaceRoleDefault: "manager",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastLoginAt: null,
      defaultProjectId: PROJECT_ID,
      activeProjectId: PROJECT_ID,
      profileCompleted: true
    })),
    updateProfile: vi.fn(async () => ({
      userId: "user-1",
      email: "manager@example.com",
      displayName: "Updated Manager",
      avatarUrl: null,
      timezone: "Australia/Sydney",
      locale: "en-AU",
      emailVerified: true,
      emailVerifiedAt: "2026-05-01T00:00:00.000Z",
      globalRole: "owner",
      workspaceRoleDefault: "manager",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastLoginAt: null,
      defaultProjectId: PROJECT_ID,
      activeProjectId: PROJECT_ID,
      profileCompleted: true
    })),
    uploadAvatarDisabled: vi.fn(async () => {
      throw new AppError(503, "Avatar upload storage is not configured for this private pilot", "feature_not_configured");
    }),
    getNotificationPreferences: vi.fn(async () => ({
      id: "pref-1",
      productUpdates: false,
      projectActivity: true,
      approvalRequests: true,
      slackSyncAlerts: true,
      calendarReminders: true,
      socratesDigests: false,
      securityAlerts: true,
      emailEnabled: true,
      inAppEnabled: true,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    })),
    updateNotificationPreferences: vi.fn(async () => ({
      id: "pref-1",
      productUpdates: true,
      projectActivity: true,
      approvalRequests: true,
      slackSyncAlerts: true,
      calendarReminders: true,
      socratesDigests: false,
      securityAlerts: true,
      emailEnabled: true,
      inAppEnabled: true,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z"
    })),
    getAppearancePreference: vi.fn(async () => ({
      theme: "auto",
      updatedAt: "2026-05-01T00:00:00.000Z"
    })),
    updateAppearancePreference: vi.fn(async (_actor, theme) => ({
      theme,
      updatedAt: "2026-05-02T00:00:00.000Z"
    })),
    listLinkedAccounts: vi.fn(async () => [{
      id: "github:link-1",
      service: "github",
      connected: true,
      accountIdentifier: "manager",
      status: "active",
      linkedAt: "2026-05-01T00:00:00.000Z",
      sources: ["github_user_link"]
    }]),
    listSessions: vi.fn(async () => [
      {
        id: "11111111-2222-4333-8444-555555555555",
        createdAt: "2026-05-01T00:00:00.000Z",
        lastUsedAt: null,
        expiresAt: "2026-06-01T00:00:00.000Z",
        current: false,
        deviceLabel: null,
        ipLabel: null
      }
    ]),
    revokeSession: vi.fn(async () => ({ revoked: true, sessionId: "11111111-2222-4333-8444-555555555555" })),
    revokeAllSessions: vi.fn(async () => ({ revoked: 1 })),
    listWorkspaces: vi.fn(async () => [
      {
        projectId: PROJECT_ID,
        name: "Beta Project",
        slug: "beta-project",
        organizationId: "org-1",
        role: "manager",
        isActive: true,
        canApproveTruthChanges: true,
        memberCount: 1,
        planLabel: "Private pilot",
        createdAt: "2026-05-01T00:00:00.000Z",
        lastOpenedAt: null,
        current: false
      }
    ]),
    switchWorkspace: vi.fn(async () => ({
      projectId: PROJECT_ID,
      name: "Beta Project",
      slug: "beta-project",
      organizationId: "org-1",
      role: "manager",
      isActive: true,
      canApproveTruthChanges: true,
      memberCount: 1,
      planLabel: "Private pilot",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastOpenedAt: null,
      current: true
    }))
  };

  const integrationManagementService = {
    getProjectIntegrationStatus: vi.fn(async () => ({
      projectId: PROJECT_ID,
      providers: [
        {
          provider: "slack",
          label: "Slack",
          category: "communication",
          status: "not_configured",
          configured: false,
          connected: false,
          degraded: true,
          needsReauth: false,
          lastSyncedAt: null,
          lastError: null,
          availableActions: [],
          featureFlag: "slack",
          setupUrl: null,
          connectedAccountLabel: null,
          selectedResourcesSummary: "Slack is not configured.",
          writeActionsEnabled: false,
          limitations: ["No Slack write actions."]
        },
        {
          provider: "vscode",
          label: "VS Code",
          category: "editor",
          status: "not_connected",
          configured: true,
          connected: false,
          degraded: false,
          needsReauth: false,
          lastSyncedAt: null,
          lastError: null,
          availableActions: ["connect"],
          featureFlag: "editor_connectors",
          setupUrl: null,
          connectedAccountLabel: null,
          selectedResourcesSummary: "No editor is connected.",
          writeActionsEnabled: false,
          limitations: []
        },
        {
          provider: "google_calendar",
          label: "Google Calendar",
          category: "calendar",
          status: "connected",
          configured: true,
          connected: true,
          degraded: false,
          needsReauth: false,
          lastSyncedAt: null,
          lastError: null,
          availableActions: ["sync", "disconnect"],
          featureFlag: "BETA_GOOGLE_CALENDAR_ENABLED",
          setupUrl: null,
          connectedAccountLabel: "manager@example.com",
          selectedResourcesSummary: "1 calendar selected.",
          writeActionsEnabled: false,
          limitations: ["Read-only calendar sync."]
        },
        {
          provider: "github",
          label: "GitHub",
          category: "engineering",
          status: "not_connected",
          configured: true,
          connected: false,
          degraded: false,
          needsReauth: false,
          lastSyncedAt: null,
          lastError: null,
          availableActions: ["install_app"],
          featureFlag: "BETA_GITHUB_PAGE_ENABLED",
          setupUrl: null,
          connectedAccountLabel: null,
          selectedResourcesSummary: "No GitHub repository is linked.",
          writeActionsEnabled: false,
          limitations: ["Read-only GitHub evidence."]
        }
      ],
      hiddenProviders: ["granola", "fireflies", "teams", "gmail", "outlook", "whatsapp"],
      generatedAt: "2026-05-01T00:00:00.000Z"
    }))
  };

  const communicationsService = {
    connectors: {
      list: vi.fn(async () => [
        {
          id: "connector-1",
          provider: "manual_import",
          accountLabel: "Manual import",
          status: "connected",
          lastSyncedAt: null,
          lastError: null,
          configSummary: { threadCount: 1, messageCount: 1, syncRunCount: 0 }
        }
      ]),
      get: vi.fn(async () => ({
        id: "connector-1",
        provider: "manual_import",
        accountLabel: "Manual import",
        status: "connected",
        counts: { threads: 1, messages: 1 },
        recentSyncRuns: []
      })),
      listReadiness: vi.fn(async () => [
        {
          provider: "manual_import",
          connectorId: "connector-1",
          connectorStatus: "connected",
          readiness: { state: "enabled", canConnect: true, canSync: false, canManualImport: true, canWebhook: false, reasons: [], missingConfig: [], deferredFeatures: [] }
        },
        {
          provider: "slack",
          connectorId: null,
          connectorStatus: null,
          readiness: {
            state: "readiness_gated",
            canConnect: false,
            canSync: false,
            canManualImport: false,
            canWebhook: false,
            reasons: ["slack_configuration_incomplete"],
            missingConfig: ["SLACK_CLIENT_ID"],
            deferredFeatures: []
          }
        }
      ]),
      update: vi.fn(async () => ({ id: "connector-1", accountLabel: "Renamed", status: "connected" })),
      listProviderChannels: vi.fn(async () => ({
        provider: "slack",
        connectorId: "3322717f-2c10-4239-b525-6fbc9158f4fb",
        channels: [{ id: "C123", name: "client-delivery", isPrivate: false, isArchived: false }]
      })),
      connect: vi.fn(async () => ({ connectorId: "connector-1", provider: "manual_import", status: "connected", redirectUrl: null })),
      handleOAuthCallback: vi.fn(async () => ({ connectorId: "connector-1", provider: "slack", status: "connected", syncRunId: "sync-1", redirectAfter: null })),
      handleOAuthCallbackFromState: vi.fn(async () => ({ connectorId: "connector-2", provider: "outlook", status: "connected", syncRunId: "sync-2", redirectAfter: null })),
      handleWebhook: vi.fn(async () => ({ statusCode: 200, body: { ok: true } })),
      revoke: vi.fn(async () => ({ id: "connector-1", status: "revoked" })),
      listSyncRuns: vi.fn(async () => [{ id: "sync-1", status: "completed" }]),
      listProjectJobRuns: vi.fn(async () => [
        {
          id: "job-1",
          jobType: "sync_communication_connector",
          status: "failed",
          attemptCount: 3,
          scheduledAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:01.000Z",
          finishedAt: "2026-01-01T00:00:02.000Z",
          lastError: "Provider rate limited",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:02.000Z"
        }
      ])
    },
    sync: {
      queueSync: vi.fn(async () => ({ connectorId: "connector-1", syncRunId: "sync-1", queued: true })),
      runSyncJob: vi.fn(async () => undefined)
    },
    timeline: {
      getTimeline: vi.fn(async () => ({
        items: [{ threadId: "thread-1", provider: "manual_import", latestMessage: { id: "msg-1" } }],
        meta: { limit: 25, nextCursor: null, hasMore: false }
      })),
      listThreads: vi.fn(async () => ({
        items: [{ threadId: "thread-1", provider: "manual_import", latestMessage: { id: "msg-1" } }],
        meta: { limit: 25, nextCursor: null, hasMore: false }
      })),
      getThread: vi.fn(async () => ({
        thread: { id: "thread-1", provider: "manual_import", subject: "Client request" },
        messages: [{ id: "msg-1", bodyText: "Need this change" }],
        linkedChanges: [],
        linkedDecisions: [],
        openTargets: { thread: { targetType: "thread", targetRef: { threadId: "thread-1" } }, documents: [] },
        viewerState: { pageContext: "doc_viewer", selectedRefType: "document", selectedRefId: null }
      })),
      getMessage: vi.fn(async () => ({
        connector: { id: "connector-1", provider: "manual_import", accountLabel: "Manual import", status: "connected" },
        message: { id: "msg-1", threadId: "thread-1", bodyText: "Need this change" },
        thread: { id: "thread-1", subject: "Client request" },
        linkedDocuments: [{ sectionId: "sec-1", anchorId: "overview-1" }],
        linkedChanges: [],
        linkedDecisions: [],
        revisions: [],
        attachments: [],
        chunks: [],
        openTargets: { thread: { targetType: "thread", targetRef: { threadId: "thread-1" } }, documents: [] }
      }))
    },
    messageInsights: {
      list: vi.fn(async () => ({
        items: [
          {
            id: "insight-1",
            messageId: "msg-1",
            threadId: "thread-1",
            insightType: "requirement_change",
            status: "detected",
            confidence: 0.88
          }
        ],
        meta: { limit: 25, nextCursor: null, hasMore: false }
      })),
      get: vi.fn(async () => ({
        id: "insight-1",
        messageId: "msg-1",
        threadId: "thread-1",
        insightType: "requirement_change",
        status: "detected",
        confidence: 0.88
      })),
      ignore: vi.fn(async () => ({ id: "insight-1", status: "ignored" })),
      createProposal: vi.fn(async () => ({ insightId: "insight-1", proposalId: "proposal-1", decisionId: null, deduped: false })),
      classifyMessage: vi.fn(async () => ({ id: "insight-1", messageId: "msg-1", insightType: "requirement_change", status: "detected" })),
      runClassificationJob: vi.fn(async () => undefined),
      getReviewQueue: vi.fn(async () => ({
        pendingInsights: [{ id: "insight-1", messageId: "msg-1" }],
        generatedProposals: [{ proposalId: "proposal-1" }],
        generatedDecisionCandidates: []
      }))
    },
    threadInsights: {
      classifyThread: vi.fn(async () => ({ id: "thread-insight-1", threadId: "thread-1", insightType: "decision", status: "detected" })),
      runClassificationJob: vi.fn(async () => undefined),
      createProposal: vi.fn(async () => ({ proposalId: "proposal-1" }))
    },
    indexing: {
      runIndexJob: vi.fn(async () => undefined),
      indexCommunicationMessage: vi.fn(async () => ({ indexed: true, chunkCount: 1 }))
    },
    importManualBatch: vi.fn(async () => ({
      connectorId: "connector-1",
      threadId: "thread-1",
      messageIds: ["msg-1"],
      createdMessageCount: 1,
      updatedRevisionCount: 0,
      indexed: true
    })),
    importProviderBatch: vi.fn(async () => ({
      connectorId: "connector-1",
      threadId: "thread-1",
      messageIds: ["msg-1"],
      createdMessageCount: 1,
      updatedRevisionCount: 0,
      indexed: true
    })),
    getAdapter: vi.fn((provider: string) => ({
      normalizeImport: vi.fn(async (input: any) => ({
        projectId: "",
        connectorId: "",
        provider,
        syncRunId: null,
        threads:
          provider === "manual_import"
            ? [{ providerThreadId: input.thread.providerThreadId, participants: input.thread.participants ?? [] }]
            : [{ providerThreadId: `fireflies:transcript:${input.meeting.providerTranscriptId}`, participants: [] }],
        messages:
          provider === "manual_import"
            ? input.messages
            : [
                {
                  providerMessageId: `fireflies:transcript:${input.meeting.providerTranscriptId}:full`,
                  senderLabel: "Fireflies.ai transcript",
                  sentAt: input.meeting.startedAt,
                  bodyText: input.segments.map((segment: any) => segment.text).join("\n"),
                  messageType: "note"
                }
              ]
      }))
    }))
  };

  const clientSharesService = {
    listShares: vi.fn(async () => []),
    createShare: vi.fn(async () => ({ share: { id: "share-1" }, rawToken: "client_token" })),
    getShare: vi.fn(async () => ({ id: "share-1" })),
    updateShare: vi.fn(async () => ({ id: "share-1" })),
    rotateToken: vi.fn(async () => ({ share: { id: "share-1" }, rawToken: "client_token_2" })),
    revokeShare: vi.fn(async () => ({ id: "share-1", status: "revoked" }))
  };

  const clientViewService = {
    getBootstrap: vi.fn(async () => ({})),
    getProjectSummary: vi.fn(async () => ({})),
    getBrain: vi.fn(async () => ({})),
    getGraph: vi.fn(async () => ({})),
    listDocuments: vi.fn(async () => []),
    getDocumentView: vi.fn(async () => ({})),
    getAnchor: vi.fn(async () => ({})),
    searchDocument: vi.fn(async () => ({})),
    getAnchorProvenance: vi.fn(async () => ({}))
  };

  const agentContextPackService = {
    createPack: vi.fn(async () => ({
      id: "22222222-2222-4222-8222-222222222222",
      status: "active",
      title: "Implementation pack",
      taskPrompt: "Implement KYC onboarding",
      taskType: "implementation",
      sourceMode: "task_prompt",
      sections: { mission: { items: ["Implement KYC onboarding"] } },
      bodyMarkdown: "# Mission\n- Implement KYC onboarding",
      citations: [],
      openTargets: [],
      sources: [],
      sourceCount: 0,
      evidenceCount: 0,
      citationCount: 0,
      openTargetCount: 0,
      tokenEstimate: 10,
      tokenEstimateMethod: "chars_div_4",
      limitations: ["No accepted Product Brain version was available for this pack."],
      warnings: [],
      generatedAt: "2026-05-01T00:00:00.000Z",
      refreshedAt: null
    })),
    listPacks: vi.fn(async () => ({
      items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          title: "Implementation pack",
          taskType: "implementation",
          sourceMode: "task_prompt",
          status: "active",
          tokenEstimate: 10,
          sourceCount: 0,
          evidenceCount: 0
        }
      ],
      meta: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 }
    })),
    getPack: vi.fn(async () => ({
      id: "22222222-2222-4222-8222-222222222222",
      status: "active",
      title: "Implementation pack",
      bodyMarkdown: "# Mission",
      sources: [],
      limitations: []
    })),
    refreshPack: vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", refreshedAt: "2026-05-02T00:00:00.000Z" })),
    archivePack: vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", status: "archived" })),
    deletePack: vi.fn(async () => ({ ok: true, deletedId: "22222222-2222-4222-8222-222222222222", status: "deleted" })),
    listExportFormats: vi.fn(async () => [
      { format: "markdown", label: "Markdown", contentType: "text/markdown; charset=utf-8", extension: "md", supportsPreview: true, supportsHistory: false },
      { format: "json", label: "JSON", contentType: "application/json; charset=utf-8", extension: "json", supportsPreview: true, supportsHistory: false }
    ]),
    previewExport: vi.fn(async () => ({
      format: "markdown",
      content: "# Agent Context Pack\nThis context is generated from Orchestra.",
      copyText: "# Agent Context Pack\nThis context is generated from Orchestra.",
      contentType: "text/markdown; charset=utf-8",
      suggestedFilename: "agent-context.md",
      tokenEstimate: 24,
      tokenEstimateMethod: "chars_div_4",
      sourceCount: 1,
      evidenceCount: 1,
      citationCount: 1,
      openTargetCount: 1,
      redactionMode: "internal",
      budgetPreset: "normal",
      warnings: [],
      limitations: [],
      packMetadata: { contextPackId: "22222222-2222-4222-8222-222222222222" }
    })),
    generateExport: vi.fn(async () => ({
      format: "codex_prompt",
      content: "# Codex Implementation Context",
      copyText: "# Codex Implementation Context",
      contentType: "text/markdown; charset=utf-8",
      suggestedFilename: "agent-context-codex.md",
      tokenEstimate: 20,
      tokenEstimateMethod: "chars_div_4",
      sourceCount: 1,
      evidenceCount: 1,
      citationCount: 1,
      openTargetCount: 1,
      redactionMode: "implementation_only",
      budgetPreset: "compact",
      warnings: [],
      limitations: [],
      packMetadata: { contextPackId: "22222222-2222-4222-8222-222222222222" }
    }))
  };

  const agentRunMemoryService = {
    createRun: vi.fn(async () => ({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      contextPackId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      provider: "codex",
      agentLabel: "Codex",
      taskTitle: "Implement auth routes",
      taskType: "implementation",
      status: "context_generated",
      promptSource: "context_pack",
      outputSummary: "Codex implemented auth route tests.",
      filesChanged: ["src/modules/auth/routes.ts"],
      modulesTouched: ["auth"],
      testsRun: ["npm test -- auth"],
      risksFound: [],
      followUpQuestions: [],
      humanReviewResult: "unreviewed",
      unverifiedClaims: true,
      requiresHumanReview: true,
      citation: { type: "agent_run", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "Implement auth routes" },
      openTarget: { targetType: "agent_run", targetRef: { agentRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } },
      limitations: ["Agent runs are implementation evidence, not accepted Product Brain truth."],
      warnings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    })),
    listRuns: vi.fn(async () => ({
      items: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", taskTitle: "Implement auth routes", status: "completed" }],
      meta: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 }
    })),
    getRun: vi.fn(async () => ({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "completed", outputSummary: "Done" })),
    updateRun: vi.fn(async () => ({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "running", branchName: "feature/auth" })),
    updateStatus: vi.fn(async () => ({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "completed" })),
    reviewRun: vi.fn(async () => ({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "accepted", humanReviewResult: "accepted" })),
    archiveRun: vi.fn(async () => ({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "archived" })),
    deleteRun: vi.fn(async () => ({ ok: true, deletedId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "deleted", deletedAt: "2026-01-01T00:00:00.000Z" }))
  };

  const agentFilesService = {
    listFileSets: vi.fn(async () => ({ items: [], meta: { totalCount: 0 } })),
    createDefaultFileSet: vi.fn(async () => ({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", files: [] })),
    getOrCreateDefault: vi.fn(async () => ({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", files: [] })),
    getFileSet: vi.fn(async () => ({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", files: [] })),
    previewFileSet: vi.fn(async () => ({ fileSetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", files: [], noRepoWrite: true })),
    generateFileSet: vi.fn(async () => ({ fileSetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", files: [], noRepoWrite: true })),
    archiveFileSet: vi.fn(async () => ({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "archived" })),
    getFile: vi.fn(async () => ({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })),
    listFileVersions: vi.fn(async () => ({ items: [], meta: { totalCount: 0 } })),
    getFileVersion: vi.fn(async () => ({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }))
  };

  const engineeringEvidenceService = {
    listEvidence: vi.fn(async () => ({
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      items: [{ id: "11111111-1111-4111-8111-111111111111", sourceType: "github", sourceSubType: "pull_request", notice: "Engineering evidence is evidence, not Product Brain truth." }],
      evidenceCount: 1,
      readOnly: true,
      truthMutationAllowed: false,
      githubWritesAllowed: false
    })),
    getEvidence: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111", readOnly: true, truthMutationAllowed: false })),
    refresh: vi.fn(async () => ({ status: "completed", normalizedCount: 1, readOnly: true, truthMutationAllowed: false })),
    listSources: vi.fn(async () => ({ projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90", counts: { "github:github:pull_request": 1 }, readOnly: true })),
    listMockRealRegistry: vi.fn(async () => ({ items: [{ id: "mock-real:1", status: "mocked" }], readOnly: true, truthMutationAllowed: false })),
    listIntegrationSeams: vi.fn(async () => ({ items: [{ id: "seam:1", status: "unknown" }], readOnly: true, truthMutationAllowed: false })),
    listBranchDeployTruth: vi.fn(async () => ({ items: [{ id: "branch:1", status: "open_pr" }], readOnly: true, truthMutationAllowed: false })),
    listTodoFixme: vi.fn(async () => ({ items: [{ id: "todo:1", label: "TODO" }], readOnly: true, truthMutationAllowed: false })),
    createManualEntry: vi.fn(async () => ({ id: "manual-1", manual: true, readOnly: true, truthMutationAllowed: false }))
  };

  const fdeReadinessService = {
    listConflicts: vi.fn(async () => ({ projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90", items: [{ id: "conflict-1", severity: "blocking" }], readOnly: true, truthMutationAllowed: false })),
    refreshConflicts: vi.fn(async () => ({ status: "completed", counts: { conflict: 1 }, readOnly: true, truthMutationAllowed: false })),
    listSafeToTouch: vi.fn(async () => ({ projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90", items: [{ id: "safe-1", status: "yellow" }], readOnly: true, truthMutationAllowed: false })),
    getSafeToTouchForFile: vi.fn(async () => ({ projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90", item: { status: "yellow", targetRef: "src/api/billing.ts" }, readOnly: true, truthMutationAllowed: false })),
    refreshSafeToTouch: vi.fn(async () => ({ status: "completed", counts: { safe_to_touch: 1 }, readOnly: true, truthMutationAllowed: false })),
    listDuplicates: vi.fn(async () => ({ items: [{ id: "duplicate-1", severity: "watch" }], readOnly: true, truthMutationAllowed: false })),
    refreshDuplicates: vi.fn(async () => ({ status: "completed", counts: { duplicate_work: 1 }, readOnly: true, truthMutationAllowed: false })),
    listLiveWorkingMap: vi.fn(async () => ({ items: [{ id: "live-1", targetKind: "file" }], readOnly: true, truthMutationAllowed: false })),
    refreshLiveWorkingMap: vi.fn(async () => ({ status: "completed", counts: { live_working_signal: 1 }, readOnly: true, truthMutationAllowed: false })),
    listRationaleTraces: vi.fn(async () => ({ items: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "partial" }], readOnly: true, truthMutationAllowed: false })),
    createRationaleTrace: vi.fn(async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "partial", readOnly: true, truthMutationAllowed: false })),
    getRationaleTrace: vi.fn(async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", hops: [], readOnly: true, truthMutationAllowed: false })),
    listDecisionEngineeringLinks: vi.fn(async () => ({ items: [{ id: "decision-link-1" }], readOnly: true, truthMutationAllowed: false })),
    createDecisionEngineeringLink: vi.fn(async () => ({ id: "decision-link-1", readOnly: true, truthMutationAllowed: false })),
    refreshAll: vi.fn(async () => ({ status: "completed", counts: { conflict: 1, safe_to_touch: 1 }, readOnly: true, truthMutationAllowed: false }))
  };

  const mcpService = {
    getReadiness: vi.fn(() => ({ enabled: true, mode: "team_internal" })),
    listTokens: vi.fn(async () => []),
    createToken: vi.fn(),
    revokeToken: vi.fn(),
    handleJsonRpc: vi.fn(async (_authorization: string | undefined, request: any) => ({
      jsonrpc: "2.0",
      id: request.id,
      result: request.method === "initialize"
        ? { protocolVersion: "2025-11-25", serverInfo: { name: "orchestra-mcp", version: "1.0.0" }, capabilities: {} }
        : {}
    }))
  };

  const auditService = {
    record: vi.fn(),
    listProjectEvents: vi.fn(async () => ({
      items: [
        {
          id: "audit-1",
          projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
          orgId: "org-1",
          actorUserId: "user-1",
          actor: {
            id: "user-1",
            email: "manager@example.com",
            displayName: "Manager",
            workspaceRoleDefault: "manager"
          },
          eventType: "proposal_accepted",
          entityType: "spec_change_proposal",
          entityId: "proposal-1",
          payload: {
            proposalId: "proposal-1",
            transcriptId: "[redacted]",
            credentialsRef: "[redacted]",
            rawBody: "[redacted]"
          },
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      meta: { limit: 25, hasMore: false, nextCursor: null }
    }))
  };

  return {
    env: {
      NODE_ENV: "test",
      PORT: 3000,
      HOST: "127.0.0.1",
      LOG_LEVEL: "silent",
      APP_BASE_URL: "http://localhost:3000",
      CORS_ALLOWED_ORIGINS: "http://localhost:3001",
      SECURITY_HEADERS_ENABLED: true,
      RATE_LIMIT_ENABLED: true,
      RATE_LIMIT_MAX: 1000,
      RATE_LIMIT_WINDOW_MS: 60000,
      AUTH_RATE_LIMIT_MAX: 20,
      AUTH_RATE_LIMIT_WINDOW_MS: 60000,
      CLIENT_RATE_LIMIT_MAX: 120,
      CLIENT_RATE_LIMIT_WINDOW_MS: 60000,
      WEBHOOK_RATE_LIMIT_MAX: 300,
      WEBHOOK_RATE_LIMIT_WINDOW_MS: 60000,
      UPLOAD_RATE_LIMIT_MAX: 20,
      UPLOAD_RATE_LIMIT_WINDOW_MS: 60000,
      SOCRATES_STREAM_RATE_LIMIT_MAX: 60,
      SOCRATES_STREAM_RATE_LIMIT_WINDOW_MS: 60000,
      MVP_MODE: false,
      MVP_EQUAL_PROJECT_ACCESS: false,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai"],
      MVP_ENABLE_ADVANCED_CONNECTORS: true,
      MVP_ENABLE_CLIENT_PORTAL: true,
      MVP_ENABLE_AUDIO_TRANSCRIPTION: false,
      MVP_ENABLE_PROJECT_FINANCE: true,
      MVP_ENABLE_PROJECT_SUBSCRIPTIONS: true,
      MVP_ENABLE_CALENDAR_SYNC: true,
      MVP_ENABLE_CALENDLY: false,
      MVP_SIMPLE_CHANGE_APPLY: false,
      MVP_REQUIRE_MANAGER_APPROVAL: true,
      MVP_SHOW_VERSION_HISTORY: true,
      BETA_GOOGLE_CALENDAR_ENABLED: true,
      BETA_GOOGLE_CALENDAR_WEBHOOKS_ENABLED: true,
      DATABASE_URL: "postgresql://test",
      DIRECT_URL: "postgresql://test",
      REDIS_URL: "redis://localhost:6379",
      QUEUE_MODE: "inline",
      QUEUE_PREFIX: "orchestra",
      WORKER_CONCURRENCY: 5,
      JOB_DEFAULT_ATTEMPTS: 3,
      JOB_DEFAULT_BACKOFF_MS: 1000,
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_ROOT: "./storage",
      SIGNED_URL_TTL_SECONDS: 3600,
      MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024,
      JWT_ACCESS_SECRET: "test-access-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      JWT_ACCESS_TTL: "15m",
      JWT_REFRESH_TTL: "30d",
      AUTH_COOKIE_SECURE: false,
      AUTH_COOKIE_SAME_SITE: "lax",
      PASSWORD_HASH_COST: 12,
      OPENAI_TRANSCRIPTION_MODEL: "mock-transcribe",
      SLACK_CLIENT_ID: "slack-client-id",
      SLACK_CLIENT_SECRET: "slack-client-secret",
      SLACK_SIGNING_SECRET: "slack-signing-secret",
      SLACK_REDIRECT_URI: "http://localhost:3000/v1/oauth/slack/callback",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      GOOGLE_REDIRECT_URI: "http://localhost:3000/v1/oauth/google/callback",
      GOOGLE_CALENDAR_SCOPES: [
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.events.readonly",
        "https://www.googleapis.com/auth/userinfo.email"
      ],
      GOOGLE_CALENDAR_SYNC_MAX_BACKFILL_DAYS: 30,
      GOOGLE_CALENDAR_SYNC_PAGE_SIZE: 250,
      GOOGLE_CALENDAR_WATCH_TTL_SECONDS: 604800,
      GOOGLE_CALENDAR_CONNECTOR_ENABLED: true,
      GOOGLE_CALENDAR_BACKFILL_ENABLED: true,
      GOOGLE_CALENDAR_INCREMENTAL_SYNC_ENABLED: true,
      GOOGLE_PUBSUB_TOPIC: undefined,
      MICROSOFT_CLIENT_ID: "microsoft-client-id",
      MICROSOFT_CLIENT_SECRET: "microsoft-client-secret",
      MICROSOFT_REDIRECT_URI: "http://localhost:3000/v1/oauth/microsoft/callback",
      MICROSOFT_TENANT_ID: "common",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "whatsapp-verify-token",
      WHATSAPP_APP_SECRET: "whatsapp-app-secret",
      WHATSAPP_READINESS_MODE: "webhook_inbound",
      CONNECTOR_CREDENTIAL_VAULT_MODE: "memory",
      CONNECTOR_MANAGED_SECRET_PROVIDER: "external_reference",
      CONNECTOR_MANAGED_SECRET_PREFIX: "orchestra/",
      CONNECTOR_OAUTH_STATE_SECRET: "test-connector-oauth-state-secret",
      CONNECTOR_SYNC_BATCH_SIZE: 100,
      CONNECTOR_SYNC_MAX_BACKFILL_DAYS: 30,
      OPENAI_EMBEDDING_MODEL: "mock",
      RETRIEVAL_TOP_K: 8,
      RETRIEVAL_MIN_SCORE: 0.2,
      RETRIEVAL_USE_HYBRID: true,
      RETRIEVAL_DOC_WEIGHT: 1,
      RETRIEVAL_COMM_WEIGHT: 0.8,
      RETRIEVAL_ACCEPTED_TRUTH_BOOST: 1.2,
      SOCRATES_MAX_CONTEXT_TOKENS: 12000,
      SOCRATES_MAX_HISTORY_TURNS: 8,
      SOCRATES_RETRIEVAL_TOP_K: 32,
      SOCRATES_RERANK_TOP_K: 8,
      SOCRATES_MAX_CITATIONS: 6,
      SOCRATES_MAX_OUTPUT_TOKENS: 1800,
      FDE_READINESS_INTELLIGENCE_ENABLED: true,
      FDE_READINESS_SEMANTIC_MATCHING_ENABLED: false,
      FDE_READINESS_MAX_EVIDENCE_ITEMS: 500,
      METRICS_TOKEN: undefined
    },
    logger: pino({ enabled: false }),
    prisma: {
      user: {
        findFirst: vi.fn(async ({ where }: any) => {
          if (where?.id === "user-1" && where?.orgId === "org-1") {
            return { id: "user-1", orgId: "org-1", workspaceRoleDefault: "manager", globalRole: "owner" };
          }
          if (where?.id === "dev-user-1" && where?.orgId === "org-1") {
            return { id: "dev-user-1", orgId: "org-1", workspaceRoleDefault: "dev", globalRole: "member" };
          }
          if (where?.id === "client-user-1" && where?.orgId === "org-1") {
            return { id: "client-user-1", orgId: "org-1", workspaceRoleDefault: "client", globalRole: "member" };
          }
          return null;
        })
      },
      organizationMembership: {
        findUnique: vi.fn(async ({ where }: any) => {
          const { organizationId, userId } = where?.organizationId_userId ?? {};
          if (organizationId !== "org-1") return null;
          const roles: Record<string, { workspaceRoleDefault: "manager" | "dev" | "client"; globalRole: "owner" | "member" }> = {
            "user-1": { workspaceRoleDefault: "manager", globalRole: "owner" },
            "dev-user-1": { workspaceRoleDefault: "dev", globalRole: "member" },
            "client-user-1": { workspaceRoleDefault: "client", globalRole: "member" }
          };
          if (userId === "inactive-user-1") {
            return {
              id: "org-member-inactive-user",
              organizationId,
              userId,
              workspaceRoleDefault: "manager",
              globalRole: "owner",
              isActive: true,
              user: { isActive: false }
            };
          }
          const role = roles[userId];
          return role
            ? {
                id: `org-member-${userId}`,
                organizationId,
                userId,
                ...role,
                isActive: true,
                user: { isActive: true }
              }
            : null;
        })
      },
      projectMember: {
        findFirst: vi.fn(async ({ where }: any) => {
          const roleByUserId: Record<string, "manager" | "dev" | "client"> = {
            "user-1": "manager",
            "dev-user-1": "dev",
            "client-user-1": "client"
          };
          const projectRole = roleByUserId[where?.userId];
          if (!projectRole || where?.project?.orgId !== "org-1") return null;
          return {
            id: `project-member-${where.userId}`,
            projectId: where.projectId,
            userId: where.userId,
            projectRole,
            canApproveTruthChanges: projectRole === "manager",
            isActive: true
          };
        })
      }
    } as any,
    storage: {} as any,
    generationProvider: {} as any,
    embeddingProvider: {} as any,
    transcriptionProvider: {} as any,
    jobs: { enqueue: vi.fn() },
    telemetry: {
      increment: vi.fn(),
      observeDuration: vi.fn(),
      setGauge: vi.fn(),
      renderPrometheus: vi.fn(() => "")
    } as any,
    services: {
      authService,
      projectService,
      projectResponsibilitiesService,
      projectContextService,
      projectDiagramService,
      codingRequirementsService,
      documentService,
      documentGenerationService,
      brainService,
      changeProposalService,
      auditService,
      socratesService,
      editorConnectorService,
      socratesActionService,
      dashboardService,
      betaTimelineService,
      liveDocService,
      projectOpsService,
      calendarConnectionsService,
      communicationsService,
      githubIntegrationService,
      suggestionsService,
      truthInboxService,
      truthChangePacketService,
      meService,
      integrationManagementService,
      clientSharesService,
      clientViewService,
      agentContextPackService,
      agentRunMemoryService,
      agentFilesService,
      engineeringEvidenceService,
      fdeReadinessService,
      mcpService
    }
  } as unknown as AppContext;
}

describe("route contracts", () => {
  it("accepts bounded authenticated Web Vitals without accepting arbitrary page content", async () => {
    const payload = { metric: "LCP", value: 2400, sampleId: "v5-1234567890-1234567890", device: "desktop" };
    const accepted = await app.inject({ method: "POST", url: "/v1/me/web-vitals", headers: { authorization: `Bearer ${createToken("manager")}` }, payload });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().data).toEqual({ accepted: true });
    const anonymous = await app.inject({ method: "POST", url: "/v1/me/web-vitals", payload });
    expect(anonymous.statusCode).toBe(401);
    const invalid = await app.inject({ method: "POST", url: "/v1/me/web-vitals", headers: { authorization: `Bearer ${createToken("manager")}` }, payload: { ...payload, value: -1, documentText: "must not be accepted" } });
    expect(invalid.statusCode).toBe(400);
  });

  const context = createContext();
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp(context);
  });

  afterAll(async () => {
    await app.close();
  });

  it("supports auth signup route", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        orgName: "Org",
        email: "manager@example.com",
        password: "Password123!",
        displayName: "Manager"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(context.services.authService.signup).toHaveBeenCalled();
  });

  it("creates HttpOnly browser cookies without exposing bearer tokens in the response", async () => {
    const csrf = await app.inject({ method: "GET", url: "/v1/auth/csrf" });
    expect(csrf.statusCode).toBe(200);
    const csrfToken = csrf.json().data.csrfToken as string;
    const csrfCookie = cookieHeader(csrf.headers["set-cookie"]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: {
        origin: "http://localhost:3001",
        cookie: csrfCookie,
        "x-csrf-token": csrfToken
      },
      payload: {
        email: "manager@example.com",
        password: "Password123!",
        sessionMode: "browser"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).not.toHaveProperty("accessToken");
    expect(response.json().data).not.toHaveProperty("refreshToken");
    const setCookies = normalizeSetCookie(response.headers["set-cookie"]);
    expect(setCookies.some((cookie) => cookie.startsWith("orchestra_access=") && cookie.includes("HttpOnly"))).toBe(true);
    expect(setCookies.some((cookie) => cookie.startsWith("orchestra_refresh=") && cookie.includes("HttpOnly"))).toBe(true);
  });

  it("rejects browser login from an untrusted origin before service dispatch", async () => {
    vi.mocked(context.services.authService.login).mockClear();
    const csrf = await app.inject({ method: "GET", url: "/v1/auth/csrf" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: {
        origin: "https://evil.example",
        cookie: cookieHeader(csrf.headers["set-cookie"]),
        "x-csrf-token": csrf.json().data.csrfToken
      },
      payload: {
        email: "manager@example.com",
        password: "Password123!",
        sessionMode: "browser"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("browser_origin_forbidden");
    expect(context.services.authService.login).not.toHaveBeenCalled();
  });

  it("requires CSRF for cookie-authenticated mutations but preserves bearer clients", async () => {
    const accessToken = createToken("manager");
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: {
        origin: "http://localhost:3001",
        cookie: `orchestra_access=${accessToken}`
      },
      payload: { name: "Blocked project" }
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("csrf_invalid");

    const bearer = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: "Bearer project" }
    });
    expect(bearer.statusCode).toBe(200);
  });

  it("refreshes and logs out browser sessions using only the protected refresh cookie", async () => {
    vi.mocked(context.services.authService.refresh).mockClear();
    vi.mocked(context.services.authService.logout).mockClear();
    const csrf = await app.inject({ method: "GET", url: "/v1/auth/csrf" });
    const csrfToken = csrf.json().data.csrfToken as string;
    const csrfCookie = cookieHeader(csrf.headers["set-cookie"]);
    const browserCookies = `${csrfCookie}; orchestra_refresh=browser-refresh`;

    const refreshed = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      headers: {
        origin: "http://localhost:3001",
        cookie: browserCookies,
        "x-csrf-token": csrfToken
      }
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().data).toEqual({ refreshed: true });
    expect(context.services.authService.refresh).toHaveBeenCalledWith(
      "browser-refresh",
      "browser",
      expect.objectContaining({ ipAddress: "127.0.0.1" })
    );
    expect(refreshed.json().data).not.toHaveProperty("accessToken");

    const loggedOut = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        origin: "http://localhost:3001",
        cookie: browserCookies,
        "x-csrf-token": csrfToken
      }
    });
    expect(loggedOut.statusCode).toBe(200);
    expect(context.services.authService.logout).toHaveBeenCalledWith("browser-refresh");
    expect(normalizeSetCookie(loggedOut.headers["set-cookie"]).filter((cookie) =>
      cookie.startsWith("orchestra_access=") || cookie.startsWith("orchestra_refresh=")
    ).every((cookie) => cookie.includes("Max-Age=0"))).toBe(true);
  });

  it("returns account and workspaces in one protected browser bootstrap without rotating a valid session", async () => {
    const csrf = await app.inject({ method: "GET", url: "/v1/auth/csrf" });
    vi.mocked(context.services.authService.refresh).mockClear();
    const response = await app.inject({ method: "POST", url: "/v1/auth/bootstrap",
      headers: { origin: "http://localhost:3001", "x-csrf-token": csrf.json().data.csrfToken,
        cookie: `${cookieHeader(csrf.headers["set-cookie"])}; orchestra_access=${createToken("manager")}` },
      payload: { sessionMode: "browser" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.user.id).toBe("user-1");
    expect(response.json().data.workspaces[0].projectId).toBe(PROJECT_ID);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(context.services.authService.refresh).not.toHaveBeenCalled();
  });

  it("requires CSRF for bootstrap and never accepts bearer overrides", async () => {
    const blocked = await app.inject({ method: "POST", url: "/v1/auth/bootstrap",
      headers: { origin: "http://localhost:3001", cookie: `orchestra_access=${createToken("manager")}` },
      payload: { sessionMode: "browser" } });
    expect(blocked.statusCode).toBe(403);
    const bearer = await app.inject({ method: "POST", url: "/v1/auth/bootstrap",
      headers: { authorization: `Bearer ${createToken("manager")}` }, payload: {} });
    expect(bearer.statusCode).not.toBe(200);
  });

  it("recovers an expired access cookie and returns startup data without exposing tokens", async () => {
    const identity = { userId:"user-1", orgId:"org-1", sessionId:"session-1", typ:"access", globalRole:"owner", workspaceRoleDefault:"manager" };
    const expired = jwt.sign(identity,"test-access-secret",{expiresIn:-1});
    const access = jwt.sign(identity,"test-access-secret",{expiresIn:"15m"});
    vi.mocked(context.services.authService.refresh).mockResolvedValueOnce({accessToken:access,refreshToken:"next-refresh"});
    const csrf = await app.inject({method:"GET",url:"/v1/auth/csrf"});
    const response = await app.inject({ method:"POST",url:"/v1/auth/bootstrap",payload:{sessionMode:"browser"},
      headers:{origin:"http://localhost:3001","x-csrf-token":csrf.json().data.csrfToken,
        cookie:`${cookieHeader(csrf.headers["set-cookie"])}; orchestra_access=${expired}; orchestra_refresh=old-refresh`} });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.user.id).toBe("user-1");
    expect(response.json().data.workspaces).toHaveLength(1);
    expect(response.json().data).not.toHaveProperty("accessToken");
    expect(response.json().data).not.toHaveProperty("refreshToken");
    expect(cookieHeader(response.headers["set-cookie"])).toContain("orchestra_refresh=next-refresh");
    expect(context.services.authService.authorizeSessionContext).toHaveBeenCalledWith("session-1","user-1","org-1");
  });

  it("does not refresh a revoked session or conceal workspace failure as an empty startup", async () => {
    const access = jwt.sign({userId:"user-1",orgId:"org-1",sessionId:"session-1",typ:"access"},"test-access-secret");
    const csrf = await app.inject({method:"GET",url:"/v1/auth/csrf"});
    const headers = {origin:"http://localhost:3001","x-csrf-token":csrf.json().data.csrfToken,
      cookie:`${cookieHeader(csrf.headers["set-cookie"])}; orchestra_access=${access}; orchestra_refresh=old-refresh`};
    vi.mocked(context.services.authService.refresh).mockClear();
    vi.mocked(context.services.authService.authorizeSessionContext).mockRejectedValueOnce(new AppError(401,"Revoked","session_revoked"));
    const revoked = await app.inject({method:"POST",url:"/v1/auth/bootstrap",headers,payload:{sessionMode:"browser"}});
    expect(revoked.statusCode).toBe(401);
    expect(context.services.authService.refresh).not.toHaveBeenCalled();
    vi.mocked(context.services.meService.listWorkspaces).mockRejectedValueOnce(new AppError(503,"Unavailable","database_unavailable"));
    const failed = await app.inject({method:"POST",url:"/v1/auth/bootstrap",headers,payload:{sessionMode:"browser"}});
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe("database_unavailable");
  });

  it("recovers a missing access cookie but retains rotation cookies if the workspace read fails", async () => {
    const access = jwt.sign({userId:"user-1",orgId:"org-1",sessionId:"session-1",typ:"access"},"test-access-secret");
    const csrf = await app.inject({method:"GET",url:"/v1/auth/csrf"});
    const headers = {origin:"http://localhost:3001","x-csrf-token":csrf.json().data.csrfToken,
      cookie:`${cookieHeader(csrf.headers["set-cookie"])}; orchestra_refresh=old-refresh`};
    vi.mocked(context.services.authService.refresh).mockResolvedValueOnce({accessToken:access,refreshToken:"next-refresh"});
    vi.mocked(context.services.meService.listWorkspaces).mockRejectedValueOnce(new AppError(503,"Unavailable","database_unavailable"));
    const response = await app.inject({method:"POST",url:"/v1/auth/bootstrap",headers,payload:{sessionMode:"browser"}});
    expect(response.statusCode).toBe(503);
    expect(cookieHeader(response.headers["set-cookie"])).toContain("orchestra_refresh=next-refresh");
    vi.mocked(context.services.authService.refresh).mockClear();
    const forbidden = await app.inject({method:"POST",url:"/v1/auth/bootstrap",headers:{...headers,origin:"https://attacker.invalid"},payload:{sessionMode:"browser"}});
    expect(forbidden.statusCode).toBe(403);
    expect(context.services.authService.refresh).not.toHaveBeenCalled();
  });

  it("preserves authenticated bearer refresh and logout contracts even when stale cookies are attached", async () => {
    vi.mocked(context.services.authService.refresh).mockClear();
    vi.mocked(context.services.authService.logout).mockClear();
    const accessToken = createToken("manager");
    const headers = {
      authorization: `Bearer ${accessToken}`,
      cookie: "orchestra_refresh=stale-browser-refresh"
    };

    const refreshed = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      headers,
      payload: { refreshToken: "bearer-refresh" }
    });
    expect(refreshed.statusCode).toBe(200);
    expect(context.services.authService.refresh).toHaveBeenCalledWith(
      "bearer-refresh",
      "bearer",
      expect.objectContaining({ ipAddress: "127.0.0.1" })
    );
    expect(refreshed.json().data).toEqual({ accessToken: "access-2", refreshToken: "refresh-2" });

    const loggedOut = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers,
      payload: { refreshToken: "bearer-refresh" }
    });
    expect(loggedOut.statusCode).toBe(200);
    expect(context.services.authService.logout).toHaveBeenCalledWith("bearer-refresh");
  });

  it("redeems invitations through the correct existing-account and new-account contracts", async () => {
    const existing = await app.inject({
      method: "POST",
      url: "/v1/auth/invitations/redeem",
      payload: {
        accountType: "existing",
        email: "invitee@example.com",
        password: "Password123!",
        code: "ORCH-ABC123-DEF456"
      }
    });
    const created = await app.inject({
      method: "POST",
      url: "/v1/auth/invitations/redeem",
      payload: {
        accountType: "new",
        email: "new-invitee@example.com",
        password: "Password123!",
        displayName: "New Invitee",
        code: "ORCH-ABC123-DEF456"
      }
    });

    expect(existing.statusCode).toBe(200);
    expect(existing.json().data.invitation.projectId).toBe(PROJECT_ID);
    expect(created.statusCode).toBe(200);
    expect(context.services.authService.redeemInvitationForExistingAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountType: "existing", email: "invitee@example.com" }),
      expect.objectContaining({ ipAddress: "127.0.0.1" })
    );
    expect(context.services.authService.completeInvitationAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountType: "new", displayName: "New Invitee" }),
      expect.objectContaining({ ipAddress: "127.0.0.1" })
    );
  });

  it("rejects the legacy passwordless join route before service dispatch", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/join-workspace",
      payload: { email: "invitee@example.com", code: "ORCH-ABC123-DEF456" }
    });

    expect(response.statusCode).toBe(400);
    expect(context.services.authService.joinWorkspace).not.toHaveBeenCalled();
  });

  it("supports one-time email verification and verified-account password changes", async () => {
    const confirmed = await app.inject({
      method: "POST",
      url: "/v1/auth/email-verification/confirm",
      payload: { token: "a".repeat(43) }
    });
    expect(confirmed.statusCode).toBe(200);
    expect(context.services.authService.confirmEmailVerification).toHaveBeenCalledWith("a".repeat(43));

    const authorization = { authorization: `Bearer ${createToken("manager")}` };
    const requested = await app.inject({
      method: "POST",
      url: "/v1/auth/email-verification/request",
      headers: authorization,
      payload: { projectId: PROJECT_ID }
    });
    expect(requested.statusCode).toBe(200);
    expect(context.services.authService.requestEmailVerification).toHaveBeenCalledWith({ userId: "user-1", orgId: "org-1", projectId: PROJECT_ID });

    const changed = await app.inject({
      method: "POST",
      url: "/v1/auth/password/change",
      headers: authorization,
      payload: { currentPassword: "CurrentPassword123!", newPassword: "NewPassword456!" }
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data).toEqual({ changed: true, sessionsRevoked: true });
    expect(context.services.authService.changePassword).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", orgId: "org-1", newPassword: "NewPassword456!" }));
  });

  it("serves stateless Streamable HTTP MCP initialization and notifications", async () => {
    const initialized = await app.inject({
      method: "POST",
      url: "/v1/mcp",
      headers: { authorization: "Bearer mcp_test", accept: "application/json, text/event-stream" },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", clientInfo: { name: "test", version: "1" }, capabilities: {} } }
    });
    expect(initialized.statusCode).toBe(200);
    expect(initialized.headers["mcp-protocol-version"]).toBe("2025-11-25");
    expect(initialized.json()).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-11-25" } });

    const notification = await app.inject({
      method: "POST",
      url: "/v1/mcp",
      headers: { authorization: "Bearer mcp_test" },
      payload: { jsonrpc: "2.0", method: "notifications/initialized", params: {} }
    });
    expect(notification.statusCode).toBe(202);
    expect(notification.body).toBe("");

    const get = await app.inject({ method: "GET", url: "/v1/mcp" });
    expect(get.statusCode).toBe(405);
    expect(get.headers.allow).toBe("POST, DELETE");
  });

  it("sets generic security headers on public responses", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("returns one validated correlation id in the response and structured error envelope", async () => {
    const accepted = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "frontend-request-42" }
    });
    expect(accepted.headers["x-request-id"]).toBe("frontend-request-42");

    context.env.METRICS_TOKEN = "correlation-test-token";
    const rejected = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { "x-request-id": "unsafe request id", "x-metrics-token": "wrong-token" }
    });
    context.env.METRICS_TOKEN = undefined;
    expect(rejected.statusCode).toBe(403);
    expect(rejected.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(rejected.json().meta.requestId).toBe(rejected.headers["x-request-id"]);
  });

  it("rejects stale access tokens when the signed user is no longer active", async () => {
    vi.mocked(context.services.projectService.listProjects).mockClear();
    const staleToken = jwt.sign(
      { userId: "inactive-user-1", orgId: "org-1", workspaceRoleDefault: "manager", globalRole: "owner", typ: "access" },
      "test-access-secret"
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: {
        authorization: `Bearer ${staleToken}`
      }
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("auth_user_inactive");
    expect(context.services.projectService.listProjects).not.toHaveBeenCalled();
  });

  it("uses current database roles instead of stale JWT role claims", async () => {
    vi.mocked(context.services.projectService.listProjects).mockClear();
    const staleManagerToken = jwt.sign(
      { userId: "client-user-1", orgId: "org-1", workspaceRoleDefault: "manager", globalRole: "owner", typ: "access" },
      "test-access-secret"
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: {
        authorization: `Bearer ${staleManagerToken}`
      }
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe("client_internal_access_forbidden");
    expect(context.services.projectService.listProjects).not.toHaveBeenCalled();
  });

  it("rejects a valid token when its active organization membership is missing", async () => {
    vi.mocked(context.services.projectService.listProjects).mockClear();
    const token = jwt.sign(
      {
        userId: "membership-inactive-user",
        orgId: "org-1",
        workspaceRoleDefault: "manager",
        globalRole: "owner",
        typ: "access"
      },
      "test-access-secret"
    );

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("auth_membership_inactive");
    expect(context.services.projectService.listProjects).not.toHaveBeenCalled();
  });

  it("blocks a cross-tenant project ID before dispatching to a domain service", async () => {
    vi.mocked(context.services.projectService.getProject).mockClear();
    vi.mocked(context.prisma.projectMember.findFirst).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("project_access_denied");
    expect(context.services.projectService.getProject).not.toHaveBeenCalled();
  });

  it("uses project role for project management without elevating the workspace role", async () => {
    vi.mocked(context.services.projectService.grantTruthApprover).mockClear();
    vi.mocked(context.prisma.projectMember.findFirst).mockResolvedValueOnce({
      id: "project-manager-dev-workspace",
      projectId: PROJECT_ID,
      userId: "dev-user-1",
      projectRole: "manager",
      canApproveTruthChanges: true,
      isActive: true
    } as any);

    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/truth-approvers`,
      headers: { authorization: `Bearer ${createToken("dev")}` },
      payload: { memberId: "3322717f-2c10-4239-b525-6fbc9158f4fb" }
    });

    expect(response.statusCode).toBe(200);
    expect(context.services.projectService.grantTruthApprover).toHaveBeenCalled();
  });

  it("does not let a workspace manager bypass a non-manager project role", async () => {
    vi.mocked(context.services.projectService.grantTruthApprover).mockClear();
    vi.mocked(context.prisma.projectMember.findFirst).mockResolvedValueOnce({
      id: "project-dev-workspace-manager",
      projectId: PROJECT_ID,
      userId: "user-1",
      projectRole: "dev",
      canApproveTruthChanges: false,
      isActive: true
    } as any);

    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/truth-approvers`,
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: { memberId: "3322717f-2c10-4239-b525-6fbc9158f4fb" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("manager_access_required");
    expect(context.services.projectService.grantTruthApprover).not.toHaveBeenCalled();
  });

  it("blocks client workspace tokens from internal product routes before service dispatch", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const token = createToken("client");
    const requests: Array<{ method: "GET" | "POST"; url: string; payload?: Record<string, unknown> }> = [
      { method: "GET", url: "/v1/projects" },
      { method: "GET", url: `/v1/projects/${projectId}/brain/current` },
      { method: "GET", url: `/v1/projects/${projectId}/documents` },
      {
        method: "POST",
        url: `/v1/projects/${projectId}/documents/generate`,
        payload: {
          kind: "prd",
          template: "basic_mvp",
          prompt: "Build a rental management MVP for landlords and tenants"
        }
      },
      { method: "POST", url: `/v1/projects/${projectId}/socrates/sessions`, payload: { pageContext: "brain_overview" } },
      { method: "GET", url: `/v1/projects/${projectId}/communications/timeline` },
      { method: "GET", url: `/v1/projects/${projectId}/live-doc/current` },
      { method: "GET", url: "/v1/dashboard/general" },
      { method: "GET", url: `/v1/projects/${projectId}/dashboard` },
      { method: "GET", url: `/v1/projects/${projectId}/responsibilities` },
      { method: "GET", url: `/v1/projects/${projectId}/context` },
      { method: "GET", url: `/v1/projects/${projectId}/agent-context-packs` },
      { method: "POST", url: `/v1/projects/${projectId}/agent-context-packs/22222222-2222-4222-8222-222222222222/exports`, payload: { format: "markdown" } },
      { method: "GET", url: `/v1/projects/${projectId}/agent-files` },
      { method: "POST", url: `/v1/projects/${projectId}/agent-files/default/generate`, payload: {} },
      { method: "GET", url: `/v1/projects/${projectId}/engineering-evidence` },
      { method: "POST", url: `/v1/projects/${projectId}/engineering-evidence/refresh`, payload: {} },
      { method: "GET", url: `/v1/projects/${projectId}/fde-readiness/conflicts` },
      { method: "POST", url: `/v1/projects/${projectId}/fde-readiness/refresh`, payload: {} },
      { method: "GET", url: `/v1/projects/${projectId}/financials` },
      { method: "GET", url: `/v1/projects/${projectId}/client-shares` }
    ];

    vi.mocked(context.services.projectService.listProjects).mockClear();
    vi.mocked(context.services.brainService.getCurrentBrain).mockClear();
    vi.mocked(context.services.documentService.listDocuments).mockClear();
    vi.mocked(context.services.documentGenerationService.generateDocument).mockClear();
    vi.mocked(context.services.socratesService.createSession).mockClear();
    vi.mocked(context.services.communicationsService.timeline.getTimeline).mockClear();
    vi.mocked(context.services.liveDocService.getCurrent).mockClear();
    vi.mocked(context.services.dashboardService.getGeneralDashboard).mockClear();
    vi.mocked(context.services.dashboardService.getProjectDashboard).mockClear();
    vi.mocked(context.services.projectResponsibilitiesService.listResponsibilities).mockClear();
    vi.mocked(context.services.projectContextService.listContext).mockClear();
    vi.mocked(context.services.agentContextPackService.listPacks).mockClear();
    vi.mocked(context.services.agentContextPackService.generateExport).mockClear();
    vi.mocked(context.services.agentFilesService.listFileSets).mockClear();
    vi.mocked(context.services.agentFilesService.generateFileSet).mockClear();
    vi.mocked(context.services.engineeringEvidenceService.listEvidence).mockClear();
    vi.mocked(context.services.engineeringEvidenceService.refresh).mockClear();
    vi.mocked(context.services.fdeReadinessService.listConflicts).mockClear();
    vi.mocked(context.services.fdeReadinessService.refreshAll).mockClear();
    vi.mocked(context.services.projectOpsService.getFinancialSummary).mockClear();
    vi.mocked(context.services.clientSharesService.listShares).mockClear();

    for (const request of requests) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: { authorization: `Bearer ${token}` },
        payload: request.payload
      });

      if (response.statusCode !== 403) {
        throw new Error(`${request.method} ${request.url} expected 403, got ${response.statusCode}: ${response.body}`);
      }
      const body = response.json();
      if (body.error?.code !== "client_internal_access_forbidden") {
        throw new Error(`${request.method} ${request.url} expected client_internal_access_forbidden, got: ${response.body}`);
      }
    }

    expect(context.services.projectService.listProjects).not.toHaveBeenCalled();
    expect(context.services.brainService.getCurrentBrain).not.toHaveBeenCalled();
    expect(context.services.documentService.listDocuments).not.toHaveBeenCalled();
    expect(context.services.documentGenerationService.generateDocument).not.toHaveBeenCalled();
    expect(context.services.socratesService.createSession).not.toHaveBeenCalled();
    expect(context.services.communicationsService.timeline.getTimeline).not.toHaveBeenCalled();
    expect(context.services.liveDocService.getCurrent).not.toHaveBeenCalled();
    expect(context.services.dashboardService.getGeneralDashboard).not.toHaveBeenCalled();
    expect(context.services.dashboardService.getProjectDashboard).not.toHaveBeenCalled();
    expect(context.services.projectResponsibilitiesService.listResponsibilities).not.toHaveBeenCalled();
    expect(context.services.projectContextService.listContext).not.toHaveBeenCalled();
    expect(context.services.agentContextPackService.listPacks).not.toHaveBeenCalled();
    expect(context.services.agentContextPackService.generateExport).not.toHaveBeenCalled();
    expect(context.services.agentFilesService.listFileSets).not.toHaveBeenCalled();
    expect(context.services.agentFilesService.generateFileSet).not.toHaveBeenCalled();
    expect(context.services.engineeringEvidenceService.listEvidence).not.toHaveBeenCalled();
    expect(context.services.engineeringEvidenceService.refresh).not.toHaveBeenCalled();
    expect(context.services.fdeReadinessService.listConflicts).not.toHaveBeenCalled();
    expect(context.services.fdeReadinessService.refreshAll).not.toHaveBeenCalled();
    expect(context.services.projectOpsService.getFinancialSummary).not.toHaveBeenCalled();
    expect(context.services.clientSharesService.listShares).not.toHaveBeenCalled();
  });

  it("supports Agent Context Pack create/list/view/refresh/archive/delete routes", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const packId = "22222222-2222-4222-8222-222222222222";
    const headers = { authorization: `Bearer ${createToken("manager")}` };
    const createResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/agent-context-packs`,
      headers,
      payload: {
        taskPrompt: "Implement KYC onboarding",
        taskType: "implementation",
        sourceMode: "task_prompt",
        budgetPreset: "normal"
      }
    });
    const listResponse = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/agent-context-packs`, headers });
    const getResponse = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/agent-context-packs/${packId}`, headers });
    const refreshResponse = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/agent-context-packs/${packId}/refresh`, headers });
    const archiveResponse = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/agent-context-packs/${packId}/archive`, headers });
    const deleteResponse = await app.inject({ method: "DELETE", url: `/v1/projects/${projectId}/agent-context-packs/${packId}`, headers });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().data).toMatchObject({
      id: packId,
      tokenEstimateMethod: "chars_div_4"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(getResponse.statusCode).toBe(200);
    expect(refreshResponse.statusCode).toBe(200);
    expect(archiveResponse.statusCode).toBe(200);
    expect(deleteResponse.statusCode).toBe(200);
    expect(context.services.agentContextPackService.createPack).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({ taskPrompt: "Implement KYC onboarding" })
    );
    expect(context.services.agentContextPackService.refreshPack).toHaveBeenCalledWith(projectId, packId, "user-1");
  });

  it("supports Agent Context Pack export format, preview, and generation routes", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const packId = "22222222-2222-4222-8222-222222222222";
    const headers = { authorization: `Bearer ${createToken("manager")}` };

    const formatsResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/agent-context-packs/${packId}/export-formats`,
      headers
    });
    expect(formatsResponse.statusCode).toBe(200);
    expect(formatsResponse.json().data.map((item: any) => item.format)).toContain("markdown");

    const previewResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/agent-context-packs/${packId}/exports/preview`,
      headers,
      payload: { format: "markdown", budgetPreset: "normal", redactionMode: "internal" }
    });
    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json().data.content).toContain("Orchestra");
    expect(context.services.agentContextPackService.previewExport).toHaveBeenCalledWith(
      projectId,
      packId,
      "user-1",
      expect.objectContaining({ format: "markdown", redactionMode: "internal" })
    );

    const generateResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/agent-context-packs/${packId}/exports`,
      headers,
      payload: { format: "codex_prompt", budgetPreset: "compact", redactionMode: "implementation_only" }
    });
    expect(generateResponse.statusCode).toBe(200);
    expect(generateResponse.json().data.format).toBe("codex_prompt");
    expect(context.services.agentContextPackService.generateExport).toHaveBeenCalledWith(
      projectId,
      packId,
      "user-1",
      expect.objectContaining({ format: "codex_prompt", budgetPreset: "compact" })
    );
  });

  it("supports Agent Run Memory create, list, view, update, status, review, archive, and delete routes", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const headers = { authorization: `Bearer ${createToken("manager")}` };

    const createResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/agent-runs`,
      headers,
      payload: {
        contextPackId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        targetAgent: { kind: "codex", name: "Codex" },
        provider: "codex",
        taskTitle: "Implement auth routes",
        taskType: "implementation",
        promptSource: "context_pack",
        outputSummary: "Codex implemented auth route tests.",
        filesChanged: ["src/modules/auth/routes.ts"],
        testsRun: ["npm test -- auth"]
      }
    });
    expect(createResponse.statusCode).toBe(201);
    expect(context.services.agentRunMemoryService.createRun).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({ taskTitle: "Implement auth routes", provider: "codex" })
    );

    const listResponse = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/agent-runs?provider=codex`, headers });
    expect(listResponse.statusCode).toBe(200);

    const viewResponse = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/agent-runs/${runId}`, headers });
    expect(viewResponse.statusCode).toBe(200);

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/agent-runs/${runId}`,
      headers,
      payload: { branchName: "feature/auth", modulesTouched: ["auth"] }
    });
    expect(updateResponse.statusCode).toBe(200);

    const statusResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/agent-runs/${runId}/status`,
      headers,
      payload: { status: "completed", note: "Agent returned output." }
    });
    expect(statusResponse.statusCode).toBe(200);

    const reviewResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/agent-runs/${runId}/review`,
      headers,
      payload: { reviewResult: "accepted", humanReviewNotes: "Looks correct." }
    });
    expect(reviewResponse.statusCode).toBe(200);

    const archiveResponse = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/agent-runs/${runId}/archive`, headers });
    expect(archiveResponse.statusCode).toBe(200);

    const deleteResponse = await app.inject({ method: "DELETE", url: `/v1/projects/${projectId}/agent-runs/${runId}`, headers });
    expect(deleteResponse.statusCode).toBe(200);
  });

  it("readiness-gates client-safe Agent Context exports", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const packId = "22222222-2222-4222-8222-222222222222";
    const headers = { authorization: `Bearer ${createToken("manager")}` };
    vi.mocked(context.services.agentContextPackService.generateExport).mockRejectedValueOnce(
      new AppError(409, "Client-safe Agent Context exports are readiness-gated", "agent_context_client_safe_export_unavailable")
    );

    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/agent-context-packs/${packId}/exports`,
      headers,
      payload: { format: "markdown", redactionMode: "client_safe" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("agent_context_client_safe_export_unavailable");
  });

  it("supports MVP Engineering Evidence Index foundation routes", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const evidenceId = "11111111-1111-4111-8111-111111111111";
    const headers = { authorization: `Bearer ${createToken("manager")}` };

    const listResponse = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/engineering-evidence`, headers });
    expect(listResponse.statusCode).toBe(200);
    expect(context.services.engineeringEvidenceService.listEvidence).toHaveBeenCalledWith(
      projectId,
      { userId: "user-1", orgId: "org-1" },
      expect.objectContaining({ limit: 50 })
    );

    const sourcesResponse = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/engineering-evidence/sources`, headers });
    expect(sourcesResponse.statusCode).toBe(200);

    const refreshResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/engineering-evidence/refresh`,
      headers,
      payload: { sourceTypes: ["github", "agent_run", "route_registry"] }
    });
    expect(refreshResponse.statusCode).toBe(202);

    const itemResponse = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/engineering-evidence/${evidenceId}`, headers });
    expect(itemResponse.statusCode).toBe(200);

    for (const route of ["mock-real-registry", "integration-seams", "branch-deploy-truth", "todo-fixme"]) {
      const response = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/${route}`, headers });
      expect(response.statusCode).toBe(200);
    }

    const manualResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/branch-deploy-truth/manual`,
      headers,
      payload: {
        targetKind: "deploy_state",
        title: "Manual MVP deploy note",
        status: "unknown",
        confidence: "medium"
      }
    });
    expect(manualResponse.statusCode).toBe(201);
    expect(context.services.engineeringEvidenceService.createManualEntry).toHaveBeenCalledWith(
      projectId,
      { userId: "user-1", orgId: "org-1" },
      expect.objectContaining({ entryType: "branch_deploy_truth", status: "unknown" })
    );
  });

  it("supports MVP FDE Readiness Intelligence routes without truth mutation", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const headers = { authorization: `Bearer ${createToken("manager")}` };
    vi.mocked(context.services.changeProposalService.accept).mockClear();
    vi.mocked(context.services.liveDocService.patchSection).mockClear();
    vi.mocked(context.services.brainService.rebuild).mockClear();

    for (const route of ["conflicts", "safe-to-touch", "duplicates", "live-working-map", "rationale-traces", "decision-links"]) {
      const response = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/fde-readiness/${route}`, headers });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.truthMutationAllowed).toBe(false);
    }

    const fileResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/fde-readiness/safe-to-touch/file?filePath=src%2Fapi%2Fbilling.ts`,
      headers
    });
    expect(fileResponse.statusCode).toBe(200);
    expect(context.services.fdeReadinessService.getSafeToTouchForFile).toHaveBeenCalledWith(
      projectId,
      { userId: "user-1", orgId: "org-1" },
      "src/api/billing.ts"
    );

    for (const route of ["conflicts", "safe-to-touch", "duplicates", "live-working-map"]) {
      const response = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/fde-readiness/${route}/refresh`, headers });
      expect(response.statusCode).toBe(202);
    }

    const traceResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/fde-readiness/rationale-traces`,
      headers,
      payload: { anchorType: "file", anchorRef: "src/api/billing.ts" }
    });
    expect(traceResponse.statusCode).toBe(201);
    expect(context.services.fdeReadinessService.createRationaleTrace).toHaveBeenCalledWith(
      projectId,
      { userId: "user-1", orgId: "org-1" },
      expect.objectContaining({ anchorType: "file" })
    );

    const linkResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/fde-readiness/decision-links`,
      headers,
      payload: {
        decisionId: "22222222-2222-4222-8222-222222222222",
        targetType: "file",
        targetRef: "src/api/billing.ts",
        relationshipType: "implements_decision"
      }
    });
    expect(linkResponse.statusCode).toBe(201);

    const refreshAllResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/fde-readiness/refresh`,
      headers
    });
    expect(refreshAllResponse.statusCode).toBe(202);
    expect(context.services.changeProposalService.accept).not.toHaveBeenCalled();
    expect(context.services.liveDocService.patchSection).not.toHaveBeenCalled();
    expect(context.services.brainService.rebuild).not.toHaveBeenCalled();
  });

  it("enforces manager-only project creation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        name: "Project"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(context.services.projectService.createProject).toHaveBeenCalled();
  });

  it("supports project membership add and update routes", async () => {
    const addResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/members",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        email: "dev@example.com",
        projectRole: "dev",
        roleInProject: "Backend Engineer",
        allocationPercent: 80,
        weeklyCapacityHours: 32
      }
    });

    expect(addResponse.statusCode).toBe(200);
    expect(context.services.projectService.addMember).toHaveBeenCalledWith(
      "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      "user-1",
      {
        email: "dev@example.com",
        projectRole: "dev",
        roleInProject: "Backend Engineer",
        allocationPercent: 80,
        weeklyCapacityHours: 32
      }
    );

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/members/3322717f-2c10-4239-b525-6fbc9158f4fb",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        isActive: false
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(context.services.projectService.updateMember).toHaveBeenCalledWith(
      "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      "3322717f-2c10-4239-b525-6fbc9158f4fb",
      "user-1",
      { isActive: false }
    );
  });

  it("supports lightweight project responsibility CRUD routes", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const responsibilityId = "11111111-1111-1111-1111-111111111111";

    vi.mocked(context.services.projectResponsibilitiesService.listResponsibilities).mockClear();
    vi.mocked(context.services.projectResponsibilitiesService.createResponsibility).mockClear();
    vi.mocked(context.services.projectResponsibilitiesService.getResponsibility).mockClear();
    vi.mocked(context.services.projectResponsibilitiesService.updateResponsibility).mockClear();
    vi.mocked(context.services.projectResponsibilitiesService.deleteResponsibility).mockClear();

    const listResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/responsibilities?area=frontend&page=1&pageSize=10`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(listResponse.statusCode).toBe(200);
    expect(context.services.projectResponsibilitiesService.listResponsibilities).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({ area: "frontend", page: 1, pageSize: 10 })
    );

    const createResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/responsibilities`,
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: {
        assigneeName: "Sara",
        title: "Own frontend",
        area: "frontend"
      }
    });
    expect(createResponse.statusCode).toBe(200);
    expect(context.services.projectResponsibilitiesService.createResponsibility).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({
        assigneeName: "Sara",
        title: "Own frontend",
        area: "frontend",
        status: "open",
        source: "manual"
      })
    );

    const detailResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/responsibilities/${responsibilityId}`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(context.services.projectResponsibilitiesService.getResponsibility).toHaveBeenCalledWith(
      projectId,
      responsibilityId,
      "user-1"
    );

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/responsibilities/${responsibilityId}`,
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: { status: "blocked" }
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(context.services.projectResponsibilitiesService.updateResponsibility).toHaveBeenCalledWith(
      projectId,
      responsibilityId,
      "user-1",
      { status: "blocked" }
    );

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/responsibilities/${responsibilityId}`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(context.services.projectResponsibilitiesService.deleteResponsibility).toHaveBeenCalledWith(
      projectId,
      responsibilityId,
      "user-1"
    );
  });

  it("rejects invalid responsibility payloads before service dispatch", async () => {
    vi.mocked(context.services.projectResponsibilitiesService.createResponsibility).mockClear();
    const response = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/responsibilities",
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: {
        title: "Own frontend",
        area: "frontend"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(context.services.projectResponsibilitiesService.createResponsibility).not.toHaveBeenCalled();
  });

  it("supports manual project context CRUD and reindex routes", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const contextId = "22222222-2222-4222-8222-222222222222";

    vi.mocked(context.services.projectContextService.listContext).mockClear();
    vi.mocked(context.services.projectContextService.createContext).mockClear();
    vi.mocked(context.services.projectContextService.getContext).mockClear();
    vi.mocked(context.services.projectContextService.updateContext).mockClear();
    vi.mocked(context.services.projectContextService.deleteContext).mockClear();
    vi.mocked(context.services.projectContextService.reindexContext).mockClear();

    const listResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/context?type=decision_note&tag=KYC&page=1&pageSize=10`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(listResponse.statusCode).toBe(200);
    expect(context.services.projectContextService.listContext).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({ type: "decision_note", tag: "kyc", page: 1, pageSize: 10 })
    );

    const createResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/context`,
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: {
        type: "decision_note",
        title: "KYC onboarding decision",
        body: "Client PM said onboarding must support KYC before payment setup.",
        participants: ["Client PM"],
        tags: ["KYC"],
        importance: "high"
      }
    });
    expect(createResponse.statusCode).toBe(200);
    expect(context.services.projectContextService.createContext).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({ type: "decision_note", tags: ["kyc"], importance: "high" })
    );

    const detailResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/context/${contextId}`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(context.services.projectContextService.getContext).toHaveBeenCalledWith(projectId, contextId, "user-1");

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/context/${contextId}`,
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: { title: "Updated decision" }
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(context.services.projectContextService.updateContext).toHaveBeenCalledWith(
      projectId,
      contextId,
      "user-1",
      { title: "Updated decision" }
    );

    const reindexResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/context/${contextId}/reindex`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(reindexResponse.statusCode).toBe(200);
    expect(context.services.projectContextService.reindexContext).toHaveBeenCalledWith(projectId, contextId, "user-1");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/context/${contextId}`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(context.services.projectContextService.deleteContext).toHaveBeenCalledWith(projectId, contextId, "user-1");
  });

  it("supports persisted diagram CRUD, generation, and Live Doc embed routes", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const diagramId = "44444444-4444-4444-8444-444444444444";

    vi.mocked(context.services.projectDiagramService.generateDiagram).mockClear();
    vi.mocked(context.services.projectDiagramService.createDiagram).mockClear();
    vi.mocked(context.services.projectDiagramService.listDiagrams).mockClear();
    vi.mocked(context.services.projectDiagramService.getDiagram).mockClear();
    vi.mocked(context.services.projectDiagramService.updateDiagram).mockClear();
    vi.mocked(context.services.projectDiagramService.deleteDiagram).mockClear();
    vi.mocked(context.services.projectDiagramService.embedDiagramInLiveDoc).mockClear();
    vi.mocked(context.services.projectDiagramService.removeDiagramFromLiveDoc).mockClear();

    const generateResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/diagrams/generate`,
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: { diagramType: "flowchart", prompt: "Generate onboarding flow", save: false }
    });
    expect(generateResponse.statusCode).toBe(200);
    expect(context.services.projectDiagramService.generateDiagram).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({ diagramType: "flowchart", save: false })
    );

    const createResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/diagrams`,
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: {
        title: "Onboarding flow",
        diagramType: "flowchart",
        mermaidSource: "flowchart TD\n  A[Start] --> B[Done]"
      }
    });
    expect(createResponse.statusCode).toBe(200);
    expect(context.services.projectDiagramService.createDiagram).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({ title: "Onboarding flow", diagramType: "flowchart" })
    );

    const listResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/diagrams?diagramType=flowchart&page=1&pageSize=10`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(listResponse.statusCode).toBe(200);
    expect(context.services.projectDiagramService.listDiagrams).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({ diagramType: "flowchart", page: 1, pageSize: 10 })
    );

    const detailResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/diagrams/${diagramId}`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(context.services.projectDiagramService.getDiagram).toHaveBeenCalledWith(projectId, diagramId, "user-1");

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/diagrams/${diagramId}`,
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: { title: "Updated flow" }
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(context.services.projectDiagramService.updateDiagram).toHaveBeenCalledWith(
      projectId,
      diagramId,
      "user-1",
      { title: "Updated flow" }
    );

    const embedResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/live-doc/sections/overview/diagrams/${diagramId}/embed`,
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: { sortOrder: 1 }
    });
    expect(embedResponse.statusCode).toBe(200);
    expect(context.services.projectDiagramService.embedDiagramInLiveDoc).toHaveBeenCalledWith(
      projectId,
      "overview",
      diagramId,
      "user-1",
      { sortOrder: 1 }
    );

    const unembedResponse = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/live-doc/sections/overview/diagrams/${diagramId}`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(unembedResponse.statusCode).toBe(200);
    expect(context.services.projectDiagramService.removeDiagramFromLiveDoc).toHaveBeenCalledWith(
      projectId,
      "overview",
      diagramId,
      "user-1"
    );

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/diagrams/${diagramId}`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(context.services.projectDiagramService.deleteDiagram).toHaveBeenCalledWith(projectId, diagramId, "user-1");
  });

  it("supports coding requirements generation, current, history, and flowchart routes", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    vi.mocked(context.services.codingRequirementsService.generate).mockClear();
    vi.mocked(context.services.codingRequirementsService.getCurrent).mockClear();
    vi.mocked(context.services.codingRequirementsService.getHistory).mockClear();
    vi.mocked(context.services.codingRequirementsService.getFlowchart).mockClear();

    const generateResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/coding-requirements/generate`,
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: { focus: "backend", includeMermaid: true, saveFlowchart: true }
    });
    expect(generateResponse.statusCode).toBe(200);
    expect(context.services.codingRequirementsService.generate).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({ focus: "backend", includeMermaid: true, saveFlowchart: true })
    );

    const currentResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/coding-requirements/current`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(currentResponse.statusCode).toBe(200);
    expect(context.services.codingRequirementsService.getCurrent).toHaveBeenCalledWith(projectId, "user-1");

    const historyResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/coding-requirements/history?page=1&pageSize=10`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(context.services.codingRequirementsService.getHistory).toHaveBeenCalledWith(
      projectId,
      "user-1",
      { page: 1, pageSize: 10 }
    );

    const flowchartResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/coding-requirements/flowchart`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(flowchartResponse.statusCode).toBe(200);
    expect(context.services.codingRequirementsService.getFlowchart).toHaveBeenCalledWith(projectId, "user-1");
    expect(JSON.parse(flowchartResponse.body).data.mermaid).toContain("flowchart TD");
  });

  it("supports multipart image context upload and signed attachment URL routes", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const contextId = "22222222-2222-4222-8222-222222222222";
    const attachmentId = "33333333-3333-4333-8333-333333333333";
    vi.mocked(context.services.projectContextService.createContextFromUpload).mockClear();
    vi.mocked(context.services.projectContextService.getContextAttachmentSignedUrl).mockClear();

    const boundary = "----orchestra-context-boundary";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="whatsapp.png"',
      "Content-Type: image/png",
      "",
      "synthetic",
      `--${boundary}`,
      'Content-Disposition: form-data; name="type"',
      "",
      "chat_screenshot",
      `--${boundary}`,
      'Content-Disposition: form-data; name="title"',
      "",
      "WhatsApp onboarding screenshot",
      `--${boundary}`,
      'Content-Disposition: form-data; name="caption"',
      "",
      "WhatsApp screenshot showing onboarding feedback.",
      `--${boundary}`,
      'Content-Disposition: form-data; name="tags"',
      "",
      '["WhatsApp"]',
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const uploadResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/context`,
      headers: {
        authorization: `Bearer ${createToken("manager")}`,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload
    });
    expect(uploadResponse.statusCode).toBe(200);
    expect(context.services.projectContextService.createContextFromUpload).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({
        type: "chat_screenshot",
        title: "WhatsApp onboarding screenshot",
        caption: "WhatsApp screenshot showing onboarding feedback.",
        tags: ["whatsapp"],
        file: expect.objectContaining({
          filename: "whatsapp.png",
          mimeType: "image/png",
          size: 9
        })
      })
    );

    const signedUrlResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/context/${contextId}/attachments/${attachmentId}/signed-url`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(signedUrlResponse.statusCode).toBe(200);
    expect(signedUrlResponse.json().data).toMatchObject({ url: "signed://context-attachment" });
    expect(context.services.projectContextService.getContextAttachmentSignedUrl).toHaveBeenCalledWith(
      projectId,
      contextId,
      attachmentId,
      "user-1"
    );

    const contentResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/context/${contextId}/attachments/${attachmentId}/content`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });
    expect(contentResponse.statusCode).toBe(200);
    expect(contentResponse.headers["content-type"]).toContain("image/png");
    expect(contentResponse.body).toBe("synthetic-image");
    expect(context.services.projectContextService.getContextAttachmentFile).toHaveBeenCalledWith(
      projectId,
      contextId,
      attachmentId,
      "user-1"
    );
  });

  it("rejects duplicate multipart context file parts before service dispatch", async () => {
    vi.mocked(context.services.projectContextService.createContextFromUpload).mockClear();
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const boundary = "----orchestra-context-duplicate-boundary";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="type"',
      "",
      "screenshot",
      `--${boundary}`,
      'Content-Disposition: form-data; name="title"',
      "",
      "Duplicate screenshot",
      `--${boundary}`,
      'Content-Disposition: form-data; name="caption"',
      "",
      "Duplicate file upload should be rejected.",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="one.png"',
      "Content-Type: image/png",
      "",
      "one",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="two.png"',
      "Content-Type: image/png",
      "",
      "two",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/context`,
      headers: {
        authorization: `Bearer ${createToken("manager")}`,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("duplicate_context_upload_file");
    expect(context.services.projectContextService.createContextFromUpload).not.toHaveBeenCalled();
  });

  it("rejects unsafe or reserved manual context payloads before service dispatch", async () => {
    vi.mocked(context.services.projectContextService.createContext).mockClear();
    const reserved = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/context",
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: {
        type: "generated_prd",
        title: "Generated PRD",
        body: "Generated documents stay in DocumentVersion."
      }
    });
    expect(reserved.statusCode).toBe(400);

    const unsafe = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/context",
      headers: { authorization: `Bearer ${createToken("manager")}` },
      payload: {
        type: "manual_note",
        title: "Unsafe note",
        body: "<script>alert(1)</script>"
      }
    });
    expect(unsafe.statusCode).toBe(400);
    expect(context.services.projectContextService.createContext).not.toHaveBeenCalled();
  });

  it("blocks dev users from project membership mutations", async () => {
    vi.mocked(context.services.projectService.addMember).mockClear();
    vi.mocked(context.services.projectService.updateMember).mockClear();

    const addResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/members",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      },
      payload: {
        email: "dev@example.com",
        projectRole: "dev"
      }
    });
    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/members/3322717f-2c10-4239-b525-6fbc9158f4fb",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      },
      payload: {
        isActive: false
      }
    });

    expect(addResponse.statusCode).toBe(403);
    expect(updateResponse.statusCode).toBe(403);
    expect(context.services.projectService.addMember).not.toHaveBeenCalled();
    expect(context.services.projectService.updateMember).not.toHaveBeenCalled();
  });

  it("exposes redacted project audit events to managers only", async () => {
    vi.mocked(context.services.auditService.listProjectEvents).mockClear();
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/audit-events?eventType=proposal_accepted&limit=25`,
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(context.services.auditService.listProjectEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        projectId,
        eventType: "proposal_accepted",
        limit: 25
      })
    );
    const body = JSON.parse(response.body);
    expect(JSON.stringify(body)).not.toContain("raw transcript body");
    expect(body.data[0].payload).toMatchObject({
      transcriptId: "[redacted]",
      credentialsRef: "[redacted]",
      rawBody: "[redacted]"
    });

    vi.mocked(context.services.auditService.listProjectEvents).mockClear();
    const devResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/audit-events`,
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(devResponse.statusCode).toBe(403);
    expect(context.services.auditService.listProjectEvents).not.toHaveBeenCalled();
  });

  it("redacts client-share bearer tokens before logging request URLs", () => {
    expect(redactSensitiveUrlForLogging("/v1/client/raw-client-token/bootstrap?x=1")).toBe(
      "/v1/client/[redacted]/bootstrap?x=[redacted]"
    );
  });

  it("redacts OAuth and token query parameters before logging request URLs", () => {
    expect(
      redactSensitiveUrlForLogging(
        "/v1/oauth/google/drive/callback?code=oauth-code&state=signed-state&scope=drive&client_secret=secret#frag"
      )
    ).toBe(
      "/v1/oauth/google/drive/callback?code=[redacted]&state=[redacted]&scope=[redacted]&client_secret=[redacted]"
    );
    expect(
      redactSensitiveUrlForLogging(
        "/login?mode=join&invite_token=raw-invite&verify_email=raw-verification&email=user%40example.com"
      )
    ).toBe(
      "/login?mode=[redacted]&invite_token=[redacted]&verify_email=[redacted]&email=[redacted]"
    );
  });

  it("returns viewer payload", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/3322717f-2c10-4239-b525-6fbc9158f4fb/view",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.document.id).toBe("doc-1");
  });

  it("lists documents with pagination metadata", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents?page=2&pageSize=10",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().meta).toMatchObject({
      page: 1,
      pageSize: 25,
      totalCount: 1
    });
    expect(context.services.documentService.listDocuments).toHaveBeenCalledWith(
      "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      "user-1",
      { page: 2, pageSize: 10 }
    );
  });

  it("rejects dev users from uploading source documents", async () => {
    vi.mocked(context.services.documentService.uploadFile).mockClear();

    const response = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/upload",
      headers: {
        authorization: `Bearer ${createToken("dev")}`,
        "content-type": "application/json"
      },
      payload: {
        kind: "internal_note",
        title: "Dev note",
        visibility: "internal",
        pastedText: "Implementation note"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(context.services.documentService.uploadFile).not.toHaveBeenCalled();
  });

  it("[R03] forwards the durable upload operation id to document persistence", async () => {
    vi.mocked(context.services.documentService.uploadFile).mockClear();
    vi.mocked(context.services.documentService.getUploadOperation).mockResolvedValueOnce(null);
    const operationId = "11111111-1111-4111-8111-111111111111";

    const response = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/upload",
      headers: {
        authorization: `Bearer ${createToken("manager")}`,
        "content-type": "application/json",
        "x-idempotency-key": operationId
      },
      payload: {
        kind: "reference",
        title: "Retry-safe upload",
        visibility: "internal",
        pastedText: "This retry retains its operation identity."
      }
    });

    expect(response.statusCode).toBe(200);
    expect(context.services.documentService.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ operationId }));
  });

  it("[R03] returns a completed operation before replaying an uploaded file", async () => {
    vi.mocked(context.services.documentService.uploadFile).mockClear();
    vi.mocked(context.services.documentService.getUploadOperation).mockReset().mockResolvedValue({
      documentId: "doc-1", documentVersionId: "ver-1", status: "pending", parseRevision: 1,
      operationId: "11111111-1111-4111-8111-111111111111"
    });
    const operationId = "11111111-1111-4111-8111-111111111111";

    const response = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/upload",
      headers: {
        authorization: `Bearer ${createToken("manager")}`,
        "content-type": "application/json",
        "x-idempotency-key": operationId
      },
      payload: { kind: "reference", title: "Retry-safe upload", visibility: "internal", pastedText: "This must not be uploaded twice." }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ documentId: "doc-1", operationId });
    expect(context.services.documentService.uploadFile).not.toHaveBeenCalled();
  });

  it("[R03] reconciles a completed upload without replaying the mutation", async () => {
    vi.mocked(context.services.documentService.getUploadOperation).mockReset().mockResolvedValue({
      documentId: "doc-1", documentVersionId: "ver-1", status: "pending", parseRevision: 1,
      operationId: "11111111-1111-4111-8111-111111111111"
    });
    vi.mocked(context.services.documentService.uploadFile).mockClear();
    const operationId = "11111111-1111-4111-8111-111111111111";

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/uploads/${operationId}`,
      headers: { authorization: `Bearer ${createToken("manager")}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ documentId: "doc-1", operationId });
    expect(context.services.documentService.getUploadOperation).toHaveBeenCalledWith(
      "37e6d602-cc1b-4cc9-bc6c-5547241fbf90", "user-1", operationId
    );
    expect(context.services.documentService.uploadFile).not.toHaveBeenCalled();
  });

  it("lists document generation templates for authorized project members", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/generation-templates",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "basic_mvp", kind: "prd" }),
        expect.objectContaining({ id: "basic_srs", kind: "srs" })
      ])
    );
    expect(context.services.projectService.ensureProjectMemberCanUploadContext).toHaveBeenCalledWith(
      "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      "user-1"
    );
  });

  it("generates PRD documents with the standard envelope", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/generate",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        kind: "prd",
        template: "basic_mvp",
        prompt: "Build a rental management MVP for landlords and tenants",
        contextIds: [],
        rebuildBrain: false
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        documentId: "doc-1",
        documentVersionId: "ver-1",
        status: "queued",
        title: "Generated PRD",
        kind: "prd",
        next: {
          rebuildBrainRecommended: true,
          brainRebuildQueued: false
        }
      },
      meta: null,
      error: null
    });
    expect(context.services.documentGenerationService.generateDocument).toHaveBeenCalledWith(
      "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      "user-1",
      expect.objectContaining({ kind: "prd", template: "basic_mvp" })
    );
  });

  it("rejects template kind mismatches before dispatching generation", async () => {
    vi.mocked(context.services.documentGenerationService.generateDocument).mockClear();
    const response = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/generate",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        kind: "prd",
        template: "basic_srs",
        prompt: "Build a rental management MVP for landlords and tenants"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(context.services.documentGenerationService.generateDocument).not.toHaveBeenCalled();
  });

  it("rejects dev users from document generation in normal mode", async () => {
    vi.mocked(context.services.documentGenerationService.generateDocument).mockClear();
    const response = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/generate",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      },
      payload: {
        kind: "prd",
        template: "basic_mvp",
        prompt: "Build a rental management MVP for landlords and tenants"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(context.services.documentGenerationService.generateDocument).not.toHaveBeenCalled();
  });

  it("supports document search", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/3322717f-2c10-4239-b525-6fbc9158f4fb/search?q=hello&limit=5",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].anchorId).toBe("overview-1");
    expect(context.services.documentService.searchDocument).toHaveBeenCalledWith(
      "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      "3322717f-2c10-4239-b525-6fbc9158f4fb",
      "user-1",
      { q: "hello", limit: 5 }
    );
  });

  it("supports anchor provenance lookup", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/3322717f-2c10-4239-b525-6fbc9158f4fb/anchors/overview-1/provenance",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.currentTruth.differsFromSource).toBe(true);
    expect(context.services.documentService.getAnchorProvenance).toHaveBeenCalled();
  });

  it("rejects ambiguous viewer target selectors", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/documents/3322717f-2c10-4239-b525-6fbc9158f4fb/view?anchorId=overview-1&sectionId=3322717f-2c10-4239-b525-6fbc9158f4fb",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(context.services.documentService.getViewerPayload).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        anchorId: "overview-1",
        sectionId: "3322717f-2c10-4239-b525-6fbc9158f4fb"
      })
    );
  });

  it("serves message evidence only for internal roles", async () => {
    const managerResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/messages/3322717f-2c10-4239-b525-6fbc9158f4fb",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(managerResponse.statusCode).toBe(200);
    expect(managerResponse.json().data.message.id).toBe("msg-1");
    expect(context.services.communicationsService.timeline.getMessage).toHaveBeenCalled();
    vi.mocked(context.services.communicationsService.timeline.getMessage).mockRejectedValueOnce(
      new AppError(403, "Clients cannot access communication evidence", "communication_access_denied")
    );

    const clientResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/messages/3322717f-2c10-4239-b525-6fbc9158f4fb",
      headers: {
        authorization: `Bearer ${createToken("client")}`
      }
    });

    expect(clientResponse.statusCode).toBe(403);
  });

  it("blocks clients from raw change proposal detail routes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/change-proposals/3322717f-2c10-4239-b525-6fbc9158f4fb",
      headers: {
        authorization: `Bearer ${createToken("client")}`
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it("rejects dev users without delegated truth-approval authority", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/change-proposals/3322717f-2c10-4239-b525-6fbc9158f4fb/accept",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it("allows an explicitly delegated dev truth approver to accept a change", async () => {
    vi.mocked(context.prisma.projectMember.findFirst).mockResolvedValueOnce({
      id: "delegated-approver-membership",
      projectId: PROJECT_ID,
      userId: "dev-user-1",
      projectRole: "dev",
      canApproveTruthChanges: true,
      isActive: true
    } as any);
    vi.mocked(context.services.projectService.ensureProjectTruthApprover).mockResolvedValueOnce({
      authority: "delegated_truth_approver",
      delegatedApproverGrantId: "delegated-approver-membership"
    } as any);

    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/change-proposals/3322717f-2c10-4239-b525-6fbc9158f4fb/accept`,
      headers: { authorization: `Bearer ${createToken("dev")}` }
    });

    expect(response.statusCode).toBe(200);
    expect(context.services.projectService.ensureProjectTruthApprover).toHaveBeenCalledWith(
      PROJECT_ID,
      "dev-user-1"
    );
  });

  it("serves metrics when the token matches", async () => {
    context.env.METRICS_TOKEN = "metrics-secret";
    context.telemetry.renderPrometheus = vi.fn(() => "orchestra_http_requests_total 5");

    const response = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: {
        "x-metrics-token": "metrics-secret"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("orchestra_http_requests_total");
  });

  it("serves the general dashboard to managers only", async () => {
    const managerResponse = await app.inject({
      method: "GET",
      url: "/v1/dashboard/general",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(managerResponse.statusCode).toBe(200);
    expect(context.services.dashboardService.getGeneralDashboard).toHaveBeenCalledWith({
      orgId: "org-1",
      actorUserId: "user-1",
      forceRefresh: false
    });

    const devResponse = await app.inject({
      method: "GET",
      url: "/v1/dashboard/general",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(devResponse.statusCode).toBe(403);
  });

  it("serves project dashboard and team summary", async () => {
    const dashboardResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/dashboard",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(dashboardResponse.statusCode).toBe(200);
    expect(context.services.dashboardService.getProjectDashboard).toHaveBeenCalledWith(
      "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      "dev-user-1",
      { forceRefresh: false }
    );

    const devForceResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/dashboard?forceRefresh=true",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(devForceResponse.statusCode).toBe(403);

    const managerForceResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/dashboard?forceRefresh=true",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(managerForceResponse.statusCode).toBe(200);
    expect(context.services.dashboardService.getProjectDashboard).toHaveBeenCalledWith(
      "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      "user-1",
      { forceRefresh: true }
    );

    const teamResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/team-summary",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(teamResponse.statusCode).toBe(200);
    expect(teamResponse.json().data.headcount).toBe(2);
  });

  it("serves Mission Control dashboard support routes from the beta-safe contract", async () => {
    const headers = { authorization: `Bearer ${createToken("manager")}` };
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";

    const mission = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/mission-control?limit=4&activityLimit=6&forceRefresh=true`,
      headers
    });
    expect(mission.statusCode).toBe(200);
    expect(mission.json().data).toMatchObject({
      stats: expect.any(Array),
      githubPreview: { state: "not_connected" },
      subscriptions: expect.any(Array)
    });
    expect(context.services.dashboardService.getMissionControl).toHaveBeenCalledWith(projectId, "user-1", {
      limit: 4,
      activityLimit: 6,
      forceRefresh: true
    });

    const activity = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/activity?limit=3`, headers });
    expect(activity.statusCode).toBe(200);
    expect(activity.json().data.items[0].source).toBe("manual");

    const recentChanges = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/recent-changes`, headers });
    expect(recentChanges.statusCode).toBe(200);
    expect(recentChanges.json().data.items[0].source).toBe("slack");

    const queries = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/socrates/recent-queries`, headers });
    expect(queries.statusCode).toBe(200);
    expect(queries.json().data.items[0].query).toBe("What changed?");

    const calendar = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/calendar-events`, headers });
    expect(calendar.statusCode).toBe(200);
    expect(calendar.json().data.items[0].source).toBe("manual");

    const createdCalendar = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/calendar-events`,
      headers,
      payload: { title: "Review", startsAt: "2026-05-31T10:00:00.000Z", eventType: "review" }
    });
    expect(createdCalendar.statusCode).toBe(200);
    expect(context.services.dashboardService.createCalendarEvent).toHaveBeenCalledWith(
      projectId,
      "user-1",
      expect.objectContaining({ title: "Review", eventType: "review" })
    );

    const github = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/github/preview`, headers });
    expect(github.statusCode).toBe(200);
    expect(github.json().data.state).toBe("not_connected");
  });

  it("enforces manager-only dashboard refresh", async () => {
    const managerResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/dashboard/refresh",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(managerResponse.statusCode).toBe(200);
    expect(context.services.dashboardService.refreshProjectDashboard).toHaveBeenCalled();

    const devResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/dashboard/refresh",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(devResponse.statusCode).toBe(403);
  });

  it("supports live doc current, history, comments, save, diagram, and provenance routes", async () => {
    const currentResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/live-doc/current?forceRefresh=true",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(currentResponse.statusCode).toBe(200);
    expect(context.services.liveDocService.getCurrent).toHaveBeenCalledWith(
      "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      "dev-user-1",
      { forceRefresh: true }
    );

    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/live-doc/sections/overview",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        content: "Manager approval is required and logged."
      }
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(context.services.liveDocService.patchSection).toHaveBeenCalled();

    const historyResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/live-doc/sections/overview/history",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(context.services.liveDocService.getSectionHistory).toHaveBeenCalled();

    const commentsResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/live-doc/comments",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      },
      payload: {
        sectionKey: "overview",
        bodyText: "Please tighten this wording."
      }
    });

    expect(commentsResponse.statusCode).toBe(200);
    expect(context.services.liveDocService.createComment).toHaveBeenCalled();

    const diagramResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/live-doc/diagrams/generate",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        kind: "flowchart"
      }
    });

    expect(diagramResponse.statusCode).toBe(200);
    expect(context.services.liveDocService.generateDiagram).toHaveBeenCalled();

    const provenanceResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/live-doc/sections/overview/provenance",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(provenanceResponse.statusCode).toBe(200);
    expect(context.services.liveDocService.getSectionProvenance).toHaveBeenCalled();
  });

  it("supports project ops routes and enforces manager-only org calendar", async () => {
    const managerCalendarResponse = await app.inject({
      method: "GET",
      url: "/v1/calendar?month=2026-04",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(managerCalendarResponse.statusCode).toBe(200);
    expect(context.services.projectOpsService.getCalendar).toHaveBeenCalledWith({
      actorUserId: "user-1",
      orgId: "org-1",
      projectId: undefined,
      from: undefined,
      to: undefined,
      month: "2026-04"
    });

    const devCalendarResponse = await app.inject({
      method: "GET",
      url: "/v1/calendar?month=2026-04",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(devCalendarResponse.statusCode).toBe(403);

    const projectId = "11111111-1111-1111-1111-111111111111";
    const meetingId = "22222222-2222-2222-2222-222222222222";
    const deadlineId = "33333333-3333-3333-3333-333333333333";
    const subscriptionId = "44444444-4444-4444-4444-444444444444";

    const meetingsResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/meetings?limit=10`,
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(meetingsResponse.statusCode).toBe(200);
    expect(context.services.projectOpsService.listMeetings).toHaveBeenCalledWith(
      projectId,
      "dev-user-1",
      expect.objectContaining({ limit: 10 })
    );

    const createMeetingResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/meetings`,
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        title: "Sprint Planning",
        eventType: "meeting",
        startsAt: "2026-04-23T10:00:00.000Z"
      }
    });

    expect(createMeetingResponse.statusCode).toBe(200);
    expect(context.services.projectOpsService.createMeeting).toHaveBeenCalled();

    const patchDeadlineResponse = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/deadlines/${deadlineId}`,
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        status: "completed"
      }
    });

    expect(patchDeadlineResponse.statusCode).toBe(200);
    expect(context.services.projectOpsService.updateDeadline).toHaveBeenCalledWith(
      projectId,
      deadlineId,
      "user-1",
      { status: "completed" }
    );

    const financialResponse = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/financials`,
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        currency: "USD",
        spentAmount: 30000
      }
    });

    expect(financialResponse.statusCode).toBe(200);
    expect(context.services.projectOpsService.updateFinancialSummary).toHaveBeenCalledWith(
      projectId,
      "user-1",
      { currency: "USD", spentAmount: 30000 }
    );

    const createSubscriptionResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/subscriptions`,
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        name: "AWS (EC2 + RDS)",
        category: "Infrastructure",
        cost: 420,
        billingType: "monthly",
        status: "active",
        provider: "AWS"
      }
    });

    expect(createSubscriptionResponse.statusCode).toBe(200);
    expect(context.services.projectOpsService.createSubscription).toHaveBeenCalled();

    const getMeetingResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/meetings/${meetingId}`,
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(getMeetingResponse.statusCode).toBe(200);
    expect(context.services.projectOpsService.getMeeting).toHaveBeenCalled();

    const getSubscriptionResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/subscriptions/${subscriptionId}`,
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(getSubscriptionResponse.statusCode).toBe(200);
    expect(context.services.projectOpsService.getSubscription).toHaveBeenCalled();
  });

  it("rejects invalid project ops payloads and manager-only mutations for non-managers", async () => {
    const projectId = "11111111-1111-1111-1111-111111111111";

    const invalidCalendarResponse = await app.inject({
      method: "GET",
      url: `/v1/calendar?from=2026-04-30T00:00:00.000Z&to=2026-04-01T00:00:00.000Z&projectId=${projectId}`,
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(invalidCalendarResponse.statusCode).toBeGreaterThanOrEqual(400);
    expect(context.services.projectOpsService.getCalendar).not.toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-04-30T00:00:00.000Z",
        to: "2026-04-01T00:00:00.000Z"
      })
    );

    const invalidMeetingResponse = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/meetings/22222222-2222-2222-2222-222222222222`,
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {}
    });

    expect(invalidMeetingResponse.statusCode).toBeGreaterThanOrEqual(400);

    vi.mocked(context.services.projectOpsService.createMeeting).mockRejectedValueOnce(
      new AppError(403, "Manager access required", "manager_access_required")
    );

    const devCreateResponse = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/meetings`,
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      },
      payload: {
        title: "Sprint Planning",
        eventType: "meeting",
        startsAt: "2026-04-23T10:00:00.000Z"
      }
    });

    expect(devCreateResponse.statusCode).toBe(403);
  });

  it("supports communication connector and timeline routes", async () => {
    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/connectors",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.list).toHaveBeenCalled();

    const readinessResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/connectors/readiness",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(readinessResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.listReadiness).toHaveBeenCalled();

    const connectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/connectors/manual_import/connect",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(connectResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.connect).toHaveBeenCalled();

    const syncResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/connectors/3322717f-2c10-4239-b525-6fbc9158f4fb/sync",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: { syncType: "manual" }
    });

    expect(syncResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.sync.queueSync).toHaveBeenCalled();

    const syncRunsResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/connectors/3322717f-2c10-4239-b525-6fbc9158f4fb/sync-runs",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(syncRunsResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.listSyncRuns).toHaveBeenCalled();

    const channelListResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/connectors/3322717f-2c10-4239-b525-6fbc9158f4fb/channels",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(channelListResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.listProviderChannels).toHaveBeenCalledWith(
      "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      "3322717f-2c10-4239-b525-6fbc9158f4fb",
      "user-1"
    );

    const jobRunsResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/job-runs?status=failed",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(jobRunsResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.listProjectJobRuns).toHaveBeenCalled();

    const devJobRunsResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/job-runs",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });
    expect(devJobRunsResponse.statusCode).toBe(403);

    const importResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/communications/import",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        provider: "manual_import",
        accountLabel: "Demo import",
        thread: {
          providerThreadId: "thread-reporting-001",
          subject: "Reporting requirement discussion",
          participants: [{ label: "Client", externalRef: "client@example.com" }]
        },
        messages: [
          {
            providerMessageId: "msg-001",
            senderLabel: "Client",
            sentAt: "2026-04-19T10:01:00.000Z",
            bodyText: "Can we add weekly reporting for managers?",
            messageType: "user",
            attachments: []
          }
        ]
      }
    });

    expect(importResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.importProviderBatch).toHaveBeenCalled();

    const firefliesImportResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/communications/import",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      },
      payload: {
        provider: "fireflies_ai",
        accountLabel: "Fireflies",
        meeting: {
          providerTranscriptId: "ff-1",
          title: "Client Kickoff",
          startedAt: "2026-05-12T10:00:00.000Z",
          participants: [{ name: "Sarah Client", email: "sarah@example.com" }]
        },
        segments: [
          {
            speakerName: "Sarah Client",
            startMs: 724000,
            endMs: 741000,
            text: "Let's change reporting from monthly to weekly."
          }
        ]
      }
    });

    expect(firefliesImportResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.getAdapter).toHaveBeenCalledWith("fireflies_ai");

    const timelineResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/communications/timeline?limit=10",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(timelineResponse.statusCode).toBe(200);
    expect(timelineResponse.json().data[0].threadId).toBe("thread-1");

    const revokeResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/connectors/3322717f-2c10-4239-b525-6fbc9158f4fb/revoke",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(revokeResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.revoke).toHaveBeenCalled();
    vi.mocked(context.services.communicationsService.timeline.getTimeline).mockRejectedValueOnce(
      new AppError(403, "Clients cannot access communication timeline", "communication_access_denied")
    );

    const clientTimelineResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/communications/timeline",
      headers: {
        authorization: `Bearer ${createToken("client")}`
      }
    });

    expect(clientTimelineResponse.statusCode).toBe(403);
  });

  it("blocks dev users from manager-only communication mutation routes before service dispatch", async () => {
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const connectorId = "3322717f-2c10-4239-b525-6fbc9158f4fb";
    const insightId = "3322717f-2c10-4239-b525-6fbc9158f4fb";
    const messageId = "3322717f-2c10-4239-b525-6fbc9158f4fb";
    const threadId = "3322717f-2c10-4239-b525-6fbc9158f4fb";
    const devToken = createToken("dev");

    const requests: Array<{
      method: "POST" | "PATCH";
      url: string;
      payload?: Record<string, unknown>;
      service: () => unknown;
      expectedCode?: "manager_access_required" | "truth_approver_required";
    }> = [
      {
        method: "PATCH",
        url: `/v1/projects/${projectId}/connectors/${connectorId}`,
        payload: { accountLabel: "Renamed" },
        service: () => context.services.communicationsService.connectors.update
      },
      {
        method: "POST",
        url: `/v1/projects/${projectId}/connectors/manual_import/connect`,
        service: () => context.services.communicationsService.connectors.connect
      },
      {
        method: "POST",
        url: `/v1/projects/${projectId}/connectors/${connectorId}/sync`,
        payload: { syncType: "manual" },
        service: () => context.services.communicationsService.sync.queueSync
      },
      {
        method: "POST",
        url: `/v1/projects/${projectId}/connectors/${connectorId}/revoke`,
        service: () => context.services.communicationsService.connectors.revoke
      },
      {
        method: "POST",
        url: `/v1/projects/${projectId}/communications/import`,
        payload: {
          provider: "manual_import",
          accountLabel: "Demo import",
          thread: { providerThreadId: "thread-1", participants: [{ label: "Client" }] },
          messages: [{ providerMessageId: "msg-1", senderLabel: "Client", sentAt: "2026-04-19T10:01:00.000Z", bodyText: "Need SSO", messageType: "user" }]
        },
        service: () => context.services.communicationsService.importProviderBatch
      },
      {
        method: "POST",
        url: `/v1/projects/${projectId}/message-insights/${insightId}/ignore`,
        service: () => context.services.communicationsService.messageInsights.ignore
      },
      {
        method: "POST",
        url: `/v1/projects/${projectId}/message-insights/${insightId}/create-proposal`,
        service: () => context.services.communicationsService.messageInsights.createProposal,
        expectedCode: "truth_approver_required"
      },
      {
        method: "POST",
        url: `/v1/projects/${projectId}/messages/${messageId}/classify`,
        service: () => context.services.communicationsService.messageInsights.classifyMessage,
        expectedCode: "truth_approver_required"
      },
      {
        method: "POST",
        url: `/v1/projects/${projectId}/threads/${threadId}/classify`,
        service: () => context.services.communicationsService.threadInsights.classifyThread,
        expectedCode: "truth_approver_required"
      }
    ];

    for (const request of requests) {
      const service = vi.mocked(request.service() as ReturnType<typeof vi.fn>);
      service.mockClear();

      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: { authorization: `Bearer ${devToken}` },
        payload: request.payload
      });

      if (response.statusCode !== 403) {
        throw new Error(`${request.method} ${request.url} expected 403, got ${response.statusCode}: ${response.body}`);
      }
      expect(response.json().error.code).toBe(request.expectedCode ?? "manager_access_required");
      expect(service).not.toHaveBeenCalled();
    }
  });

  it("supports Slack and Google OAuth callbacks plus Slack webhooks", async () => {
    const slackCallback = await app.inject({
      method: "GET",
      url: "/v1/oauth/slack/callback?code=test-code&state=test-state"
    });

    expect(slackCallback.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.handleOAuthCallback).toHaveBeenCalledWith("slack", {
      code: "test-code",
      state: "test-state"
    });

    const googleCallback = await app.inject({
      method: "GET",
      url: "/v1/oauth/google/callback?code=test-code&state=test-state"
    });

    expect(googleCallback.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.handleOAuthCallback).toHaveBeenCalledWith("gmail", {
      code: "test-code",
      state: "test-state"
    });

    const webhook = await app.inject({
      method: "POST",
      url: "/v1/webhooks/slack",
      payload: {
        type: "url_verification",
        challenge: "challenge-token"
      }
    });

    expect(webhook.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.handleWebhook).toHaveBeenCalledWith(
      "slack",
      expect.objectContaining({
        body: expect.objectContaining({ type: "url_verification" })
      })
    );
  });

  it("supports Microsoft callback plus Outlook, Teams, and WhatsApp webhooks", async () => {
    const microsoftCallback = await app.inject({
      method: "GET",
      url: "/v1/oauth/microsoft/callback?code=test-code&state=test-state"
    });

    expect(microsoftCallback.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.handleOAuthCallbackFromState).toHaveBeenCalledWith(
      { code: "test-code", state: "test-state" },
      ["outlook", "microsoft_teams"]
    );

    const outlookWebhook = await app.inject({
      method: "POST",
      url: "/v1/webhooks/outlook?validationToken=verify-me",
      payload: { value: [] }
    });

    expect(outlookWebhook.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.handleWebhook).toHaveBeenCalledWith(
      "outlook",
      expect.objectContaining({
        query: expect.objectContaining({ validationToken: "verify-me" })
      })
    );

    const teamsWebhook = await app.inject({
      method: "POST",
      url: "/v1/webhooks/teams",
      payload: { value: [] }
    });

    expect(teamsWebhook.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.handleWebhook).toHaveBeenCalledWith(
      "microsoft_teams",
      expect.objectContaining({
        body: expect.objectContaining({ value: [] })
      })
    );

    const whatsappChallenge = await app.inject({
      method: "GET",
      url: "/v1/webhooks/whatsapp-business?hub.mode=subscribe&hub.verify_token=whatsapp-verify-token&hub.challenge=challenge-value"
    });

    expect(whatsappChallenge.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.handleWebhook).toHaveBeenCalledWith(
      "whatsapp_business",
      expect.objectContaining({
        query: expect.objectContaining({ "hub.challenge": "challenge-value" })
      })
    );

    const whatsappWebhook = await app.inject({
      method: "POST",
      url: "/v1/webhooks/whatsapp-business",
      payload: { entry: [] }
    });

    expect(whatsappWebhook.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.handleWebhook).toHaveBeenCalledWith(
      "whatsapp_business",
      expect.objectContaining({
        body: expect.objectContaining({ entry: [] })
      })
    );

    const firefliesWebhook = await app.inject({
      method: "POST",
      url: "/v1/webhooks/fireflies",
      payload: { event: "meeting.transcribed", meeting_id: "ff-1", timestamp: 1710876543210 }
    });

    expect(firefliesWebhook.statusCode).toBe(200);
    expect(context.services.communicationsService.connectors.handleWebhook).toHaveBeenCalledWith(
      "fireflies_ai",
      expect.objectContaining({
        body: expect.objectContaining({ meeting_id: "ff-1" })
      })
    );
  });

  it("supports communication insight and review routes with manager-only actions", async () => {
    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/message-insights?limit=10",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.messageInsights.list).toHaveBeenCalled();

    const reviewResponse = await app.inject({
      method: "GET",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/communication-review",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(reviewResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.messageInsights.getReviewQueue).toHaveBeenCalled();

    const classifyResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/messages/3322717f-2c10-4239-b525-6fbc9158f4fb/classify",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(classifyResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.messageInsights.classifyMessage).toHaveBeenCalled();

    const createProposalResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/message-insights/3322717f-2c10-4239-b525-6fbc9158f4fb/create-proposal",
      headers: {
        authorization: `Bearer ${createToken("manager")}`
      }
    });

    expect(createProposalResponse.statusCode).toBe(200);
    expect(context.services.communicationsService.messageInsights.createProposal).toHaveBeenCalled();

    vi.mocked(context.services.communicationsService.messageInsights.ignore).mockRejectedValueOnce(
      new AppError(403, "Manager access required", "manager_access_required")
    );

    const devIgnoreResponse = await app.inject({
      method: "POST",
      url: "/v1/projects/37e6d602-cc1b-4cc9-bc6c-5547241fbf90/message-insights/3322717f-2c10-4239-b525-6fbc9158f4fb/ignore",
      headers: {
        authorization: `Bearer ${createToken("dev")}`
      }
    });

    expect(devIgnoreResponse.statusCode).toBe(403);
  });
});

describe("MVP route policy", () => {
  it("allows active dev project members through selected MVP mutation routes", async () => {
    const context = createContext();
    context.env.MVP_MODE = true;
    context.env.MVP_EQUAL_PROJECT_ACCESS = true;
    context.env.MVP_ENABLE_ADVANCED_CONNECTORS = false;
    const app = await buildApp(context);
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const devHeaders = { authorization: `Bearer ${createToken("dev")}` };

    try {
      const upload = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/documents/upload`,
        headers: { ...devHeaders, "content-type": "application/json" },
        payload: {
          kind: "prd",
          title: "MVP PRD",
          visibility: "internal",
          pastedText: "MVP project context"
        }
      });
      expect(upload.statusCode).toBe(200);

      const generate = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/documents/generate`,
        headers: devHeaders,
        payload: {
          kind: "prd",
          template: "basic_mvp",
          prompt: "Build a rental management MVP for landlords and tenants"
        }
      });
      expect(generate.statusCode).toBe(200);
      expect(context.services.documentGenerationService.generateDocument).toHaveBeenCalledWith(
        projectId,
        "dev-user-1",
        expect.objectContaining({ kind: "prd", template: "basic_mvp" })
      );

      const rebuild = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/brain/rebuild`,
        headers: devHeaders
      });
      expect(rebuild.statusCode).toBe(200);

      const addMember = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/members`,
        headers: devHeaders,
        payload: {
          email: "dev2@example.com",
          projectRole: "dev"
        }
      });
      expect(addMember.statusCode).toBe(200);

      const importResponse = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/communications/import`,
        headers: devHeaders,
        payload: {
          provider: "manual_import",
          thread: { providerThreadId: "mvp-thread", participants: [{ label: "Client" }] },
          messages: [
            {
              providerMessageId: "mvp-message",
              senderLabel: "Client",
              sentAt: "2026-04-19T10:01:00.000Z",
              bodyText: "Need weekly reporting",
              messageType: "user"
            }
          ]
        }
      });
      expect(importResponse.statusCode).toBe(200);

      const dashboardRefresh = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/dashboard/refresh`,
        headers: devHeaders
      });
      expect(dashboardRefresh.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("returns feature_disabled for hidden MVP advanced surfaces", async () => {
    const context = createContext();
    context.env.MVP_MODE = true;
    context.env.MVP_EQUAL_PROJECT_ACCESS = true;
    context.env.MVP_ENABLE_PROJECT_FINANCE = false;
    context.env.MVP_ENABLE_PROJECT_SUBSCRIPTIONS = false;
    context.env.MVP_ENABLE_CALENDAR_SYNC = false;
    context.env.MVP_SHOW_VERSION_HISTORY = false;
    const app = await buildApp(context);
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const managerHeaders = { authorization: `Bearer ${createToken("manager")}` };

    try {
      for (const url of [
        `/v1/projects/${projectId}/financials`,
        `/v1/projects/${projectId}/subscriptions`,
        `/v1/projects/${projectId}/cost-entries`,
        `/v1/projects/${projectId}/financials/breakdown`,
        `/v1/projects/${projectId}/ops-summary`,
        `/v1/projects/${projectId}/meeting-series`,
        `/v1/projects/${projectId}/calendar-connections`,
        `/v1/projects/${projectId}/connectors/google-calendar/status`,
        `/v1/projects/${projectId}/brain/versions`,
        `/v1/projects/${projectId}/live-doc/sections/overview/history`
      ]) {
        const response = await app.inject({ method: "GET", url, headers: managerHeaders });
        expect(response.statusCode).toBe(403);
        expect(response.json().error.code).toBe("feature_disabled");
      }
    } finally {
      await app.close();
    }
  });

  it("supports Socrates action create/list/get/apply/reject routes", async () => {
    const context = createContext();
    const app = await buildApp(context);
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const sessionId = "77777777-7777-4777-8777-777777777777";
    const actionId = "99999999-9999-4999-8999-999999999999";
    const headers = { authorization: `Bearer ${createToken("manager")}` };

    try {
      const createResponse = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/socrates/sessions/${sessionId}/actions`,
        headers,
        payload: {
          actionType: "assign_task",
          label: "Assign auth to Ali",
          payload: {
            assigneeName: "Ali",
            taskTitle: "Build authentication",
            taskDescription: "Implement login",
            area: "backend",
            status: "open"
          }
        }
      });
      expect(createResponse.statusCode).toBe(200);
      expect(createResponse.json().data.status).toBe("proposed");
      expect(context.services.socratesActionService.createAction).toHaveBeenCalledWith(
        projectId,
        sessionId,
        "user-1",
        expect.objectContaining({ actionType: "assign_task" })
      );

      const listResponse = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/socrates/actions?pageSize=10`, headers });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json().meta.totalCount).toBe(1);

      const detailResponse = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/socrates/actions/${actionId}`, headers });
      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json().data.id).toBe(actionId);

      const applyResponse = await app.inject({ method: "POST", url: `/v1/projects/${projectId}/socrates/actions/${actionId}/apply`, headers });
      expect(applyResponse.statusCode).toBe(200);
      expect(applyResponse.json().data.status).toBe("applied");

      const rejectResponse = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/socrates/actions/${actionId}/reject`,
        headers,
        payload: { reason: "Not needed" }
      });
      expect(rejectResponse.statusCode).toBe(200);
      expect(rejectResponse.json().data.status).toBe("rejected");
    } finally {
      await app.close();
    }
  });

  it("blocks invalid Socrates action payloads and client JWT access", async () => {
    const context = createContext();
    const app = await buildApp(context);
    const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
    const sessionId = "77777777-7777-4777-8777-777777777777";

    try {
      const unsafeResponse = await app.inject({
        method: "POST",
        url: `/v1/projects/${projectId}/socrates/sessions/${sessionId}/actions`,
        headers: { authorization: `Bearer ${createToken("manager")}` },
        payload: {
          actionType: "create_diagram",
          label: "Unsafe diagram",
          payload: {
            mode: "save",
            diagramType: "flowchart",
            title: "Unsafe diagram",
            mermaidSource: "flowchart TD\n  A[Start] --> B[<script>alert(1)</script>]"
          }
        }
      });
      expect(unsafeResponse.statusCode).toBe(400);
      expect(context.services.socratesActionService.createAction).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ label: "Unsafe diagram" })
      );

      const clientResponse = await app.inject({
        method: "GET",
        url: `/v1/projects/${projectId}/socrates/actions`,
        headers: { authorization: `Bearer ${createToken("client")}` }
      });
      expect(clientResponse.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("rejects refresh-token typed JWTs on internal API routes", async () => {
    const context = createContext();
    context.env = {
      ...context.env,
      JWT_ACCESS_SECRET: "same-test-secret",
      JWT_REFRESH_SECRET: "same-test-secret"
    };
    const app = await buildApp(context);
    const refreshToken = jwt.sign(
      {
        userId: "user-1",
        orgId: "org-1",
        workspaceRoleDefault: "manager",
        globalRole: "owner",
        typ: "refresh"
      },
      "same-test-secret"
    );

    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/projects",
        headers: { authorization: `Bearer ${refreshToken}` }
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("auth_invalid_token_type");
      expect(context.services.projectService.listProjects).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe("MVP beta backend route policy", () => {
  function betaContext() {
    const context = createContext();
    context.env.ORCHESTRA_PROFILE = "mvp_beta";
    context.env.MVP_BETA_MODE = true;
    context.env.MVP_EQUAL_PROJECT_ACCESS = false;
    context.env.BETA_PROJECT_SUBSCRIPTIONS_ENABLED = true;
    return context;
  }

  it("exposes MCP readiness but gates token and transport routes behind MCP_ENABLED", async () => {
    const disabledContext = betaContext();
    disabledContext.env.MCP_ENABLED = false;
    const disabledApp = await buildApp(disabledContext);
    const headers = { authorization: `Bearer ${createToken("manager")}` };

    try {
      const readiness = await disabledApp.inject({ method: "GET", url: "/v1/mcp/readiness", headers });
      expect(readiness.statusCode).toBe(200);
      const tokens = await disabledApp.inject({ method: "GET", url: "/v1/mcp/tokens", headers });
      expect(tokens.statusCode).toBe(404);
      expect(tokens.json().error.code).toBe("feature_disabled_in_beta");
    } finally {
      await disabledApp.close();
    }

    const enabledContext = betaContext();
    enabledContext.env.MCP_ENABLED = true;
    const enabledApp = await buildApp(enabledContext);
    try {
      const tokens = await enabledApp.inject({ method: "GET", url: "/v1/mcp/tokens", headers });
      expect(tokens.statusCode).toBe(200);
      const transport = await enabledApp.inject({ method: "GET", url: "/v1/mcp" });
      expect(transport.statusCode).toBe(405);
      expect(transport.headers.allow).toBe("POST, DELETE");
    } finally {
      await enabledApp.close();
    }
  });

  it("allows authenticated Agent Run Memory routes required by visible Postflight", async () => {
    const context = betaContext();
    const app = await buildApp(context);
    const headers = { authorization: `Bearer ${createToken("manager")}` };
    const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    try {
      const created = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/agent-runs`,
        headers,
        payload: {
          taskTitle: "Verify visible Postflight",
          taskType: "review",
          promptSource: "context_pack",
          status: "completed",
          testsRun: ["authenticated beta route regression"],
          testStatus: "passed"
        }
      });
      expect(created.statusCode).toBe(201);
      expect(context.services.agentRunMemoryService.createRun).toHaveBeenCalledWith(
        PROJECT_ID,
        "user-1",
        expect.objectContaining({ taskTitle: "Verify visible Postflight", status: "completed" })
      );

      const listed = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/agent-runs`, headers });
      expect(listed.statusCode).toBe(200);

      const reviewed = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/agent-runs/${runId}/review`,
        headers,
        payload: { reviewResult: "accepted", humanReviewNotes: "Postflight reviewed." }
      });
      expect(reviewed.statusCode).toBe(200);

      const unauthenticated = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/agent-runs`,
        payload: { taskTitle: "Blocked", taskType: "review" }
      });
      expect(unauthenticated.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("allows an authorized saved Deep Research artifact destination only while the feature is enabled", async () => {
    const enabledContext = betaContext();
    enabledContext.env.BETA_DEEP_RESEARCH_ENABLED = true;
    const enabledApp = await buildApp(enabledContext);
    const contextId = "22222222-2222-4222-8222-222222222222";

    try {
      const response = await enabledApp.inject({
        method: "GET",
        url: `/v1/projects/${PROJECT_ID}/context/${contextId}`,
        headers: { authorization: `Bearer ${createToken("manager")}` }
      });
      expect(response.statusCode).toBe(200);
      expect(enabledContext.services.projectContextService.getContext).toHaveBeenCalledWith(
        PROJECT_ID,
        contextId,
        "user-1"
      );
    } finally {
      await enabledApp.close();
    }

    const disabledContext = betaContext();
    disabledContext.env.BETA_DEEP_RESEARCH_ENABLED = false;
    const disabledApp = await buildApp(disabledContext);
    try {
      const response = await disabledApp.inject({
        method: "GET",
        url: `/v1/projects/${PROJECT_ID}/context/${contextId}`,
        headers: { authorization: `Bearer ${createToken("manager")}` }
      });
      expect(response.statusCode).toBe(404);
      expect(disabledContext.services.projectContextService.getContext).not.toHaveBeenCalled();
    } finally {
      await disabledApp.close();
    }
  });

  function multipartUpload(input: { fileName: string; contentType: string; body: Buffer }) {
    const boundary = `----orchestra-beta-test-${Math.random().toString(16).slice(2)}`;
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nprd\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nBeta Upload\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="visibility"\r\n\r\nshared_with_client\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${input.fileName}"\r\nContent-Type: ${input.contentType}\r\n\r\n`
    ];
    return {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(parts.join(""), "utf8"),
        input.body,
        Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
      ])
    };
  }

  it("accepts beta PDF and DOCX uploads as internal reference docs", async () => {
    const context = betaContext();
    const app = await buildApp(context);
    const headers = { authorization: `Bearer ${createToken("manager")}` };

    try {
      for (const file of [
        { fileName: "requirements.pdf", contentType: "application/pdf", body: Buffer.from("%PDF-1.4\n") },
        {
          fileName: "requirements.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          body: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
        }
      ]) {
        const multipart = multipartUpload(file);
        const response = await app.inject({
          method: "POST",
          url: `/v1/projects/${PROJECT_ID}/documents/upload`,
          headers: { ...headers, ...multipart.headers },
          payload: multipart.payload
        });
        expect(response.statusCode).toBe(200);
      }

      expect(context.services.documentService.uploadFile).toHaveBeenCalledTimes(2);
      for (const call of vi.mocked(context.services.documentService.uploadFile).mock.calls) {
        expect(call[0]).toMatchObject({
          projectId: PROJECT_ID,
          actorUserId: "user-1",
          kind: "reference",
          visibility: "internal",
          makePrimaryLiveDoc: false
        });
      }
    } finally {
      await app.close();
    }
  });

  it("rejects beta TXT, Markdown, and image uploads before document service writes", async () => {
    const context = betaContext();
    const app = await buildApp(context);
    const headers = { authorization: `Bearer ${createToken("manager")}` };

    try {
      for (const file of [
        { fileName: "notes.txt", contentType: "text/plain", body: Buffer.from("notes") },
        { fileName: "notes.md", contentType: "text/markdown", body: Buffer.from("# notes") },
        { fileName: "wireframe.png", contentType: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }
      ]) {
        const multipart = multipartUpload(file);
        const response = await app.inject({
          method: "POST",
          url: `/v1/projects/${PROJECT_ID}/documents/upload`,
          headers: { ...headers, ...multipart.headers },
          payload: multipart.payload
        });
        expect(response.statusCode).toBe(415);
        expect(response.json().error.code).toBe("unsupported_document_file_type");
      }

      expect(context.services.documentService.uploadFile).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("keeps beta Socrates on the document-only route and disables hidden routes", async () => {
    const context = betaContext();
    const app = await buildApp(context);
    const headers = { authorization: `Bearer ${createToken("manager")}` };

    try {
      const answer = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/socrates/beta/ask`,
        headers,
        payload: { content: "What does the uploaded PRD say about onboarding?" }
      });
      expect(answer.statusCode).toBe(200);
      expect(context.services.socratesService.askBetaProjectMemory).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        actorUserId: "user-1",
        content: "What does the uploaded PRD say about onboarding?",
        source: "web"
      });

      const createdCode = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/join-codes`,
        headers,
        payload: { invitedEmail: "dev@example.com" }
      });
      expect(createdCode.statusCode).toBe(200);
      expect(createdCode.json().data.code).toBe("ORCH-ABC123-DEF456");

      const listedCodes = await app.inject({
        method: "GET",
        url: `/v1/projects/${PROJECT_ID}/join-codes`,
        headers
      });
      expect(listedCodes.statusCode).toBe(200);
      expect(listedCodes.json().data).toHaveLength(1);

      const revokedCode = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/join-codes/11111111-2222-4333-8444-555555555555/revoke`,
        headers,
        payload: {}
      });
      expect(revokedCode.statusCode).toBe(200);
      expect(context.services.projectService.revokeJoinCode).toHaveBeenCalledWith(
        PROJECT_ID,
        "11111111-2222-4333-8444-555555555555",
        "user-1"
      );

      const communicationTimeline = await app.inject({
        method: "GET",
        url: `/v1/projects/${PROJECT_ID}/communications/timeline`,
        headers
      });
      expect(communicationTimeline.statusCode).toBe(200);

      for (const provider of ["clickup", "granola", "fireflies_ai", "microsoft_teams"]) {
        const connectProvider = await app.inject({
          method: "POST",
          url: `/v1/projects/${PROJECT_ID}/connectors/${provider}/connect`,
          headers,
          payload: {}
        });
        expect(connectProvider.statusCode).toBe(200);
      }

      const importCommunication = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/communications/import`,
        headers,
        payload: {
          provider: "fireflies_ai",
          accountLabel: "Fireflies.ai beta route test",
          meeting: {
            providerTranscriptId: "route-test-transcript",
            title: "Route test meeting",
            startedAt: "2026-05-01T00:00:00.000Z",
            participants: []
          },
          segments: [{ speakerName: "QA", startMs: 0, endMs: 1000, text: "Manual transcript import is beta-visible." }]
        }
      });
      expect(importCommunication.statusCode).toBe(200);

      for (const request of [
        { method: "POST" as const, url: `/v1/projects/${PROJECT_ID}/documents/generate`, payload: { kind: "prd", template: "basic_mvp", prompt: "x" } },
        { method: "POST" as const, url: `/v1/projects/${PROJECT_ID}/socrates/sessions/session-1/actions`, payload: { actionType: "assign_task", label: "x", payload: {} } }
      ]) {
        const response = await app.inject({ ...request, headers });
        expect(response.statusCode).toBe(404);
        expect(response.json().error.code).toBe("feature_disabled_in_beta");
      }
    } finally {
      await app.close();
    }
  });

  it("allows beta Mission Control, manual calendar, and manual subscription routes", async () => {
    const context = betaContext();
    context.env.MVP_ENABLE_CALENDAR_SYNC = true;
    context.env.GITHUB_INTEGRATION_ENABLED = true;
    const app = await buildApp(context);
    const headers = { authorization: `Bearer ${createToken("manager")}` };

    try {
      const mission = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/mission-control`, headers });
      expect(mission.statusCode).toBe(200);
      expect(context.services.dashboardService.getMissionControl).toHaveBeenCalledWith(PROJECT_ID, "user-1", {
        limit: 8,
        activityLimit: 8,
        forceRefresh: false
      });

      const activity = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/activity`, headers });
      expect(activity.statusCode).toBe(200);

      const recentChanges = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/recent-changes`, headers });
      expect(recentChanges.statusCode).toBe(200);

      const recentQueries = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/socrates/recent-queries`, headers });
      expect(recentQueries.statusCode).toBe(200);

      const profile = await app.inject({ method: "GET", url: "/v1/me/profile", headers });
      expect(profile.statusCode).toBe(200);
      expect(profile.json().data.email).toBe("manager@example.com");

      const profileUpdate = await app.inject({
        method: "PATCH",
        url: "/v1/me/profile",
        headers,
        payload: { displayName: "Updated Manager", email: "attacker@example.com" }
      });
      expect(profileUpdate.statusCode).toBe(400);

      const notificationPreferences = await app.inject({
        method: "GET",
        url: "/v1/me/notification-preferences",
        headers
      });
      expect(notificationPreferences.statusCode).toBe(200);
      expect(notificationPreferences.json().data.securityAlerts).toBe(true);

      const notificationUpdate = await app.inject({
        method: "PATCH",
        url: "/v1/me/notification-preferences",
        headers,
        payload: { productUpdates: true, securityAlerts: true }
      });
      expect(notificationUpdate.statusCode).toBe(200);

      const appearancePreference = await app.inject({
        method: "GET",
        url: "/v1/me/appearance-preference",
        headers
      });
      expect(appearancePreference.statusCode).toBe(200);
      expect(appearancePreference.json().data.theme).toBe("auto");

      const appearanceUpdate = await app.inject({
        method: "PATCH",
        url: "/v1/me/appearance-preference",
        headers,
        payload: { theme: "dark" }
      });
      expect(appearanceUpdate.statusCode).toBe(200);
      expect(appearanceUpdate.json().data.theme).toBe("dark");

      const invalidAppearanceUpdate = await app.inject({
        method: "PATCH",
        url: "/v1/me/appearance-preference",
        headers,
        payload: { theme: "sepia" }
      });
      expect(invalidAppearanceUpdate.statusCode).toBe(400);

      const linkedAccounts = await app.inject({ method: "GET", url: "/v1/me/linked-accounts", headers });
      expect(linkedAccounts.statusCode).toBe(200);
      expect(linkedAccounts.json().data).toEqual([
        expect.objectContaining({ service: "github", accountIdentifier: "manager" })
      ]);

      const sessions = await app.inject({ method: "GET", url: "/v1/me/sessions", headers });
      expect(sessions.statusCode).toBe(200);
      expect(sessions.json().data[0]).not.toHaveProperty("tokenHash");

      const revokeSession = await app.inject({
        method: "DELETE",
        url: "/v1/me/sessions/11111111-2222-4333-8444-555555555555",
        headers
      });
      expect(revokeSession.statusCode).toBe(200);

      const revokeSessions = await app.inject({
        method: "POST",
        url: "/v1/me/sessions/revoke-all",
        headers,
        payload: { includeCurrent: false }
      });
      expect(revokeSessions.statusCode).toBe(200);

      const workspaces = await app.inject({ method: "GET", url: "/v1/me/workspaces", headers });
      expect(workspaces.statusCode).toBe(200);
      expect(workspaces.json().data[0].planLabel).toBe("Private pilot");

      const workspaceSwitch = await app.inject({
        method: "POST",
        url: "/v1/me/workspaces/switch",
        headers,
        payload: { projectId: PROJECT_ID }
      });
      expect(workspaceSwitch.statusCode).toBe(200);
      expect(workspaceSwitch.json().data.workspace.current).toBe(true);
      expect(workspaceSwitch.json().data.accessToken).toBe("switched-access");

      const workspaceSettings = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/settings`, headers });
      expect(workspaceSettings.statusCode).toBe(200);
      expect(workspaceSettings.json().data.planLabel).toBe("Private pilot");

      const workspaceSettingsBundle = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/settings/bundle`, headers });
      expect(workspaceSettingsBundle.statusCode).toBe(200);
      expect(workspaceSettingsBundle.json().data.settings.planLabel).toBe("Private pilot");

      const updatedSettings = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${PROJECT_ID}/settings`,
        headers,
        payload: { name: "Updated Beta Project", slug: "updated-beta-project" }
      });
      expect(updatedSettings.statusCode).toBe(200);

      const members = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/members`, headers });
      expect(members.statusCode).toBe(200);

      const memberUpdate = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${PROJECT_ID}/members/11111111-2222-4333-8444-555555555555`,
        headers,
        payload: { projectRole: "dev" }
      });
      expect(memberUpdate.statusCode).toBe(200);

      const responsibilities = await app.inject({
        method: "GET",
        url: `/v1/projects/${PROJECT_ID}/responsibilities`,
        headers
      });
      expect(responsibilities.statusCode).toBe(200);

      const createdResponsibility = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/responsibilities`,
        headers,
        payload: { assigneeName: "Sara", title: "Own frontend", area: "frontend" }
      });
      expect(createdResponsibility.statusCode).toBe(200);

      const patchedResponsibility = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${PROJECT_ID}/responsibilities/11111111-1111-1111-1111-111111111111`,
        headers,
        payload: { status: "blocked" }
      });
      expect(patchedResponsibility.statusCode).toBe(200);

      const deletedResponsibility = await app.inject({
        method: "DELETE",
        url: `/v1/projects/${PROJECT_ID}/responsibilities/11111111-1111-1111-1111-111111111111`,
        headers
      });
      expect(deletedResponsibility.statusCode).toBe(200);

      const approvers = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/truth-approvers`, headers });
      expect(approvers.statusCode).toBe(200);

      const grantedApprover = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/truth-approvers`,
        headers,
        payload: { memberId: "11111111-2222-4333-8444-555555555555" }
      });
      expect(grantedApprover.statusCode).toBe(200);

      const revokedApprover = await app.inject({
        method: "DELETE",
        url: `/v1/projects/${PROJECT_ID}/truth-approvers/11111111-2222-4333-8444-555555555555`,
        headers
      });
      expect(revokedApprover.statusCode).toBe(200);

      const integrationStatus = await app.inject({
        method: "GET",
        url: `/v1/projects/${PROJECT_ID}/integrations/status`,
        headers
      });
      expect(integrationStatus.statusCode).toBe(200);
      expect(integrationStatus.json().data.providers).toHaveLength(4);
      expect(JSON.stringify(integrationStatus.json().data.providers)).not.toContain("token");

      const githubPreview = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/github/preview`, headers });
      expect(githubPreview.statusCode).toBe(200);
      expect(githubPreview.json().data.state).toBe("not_connected");

      const githubInstall = await app.inject({ method: "GET", url: "/v1/github/install-url", headers });
      expect(githubInstall.statusCode).toBe(200);
      expect(githubInstall.json().data.installUrl).toContain("github.com/apps/orchestra");

      const githubProject = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/github`, headers });
      expect(githubProject.statusCode).toBe(200);

      for (const path of ["status", "code-status", "pull-requests", "conflicts", "activity", "branches"]) {
        const githubStatusRoute = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/github/${path}`, headers });
        expect(githubStatusRoute.statusCode).toBe(200);
      }

      const githubInstallations = await app.inject({ method: "GET", url: "/v1/github/installations", headers });
      expect(githubInstallations.statusCode).toBe(200);

      const githubRepositories = await app.inject({
        method: "GET",
        url: "/v1/github/installations/11111111-2222-4333-8444-555555555555/repositories",
        headers
      });
      expect(githubRepositories.statusCode).toBe(200);

      const linkGithubRepository = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/github/repositories/link`,
        headers,
        payload: {
          installationId: "11111111-2222-4333-8444-555555555555",
          githubRepositoryId: "987",
          owner: "orchestra",
          name: "app",
          fullName: "orchestra/app",
          private: true,
          fork: false,
          htmlUrl: "https://github.com/orchestra/app"
        }
      });
      expect(linkGithubRepository.statusCode).toBe(201);

      const githubBackfill = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/github/backfill`,
        headers,
        payload: { dryRun: false, mode: "incremental" }
      });
      expect(githubBackfill.statusCode).toBe(202);

      context.env.GITHUB_WEBHOOKS_ENABLED = true;
      const githubWebhook = await app.inject({
        method: "POST",
        url: "/v1/webhooks/github",
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "push",
          "x-hub-signature-256": "sha256=test"
        },
        payload: { repository: { full_name: "orchestra/app" } }
      });
      expect(githubWebhook.statusCode).toBe(202);
      expect(context.services.githubIntegrationService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ "x-github-event": "push" }),
          body: expect.objectContaining({ repository: expect.objectContaining({ full_name: "orchestra/app" }) })
        })
      );

      const timeline = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/timeline?source=manual`, headers });
      expect(timeline.statusCode).toBe(200);
      expect(context.services.betaTimelineService.listTimeline).toHaveBeenCalledWith(PROJECT_ID, "user-1", {
        source: "manual",
        view: "detailed",
        limit: 50
      });

      const createTimelineEvent = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/timeline/events`,
        headers,
        payload: { title: "Manual checkpoint", description: "No provider spoofing", source: "manual" }
      });
      expect(createTimelineEvent.statusCode).toBe(200);
      expect(context.services.betaTimelineService.createManualEvent).toHaveBeenCalled();

      const reviewItems = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/live-doc/review-items`, headers });
      expect(reviewItems.statusCode).toBe(200);

      const acceptReview = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/live-doc/review-items/${PROJECT_ID}/accept`,
        headers,
        payload: {}
      });
      expect(acceptReview.statusCode).toBe(200);

      const calendar = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/calendar-events`, headers });
      expect(calendar.statusCode).toBe(200);

      const calendarConnections = await app.inject({
        method: "GET",
        url: `/v1/projects/${PROJECT_ID}/calendar-connections`,
        headers
      });
      expect(calendarConnections.statusCode).toBe(200);

      const connectGoogleCalendar = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/calendar-connections/google_calendar/connect`,
        headers,
        payload: {}
      });
      expect(connectGoogleCalendar.statusCode).toBe(200);

      const googleStatus = await app.inject({
        method: "GET",
        url: `/v1/projects/${PROJECT_ID}/connectors/google-calendar/status`,
        headers
      });
      expect(googleStatus.statusCode).toBe(200);

      const googleCalendars = await app.inject({
        method: "GET",
        url: `/v1/projects/${PROJECT_ID}/connectors/google-calendar/calendars`,
        headers
      });
      expect(googleCalendars.statusCode).toBe(200);

      const saveGoogleCalendars = await app.inject({
        method: "PATCH",
        url: `/v1/projects/${PROJECT_ID}/connectors/google-calendar/calendars`,
        headers,
        payload: { calendarIds: ["primary"] }
      });
      expect(saveGoogleCalendars.statusCode).toBe(200);

      const syncGoogleCalendar = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/connectors/google-calendar/sync`,
        headers,
        payload: {}
      });
      expect(syncGoogleCalendar.statusCode).toBe(200);

      const suggestions = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/suggestions`, headers });
      expect(suggestions.statusCode).toBe(200);
      expect(context.services.suggestionsService.list).toHaveBeenCalled();

      const suggestionDetail = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/suggestions/sug_abc123456789`, headers });
      expect(suggestionDetail.statusCode).toBe(200);

      for (const path of ["dismiss", "promote-to-timeline", "create-review-item", "ask-socrates"]) {
        const response = await app.inject({
          method: "POST",
          url: `/v1/projects/${PROJECT_ID}/suggestions/sug_abc123456789/${path}`,
          headers,
          payload: {}
        });
        expect(response.statusCode).toBe(200);
      }

      const truthInbox = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/truth-inbox?limit=30`, headers });
      expect(truthInbox.statusCode).toBe(200);
      expect(context.services.truthInboxService.list).toHaveBeenCalled();

      const inboxItemId = encodeURIComponent("suggestion:sug_abc123456789");
      const truthInboxDetail = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/truth-inbox/${inboxItemId}`, headers });
      expect(truthInboxDetail.statusCode).toBe(200);

      const truthChangePacket = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/truth-inbox/${inboxItemId}/packet`, headers });
      expect(truthChangePacket.statusCode).toBe(200);
      expect(context.services.truthChangePacketService.get).toHaveBeenCalledWith(
        PROJECT_ID,
        "suggestion:sug_abc123456789",
        { userId: "user-1", orgId: "org-1" }
      );

      const truthInboxAction = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/truth-inbox/${inboxItemId}/actions/defer`,
        headers,
        payload: { until: "2026-09-01T00:00:00.000Z" }
      });
      expect(truthInboxAction.statusCode).toBe(200);
      expect(context.services.truthInboxService.act).toHaveBeenCalledWith(
        PROJECT_ID,
        "suggestion:sug_abc123456789",
        "defer",
        { userId: "user-1", orgId: "org-1" },
        { until: "2026-09-01T00:00:00.000Z" }
      );

      const googleWebhook = await app.inject({
        method: "POST",
        url: "/v1/webhooks/google/calendar",
        headers: {
          "x-goog-channel-id": "channel-1",
          "x-goog-channel-token": "token-1"
        },
        payload: {}
      });
      expect(googleWebhook.statusCode).toBe(200);

      const connectOutlookCalendar = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/calendar-connections/outlook_calendar/connect`,
        headers,
        payload: {}
      });
      expect(connectOutlookCalendar.statusCode).toBe(404);
      expect(connectOutlookCalendar.json().error.code).toBe("feature_disabled_in_beta");

      const createCalendar = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/calendar-events`,
        headers,
        payload: { title: "Beta review", startsAt: "2026-05-31T10:00:00.000Z" }
      });
      expect(createCalendar.statusCode).toBe(200);

      const subscriptions = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/subscriptions`, headers });
      expect(subscriptions.statusCode).toBe(200);

      const createdSubscription = await app.inject({
        method: "POST",
        url: `/v1/projects/${PROJECT_ID}/subscriptions`,
        headers,
        payload: { name: "Supabase", category: "database", cost: 25, billingType: "monthly", status: "active" }
      });
      expect(createdSubscription.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("exposes read-only FDE routes in beta only when readiness intelligence is enabled", async () => {
    const context = betaContext();
    context.env.FDE_READINESS_INTELLIGENCE_ENABLED = true;
    const app = await buildApp(context);
    const headers = { authorization: `Bearer ${createToken("manager")}` };
    try {
      const response = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/fde-readiness/conflicts?limit=10`, headers });
      expect(response.statusCode).toBe(200);
      expect(context.services.fdeReadinessService.listConflicts).toHaveBeenCalled();
    } finally {
      await app.close();
    }

    const disabledContext = betaContext();
    disabledContext.env.FDE_READINESS_INTELLIGENCE_ENABLED = false;
    const disabledApp = await buildApp(disabledContext);
    try {
      const response = await disabledApp.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/fde-readiness/conflicts?limit=10`, headers });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("feature_disabled_in_beta");
    } finally {
      await disabledApp.close();
    }
  });
});

describe("public route security middleware", () => {
  it("rate-limits auth attempts before repeated service dispatch", async () => {
    const context = createContext();
    context.env.AUTH_RATE_LIMIT_MAX = 1;
    context.env.AUTH_RATE_LIMIT_WINDOW_MS = 60000;
    const app = await buildApp(context);

    try {
      const payload = {
        email: "manager@example.com",
        password: "Password123!"
      };
      const first = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload
      });
      const second = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(429);
      expect(second.json().error.code).toBe("rate_limited");
      expect(context.services.authService.login).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("rate-limits public client token routes before token lookup", async () => {
    const context = createContext();
    context.env.CLIENT_RATE_LIMIT_MAX = 1;
    context.env.CLIENT_RATE_LIMIT_WINDOW_MS = 60000;
    const app = await buildApp(context);

    try {
      const first = await app.inject({
        method: "GET",
        url: `/v1/client/${VALID_CLIENT_SHARE_TOKEN}/bootstrap`
      });
      const second = await app.inject({
        method: "GET",
        url: `/v1/client/${VALID_CLIENT_SHARE_TOKEN}/bootstrap`
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(429);
      expect(second.json().error.code).toBe("rate_limited");
      expect(context.services.clientViewService.getBootstrap).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("rejects malformed public client tokens before token lookup", async () => {
    const context = createContext();
    const app = await buildApp(context);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/client/raw-client-token/bootstrap"
      });

      expect(response.statusCode).toBe(400);
      expect(context.services.clientViewService.getBootstrap).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
