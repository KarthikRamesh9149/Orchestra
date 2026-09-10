import type { PrismaClient } from "@prisma/client";

const REDACTED = "[redacted]";
const SECRET_KEY_PATTERN = /token|secret|password|credential|credentialsRef|apiKey|api[_-]?key|authorization|privateKey|signingKey|rawBody|bodyText|transcript/i;
const SECRET_VALUE_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|FIREFLIES_API_KEY|GITHUB_APP_PRIVATE_KEY|GITHUB_APP_WEBHOOK_SECRET|GITHUB_APP_CLIENT_SECRET|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|CLIENT_SHARE_TOKEN_SECRET|DATABASE_URL)\s*=)/i;

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: {
    orgId: string;
    eventType: string;
    entityType: string;
    entityId?: string | null;
    projectId?: string | null;
    actorUserId?: string | null;
    payload: unknown;
  }) {
    await this.recordWithClient(this.prisma, input);
  }

  async recordWithClient(
    prisma: Pick<PrismaClient, "auditEvent">,
    input: {
      orgId: string;
      eventType: string;
      entityType: string;
      entityId?: string | null;
      projectId?: string | null;
      actorUserId?: string | null;
      payload: unknown;
    }
  ) {
    await prisma.auditEvent.create({
      data: {
        orgId: input.orgId,
        eventType: input.eventType,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        projectId: input.projectId ?? null,
        actorUserId: input.actorUserId ?? null,
        payloadJson: redactAuditPayload(input.payload) as object
      }
    });
  }

  async listProjectEvents(input: {
    orgId: string;
    projectId: string;
    actorUserId?: string;
    eventType?: string;
    entityType?: string;
    from?: Date;
    to?: Date;
    cursor?: Date;
    limit: number;
  }) {
    const where = {
      orgId: input.orgId,
      projectId: input.projectId,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.eventType ? { eventType: input.eventType } : {}),
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.from || input.to || input.cursor
        ? {
            createdAt: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lte: input.to } : {}),
              ...(input.cursor ? { lt: input.cursor } : {})
            }
          }
        : {})
    };

    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.limit + 1,
      select: {
        id: true,
        projectId: true,
        orgId: true,
        actorUserId: true,
        eventType: true,
        entityType: true,
        entityId: true,
        payloadJson: true,
        createdAt: true,
        actor: {
          select: {
            id: true,
            email: true,
            displayName: true,
            workspaceRoleDefault: true
          }
        }
      }
    });

    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map((row) => ({
      id: row.id,
      projectId: row.projectId,
      orgId: row.orgId,
      actorUserId: row.actorUserId,
      actor: row.actor
        ? {
            id: row.actor.id,
            email: row.actor.email,
            displayName: row.actor.displayName,
            workspaceRoleDefault: row.actor.workspaceRoleDefault
          }
        : null,
      eventType: row.eventType,
      entityType: row.entityType,
      entityId: row.entityId,
      payload: redactAuditPayload(row.payloadJson),
      createdAt: row.createdAt.toISOString()
    }));

    return {
      items,
      meta: {
        limit: input.limit,
        hasMore,
        nextCursor: hasMore ? items.at(-1)?.createdAt ?? null : null
      }
    };
  }
}

export function redactAuditPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditPayload(item));
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value)) {
      return REDACTED;
    }
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? REDACTED : redactAuditPayload(item)
    ])
  );
}
