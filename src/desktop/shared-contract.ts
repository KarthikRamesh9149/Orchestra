import {z} from 'zod';

export const SHARED_DESKTOP_PROTOCOL=1;
export const sharedOriginSchema=z.string().trim().max(2048).transform((input,ctx)=>{
 try{
  const url=new URL(input);
  // Keep origin selection distinct from API paths and secret-bearing links.
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid origin');
  return url.origin;
 }catch{ctx.addIssue({code:'custom',message:'Enter the server HTTPS origin, without credentials, a path, query or fragment.'});return z.NEVER;}
});

/** Safe to show in UI; credentials belong to a separate protected envelope. */
export const sharedConnectionSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),origin:sharedOriginSchema}).strict();
export type SharedConnection=z.infer<typeof sharedConnectionSchema>;

/** Explicit server-operator opt-in; desktop enforcement lives in the main process. */
export const sharedCachePolicySchema=z.discriminatedUnion('enabled',[
 z.object({enabled:z.literal(false)}).strict(),
 z.object({enabled:z.literal(true),readOnly:z.literal(true),ttlSeconds:z.number().int().min(60).max(86400),maxBytes:z.number().int().min(1024).max(50*1024*1024)}).strict()
]).default({enabled:false});

export const sharedManifestSchema=z.object({
 product:z.literal('orchestra'),protocol:z.literal(SHARED_DESKTOP_PROTOCOL),
 minClientProtocol:z.number().int().positive(),maxClientProtocol:z.number().int().positive(),
 serverId:z.string().uuid(),mode:z.enum(['self-hosted','managed']),
 capabilities:z.array(z.string().min(1).max(100)).max(50),
 offlineCache:sharedCachePolicySchema
}).strict();

/** Validate before sending a saved login grant to the selected server. */
export function assertSharedCompatibility(input:unknown,expectedServerId?:string){
 const manifest=sharedManifestSchema.parse(input);
 if(manifest.minClientProtocol>SHARED_DESKTOP_PROTOCOL||manifest.maxClientProtocol<SHARED_DESKTOP_PROTOCOL||
    !manifest.capabilities.includes('bearer-sessions-v1'))throw new Error('The server does not support this desktop protocol.');
 if(expectedServerId&&manifest.serverId!==expectedServerId)throw new Error('Server identity changed. Reconnect explicitly before sending credentials.');
 return manifest;
}
