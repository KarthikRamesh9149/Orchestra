// Main-process verification primitives only. No network, install, schema migration or renderer authority.
import {createHash,verify,type KeyObject} from 'node:crypto';
import {z} from 'zod';

const version=z.string().regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
const artifactSchema=z.object({url:z.string().url().max(2048),bytes:z.number().int().positive().max(2*1024**3),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const schema=z.object({
 formatVersion:z.literal(1),channel:z.enum(['beta','stable']),version,platform:z.literal('darwin-arm64'),
 issuedAt:z.number().int().nonnegative(),expiresAt:z.number().int().nonnegative(),
 schema:z.object({min:z.number().int().nonnegative(),max:z.number().int().nonnegative()}).strict(),artifact:artifactSchema,
}).strict();
type Policy={publicKey:KeyObject;origin:string;channel:string;currentVersion:string;schemaVersion:number;now:number};

export function verifyUpdateManifest(bytes:Buffer,signature:string,policy:Policy){
 if(bytes.length===0||bytes.length>65536)throw new Error('Invalid update metadata size');
 if(policy.publicKey.type!=='public'||policy.publicKey.asymmetricKeyType!=='ed25519')throw new Error('Pinned Ed25519 public key required');
 const decoded=Buffer.from(signature,'base64');
 if(decoded.length!==64||decoded.toString('base64')!==signature||!verify(null,bytes,policy.publicKey,decoded))throw new Error('Invalid update signature');
 const manifest=schema.parse(JSON.parse(bytes.toString('utf8')));
 const current=version.parse(policy.currentVersion).split('.').map(Number),next=manifest.version.split('.').map(Number);
 const changed=next.findIndex((n,i)=>n!==current[i]);
 if(changed<0||next[changed]!<=current[changed]!)throw new Error('Update replay or downgrade rejected');
 if(!Number.isSafeInteger(policy.now)||!Number.isSafeInteger(policy.schemaVersion)||policy.schemaVersion<0)throw new Error('Invalid local update policy');
 if(manifest.channel!==policy.channel)throw new Error('Wrong update channel');
 if(manifest.issuedAt>policy.now+60_000||manifest.expiresAt<=policy.now||manifest.expiresAt<=manifest.issuedAt||manifest.expiresAt-manifest.issuedAt>7*86400_000)throw new Error('Expired or invalid update validity window');
 if(manifest.schema.min>manifest.schema.max||policy.schemaVersion<manifest.schema.min||policy.schemaVersion>manifest.schema.max)throw new Error('Database version is incompatible; no downgrade permitted');
 const origin=new URL(policy.origin),url=new URL(manifest.artifact.url);
 if(origin.protocol!=='https:'||origin.origin!==policy.origin||url.origin!==origin.origin||url.username||url.password||url.search||url.hash)throw new Error('Untrusted update destination');
 return manifest;
}

export async function verifyUpdateBytes(chunks:AsyncIterable<Uint8Array>,input:z.infer<typeof artifactSchema>){
 const artifact=artifactSchema.parse(input);
 const hash=createHash('sha256');let received=0;
 for await(const chunk of chunks){
  if(!(chunk instanceof Uint8Array))throw new Error('Invalid update data');
  received+=chunk.byteLength;
  if(received>artifact.bytes)throw new Error('Update exceeds expected size');
  hash.update(chunk);
 }
 if(received!==artifact.bytes||hash.digest('hex')!==artifact.sha256)throw new Error('Incomplete or tampered update');
}
