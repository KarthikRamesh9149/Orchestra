import {readFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {hashPassword} from './dist/src/lib/auth/password.js';
const input=z.object({email:z.string().email(),displayName:z.string().trim().min(2).max(120),organizationName:z.string().trim().min(2).max(100),password:z.string().min(12).max(128)}).strict().parse(JSON.parse(await readFile('/run/secrets/bootstrap_account','utf8')));
const prisma=new PrismaClient();
try{
 const passwordHash=await hashPassword(input.password,12),email=input.email.trim().toLowerCase();
 await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(68262061)`;
  if(await tx.user.count()!==0)throw new Error('Bootstrap refused: this server already has users.');
  const org=await tx.organization.create({data:{name:input.organizationName,slug:'initial-team'}});
  await tx.user.create({data:{orgId:org.id,email,normalizedEmail:email,displayName:input.displayName,passwordHash,globalRole:'owner',workspaceRoleDefault:'manager'}});
 });
 console.log('Initial owner created. Email is not marked verified. Sign in and create the first workspace. Remove the bootstrap account secret after use.');
}finally{await prisma.$disconnect();}
