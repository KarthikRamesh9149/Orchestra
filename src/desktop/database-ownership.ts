import { PrismaClient } from '@prisma/client';

/** Dedicated one-connection session: do not borrow advisory ownership from the
 * application's multi-connection query pool. Backup and engine share this lock. */
export async function acquireDatabaseOwnership(databaseUrl:string){
 const url=new URL(databaseUrl);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Local PostgreSQL required');
 url.searchParams.set('connection_limit','1');
 const client=new PrismaClient({datasources:{db:{url:url.toString()}}});
 try{
  const [row]=await client.$queryRaw<Array<{owned:boolean}>>`SELECT pg_try_advisory_lock(7311284) AS owned`;
  if(!row.owned)throw new Error('Local database is already in use; stop its engine before maintenance');
  return async()=>{await client.$disconnect();};
 }catch(error){await client.$disconnect();throw error;}
}
