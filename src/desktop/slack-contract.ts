import {z} from 'zod';
export const slackChannelSchema=z.object({id:z.string().regex(/^C[A-Z0-9]+$/),name:z.string().min(1).max(255)}).strict();
export const slackTimestampSchema=z.string().regex(/^\d{10,12}\.\d{6}$/);
export const desktopSlackBatchSchema=z.object({
 operation:z.literal('desktop.slack.ingest'),projectId:z.string().guid(),teamId:z.string().regex(/^T[A-Z0-9]+$/),teamName:z.string().max(255),channel:slackChannelSchema,
 messages:z.array(z.object({ts:slackTimestampSchema,threadTs:slackTimestampSchema,text:z.string().trim().min(1).max(40000),user:z.string().max(100)}).strict()).max(200),
 deletedTimestamps:z.array(slackTimestampSchema).max(200),
 snapshot:z.object({oldestMs:z.number().int().nonnegative(),latestMs:z.number().int().nonnegative(),complete:z.boolean()}).strict().refine(
  window=>window.latestMs>window.oldestMs&&window.latestMs-window.oldestMs<=30*86400_000,
  'Invalid Slack history window'
 ).optional()
}).strict();
export type DesktopSlackBatch=z.infer<typeof desktopSlackBatchSchema>;
export const desktopSlackDisconnectSchema=z.object({operation:z.literal('desktop.slack.disconnect'),teamId:z.string().regex(/^T[A-Z0-9]+$/)}).strict();
export type DesktopSlackDisconnect=z.infer<typeof desktopSlackDisconnectSchema>;
