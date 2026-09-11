import {z} from 'zod';
export const pairedRpcSchema=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.string(),z.number(),z.null()]).optional(),method:z.string(),params:z.record(z.unknown()).optional()}).strict();
export function authorizePairedRpc(rpc:z.infer<typeof pairedRpcSchema>,pairing:{projectId:string;packId:string}){
 if(['initialize','ping','notifications/initialized','notifications/cancelled','tools/list'].includes(rpc.method))return;
 // Resource and prompt endpoints are not part of this exact-pack capability.
 if(rpc.method!=='tools/call')throw new Error('Method not paired');
 const args=rpc.params?.arguments as Record<string,unknown>|undefined;
 if(!args||args.projectId!==pairing.projectId)throw new Error('Wrong project');
 if(rpc.params?.name==='orchestra.get_context_pack'&&args.packId===pairing.packId)return;
 if(rpc.params?.name==='orchestra.record_agent_run'&&args.contextPackId===pairing.packId)return;
 throw new Error('Tool or pack not paired');
}
