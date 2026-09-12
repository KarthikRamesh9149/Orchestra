import {createHash} from 'node:crypto';
import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const encoded=z.string().max(180*1024*1024);
const schema=z.object({version:z.literal(1),serverId:z.string().uuid(),configurationHash:hash,image:z.string().regex(/^sha256:[a-f0-9]{64}$/),createdAt:z.string().datetime(),dump:encoded,dumpHash:hash,
 files:z.array(z.object({key:z.string().min(1).max(1024),body:encoded,hash}).strict()).max(10000),
 keys:z.array(z.object({key:z.string().min(1).max(4096),dump:encoded,expires:z.number().int().nonnegative().nullable()}).strict()).max(100000)
}).strict();
export function validateRecoveryArchive(value:unknown){
 const result=schema.parse(value);let total=0;
 const decode=(text:string,expected?:string)=>{const bytes=Buffer.from(text,'base64');if(bytes.toString('base64')!==text||(total+=bytes.length)>128*1024*1024)throw Error('Invalid or oversized recovery bytes');if(expected&&createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Recovery hash mismatch');};
 decode(result.dump,result.dumpHash);
 const paths=new Set<string>();
 for(const file of result.files){
  if(file.key.includes('\\')||file.key.includes(':')||file.key.includes('\0')||file.key.split('/').some(part=>!part||part==='.'||part==='..'||part.length>200)||paths.has(file.key))throw Error('Unsafe recovery path');
  paths.add(file.key);decode(file.body,file.hash);
 }
 const keys=new Set<string>();for(const row of result.keys){if(keys.has(row.key))throw Error('Duplicate queue key');keys.add(row.key);decode(row.dump);}
 return result;
}

/** Only immutable transfer-attempt files qualify, never arbitrary storage data. */
export function unreferencedTransferFiles(files:readonly string[],references:readonly string[]){
 const referenced=new Set(references);
 const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
 const pattern=new RegExp(`^files/transfers/${uuid}/${uuid}/[a-f0-9]{64}(?:\\.${uuid}\\.pending)?$`);
 return files.filter(key=>pattern.test(key)&&!referenced.has(key.slice('files/'.length)));
}
