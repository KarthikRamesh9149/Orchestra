import {describe,it,expect} from 'vitest';
import {authorizePairedRpc} from '../apps/desktop/src/mcp-relay-policy.js';
const pairing={projectId:'project',packId:'pack'};
describe('exact-pack relay policy',()=>{
 it.each(['resources/list','resources/read','prompts/list','prompts/get','arbitrary'])('rejects %s outside the paired surface',method=>{expect(()=>authorizePairedRpc({jsonrpc:'2.0',id:1,method},pairing)).toThrow();});
 it.each(['initialize','ping','notifications/initialized','notifications/cancelled','tools/list'])('permits transport method %s',method=>{expect(()=>authorizePairedRpc({jsonrpc:'2.0',method},pairing)).not.toThrow();});
 it.each([['orchestra.get_context_pack','packId'],['orchestra.record_agent_run','contextPackId']])('limits %s to the original project and pack',(name,key)=>{const rpc={jsonrpc:'2.0' as const,id:1,method:'tools/call',params:{name,arguments:{projectId:'project',[key]:'pack'}}};expect(()=>authorizePairedRpc(rpc,pairing)).not.toThrow();expect(()=>authorizePairedRpc(rpc,{...pairing,projectId:'other'})).toThrow();expect(()=>authorizePairedRpc(rpc,{...pairing,packId:'other'})).toThrow();});
});
