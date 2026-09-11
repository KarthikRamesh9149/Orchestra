import {z} from 'zod';
export const slackChannelSchema=z.object({id:z.string().regex(/^C[A-Z0-9]+$/),name:z.string().min(1).max(255)}).strict();
export const desktopSlackBatchSchema=z.object({
 operation:z.literal('desktop.slack.ingest'),projectId:z.string().uuid(),teamId:z.string().regex(/^T[A-Z0-9]+$/),teamName:z.string().max(255),channel:slackChannelSchema,
 messages:z.array(z.object({ts:z.string().regex(/^\d{10,12}\.\d{6}$/),threadTs:z.string().regex(/^\d{10,12}\.\d{6}$/),text:z.string().trim().min(1).max(40000),user:z.string().max(100)}).strict()).max(200)
}).strict();
export type DesktopSlackBatch=z.infer<typeof desktopSlackBatchSchema>;
export const desktopSlackDisconnectSchema=z.object({operation:z.literal('desktop.slack.disconnect'),teamId:z.string().regex(/^T[A-Z0-9]+$/)}).strict();
export type DesktopSlackDisconnect=z.infer<typeof desktopSlackDisconnectSchema>;
