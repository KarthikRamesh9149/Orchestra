import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {localHttp} from './local-http.js';
import type {HostClient} from './host-client.js';
import {ProtectedSettingsStore,mcpPairingSchema} from './protected-settings.js';
export const pairInputSchema=z.object({projectId:z.string().uuid(),packId:z.string().uuid(),client:z.enum(['codex','claude','cursor','vscode'])}).strict();
export function pairingSetup(id:string,client:string,executable:string,userData:string){
 const name=`orchestra-desktop-${id.slice(0,8)}`,args=[`--orchestra-mcp=${id}`,`--user-data-dir=${userData}`];
 if(client==='codex')return `[mcp_servers.${name}]\ncommand = ${JSON.stringify(executable)}\nargs = ${JSON.stringify(args)}\n`;
 // VS Code's extension host inherits Node-mode flags. Its MCP env null values
 // remove those flags so the packaged Electron entry point starts as Electron.
 return JSON.stringify(client==='vscode'?{servers:{[name]:{type:'stdio',command:executable,args,env:{ELECTRON_RUN_AS_NODE:null,NODE_OPTIONS:null,VSCODE_INSPECTOR_OPTIONS:null}}}}:{mcpServers:{[name]:{command:executable,args}}},null,2);
}
export async function createDesktopPairing(input:unknown,host:HostClient,settings:ProtectedSettingsStore){
 const parsed=pairInputSchema.parse(input);const current=await settings.read();
 if((current.mcp?.length??0)>=8)throw new Error('Remove an old pairing first');
 const pack=await localHttp(new Request(`orchestra://app/v1/projects/${parsed.projectId}/agent-context-packs/${parsed.packId}`),host);
 if(!pack.ok)throw new Error('Preflight unavailable');
 z.object({data:z.object({id:z.literal(parsed.packId)})}).parse(await pack.json());
 const expiresAt=new Date(Date.now()+7*86400000).toISOString();
 const created=await localHttp(new Request('orchestra://app/v1/mcp/tokens',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:`Desktop ${parsed.client} Preflight`,mode:'local_dev',projectIds:[parsed.projectId],allowedTools:['orchestra.get_context_pack','orchestra.record_agent_run'],allowControlledWrites:true,expiresAt})}),host,true);
 if(!created.ok)throw new Error('Scoped token could not be created');
 const result=z.object({data:z.object({token:z.string(),tokenRecord:z.object({id:z.string().uuid()})})}).parse(await created.json());
 const pairing=mcpPairingSchema.parse({id:randomUUID(),...parsed,token:result.data.token,tokenId:result.data.tokenRecord.id,expiresAt});
 try{await settings.write({...current,mcp:[...(current.mcp??[]),pairing]});}
 catch(error){await localHttp(new Request(`orchestra://app/v1/mcp/tokens/${pairing.tokenId}/revoke`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),host,true).catch(()=>{});throw error;}
 return {id:pairing.id,projectId:pairing.projectId,packId:pairing.packId,client:pairing.client,expiresAt};
}
export async function revokeDesktopPairing(id:unknown,host:HostClient,settings:ProtectedSettingsStore){
 const parsed=z.string().uuid().parse(id),current=await settings.read();const pairing=current.mcp?.find(value=>value.id===parsed);
 if(!pairing)throw new Error('Pairing unavailable');
 const result=await localHttp(new Request(`orchestra://app/v1/mcp/tokens/${pairing.tokenId}/revoke`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),host,true);
 if(!result.ok)throw new Error('Server revocation not confirmed');
 await settings.write({...current,mcp:current.mcp!.filter(value=>value.id!==parsed)});return {revoked:true};
}
