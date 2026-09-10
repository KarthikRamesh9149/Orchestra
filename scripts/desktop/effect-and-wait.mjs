import { PrismaClient } from '@prisma/client';
import { PostgresWorker } from '../../src/lib/jobs/postgres-worker.ts';
const url=new URL(process.env.DESKTOP_RUNTIME_DATABASE_URL);
if(process.env.DESKTOP_DB_TEST!=='1'||url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/orchestra_desktop')throw new Error('Isolated fixture only');
const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
const worker=new PostgresWorker(db,tx=>({refresh_dashboard_snapshot:async payload=>{
 if(typeof payload.effectKey!=='string'||!payload.effectKey.startsWith('desktop-engine-'))throw new Error('Synthetic effect required');
 await tx.$executeRaw`INSERT INTO desktop_limit_state(key,data) VALUES (${payload.effectKey},'{}')`;
 process.send?.({effectWritten:true});
 await new Promise(()=>{});
}}),()=>{},500);
await worker.runOnce();
await db.$disconnect();
