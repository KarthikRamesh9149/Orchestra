import type {PrismaClient} from '@prisma/client';
import {AppError} from '../app/errors.js';
const identity={provider:'openai',model:'text-embedding-3-small',dimensions:1536};
/** One durable identity per local index. Existing unidentified vectors must not
 * be queried with a newly chosen model. Model migration remains a separate job. */
export async function ensureDesktopEmbeddingIdentity(db:PrismaClient){
 await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('desktop:embedding-identity',0))`;
  const rows=await tx.$queryRaw<Array<{data:unknown}>>`SELECT data FROM desktop_limit_state WHERE key='desktop:embedding-identity' FOR UPDATE`;
  if(rows.length){
   const data=rows[0].data as Partial<typeof identity>|null;
   if(!data||data.provider!==identity.provider||data.model!==identity.model||data.dimensions!==identity.dimensions)throw new AppError(409,'The saved embedding identity requires a verified reindex before AI can start.','embedding_reindex_required');
   return;
  }
  const populated=await tx.$queryRaw<Array<{present:boolean}>>`SELECT (
   EXISTS(SELECT 1 FROM document_chunks WHERE embedding IS NOT NULL) OR
   EXISTS(SELECT 1 FROM communication_message_chunks WHERE embedding IS NOT NULL) OR
   EXISTS(SELECT 1 FROM project_context_chunks WHERE embedding IS NOT NULL)
  ) AS present`;
  if(populated[0]?.present)throw new AppError(409,'Existing vectors have no verified model identity. Reindex is required before semantic search.','embedding_reindex_required');
  await tx.$executeRaw`INSERT INTO desktop_limit_state(key,data) VALUES ('desktop:embedding-identity',${JSON.stringify(identity)}::jsonb)`;
 });
}
