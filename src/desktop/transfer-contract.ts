import {z} from 'zod';
export const nativeArchiveLimit=16*1024*1024;
export const transferAction=z.enum(['export','preview','import']);
export type TransferAction=z.infer<typeof transferAction>;
export const transferPath=(projectId:string,action:TransferAction)=>`/v1/desktop/projects/${z.string().guid().parse(projectId)}/transfer/${transferAction.parse(action)}`;
export const isNativeTransferRoute=(method:string,path:string)=>method==='POST'&&/^\/v1\/desktop\/projects\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/transfer\/(export|preview|import)$/.test(path);
export const transferCommit=z.object({projectId:z.string().guid(),previewId:z.string().guid(),identityMap:z.record(z.string().guid(),z.string().guid()),acknowledgeHistoricalTruth:z.literal(true)}).strict();
