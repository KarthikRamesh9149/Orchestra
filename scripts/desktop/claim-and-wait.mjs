import { PrismaClient } from '@prisma/client';
import { PostgresJobDispatcher } from '../../src/lib/jobs/postgres.ts';
if(process.env.DESKTOP_DB_TEST!=='1')throw new Error('Test-only worker');
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/orchestra_desktop')throw new Error('Wrong test database');
const db=new PrismaClient();
const job=await new PostgresJobDispatcher(db,500).claim();
process.send?.({claimed:Boolean(job)});
setInterval(()=>{},1000);
