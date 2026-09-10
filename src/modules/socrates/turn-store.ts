import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type SocratesMessageRole } from "@prisma/client";

/** Called only after project authorization and stream limits have passed. */
export async function createSocratesTurn(
  prisma: PrismaClient,
  input: { projectId: string; userId: string; question: string; viewerState: object }
) {
  const [created] = await prisma.$queryRaw<Array<{
    id: string; createdAt: Date; updatedAt: Date;
    messages: Array<{id: string; role: SocratesMessageRole}>;
  }>>(Prisma.sql`
    WITH session AS (
      INSERT INTO socrates_sessions(id, project_id, user_id, page_context, viewer_state_json, updated_at)
      VALUES (${randomUUID()}::uuid, ${input.projectId}::uuid, ${input.userId}::uuid,
        'dashboard_project', ${JSON.stringify(input.viewerState)}::jsonb, now())
      RETURNING id, created_at, updated_at
    ), messages AS (
      INSERT INTO socrates_messages(id, session_id, role, content, response_status)
      SELECT ${randomUUID()}::uuid, id, 'user'::"SocratesMessageRole", ${input.question}, NULL::"SocratesResponseStatus" FROM session
      UNION ALL
      SELECT ${randomUUID()}::uuid, id, 'assistant'::"SocratesMessageRole", '', 'streaming'::"SocratesResponseStatus" FROM session
      RETURNING id, role
    )
    SELECT session.id, session.created_at AS "createdAt", session.updated_at AS "updatedAt",
      (SELECT json_agg(json_build_object('id', id, 'role', role)) FROM messages) AS messages
    FROM session
  `);
  if (!created) throw new Error("Socrates turn was not created");
  return created;
}
