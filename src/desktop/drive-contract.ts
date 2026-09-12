import {z} from 'zod';
export const desktopDriveFileSchema=z.object({
 operation:z.literal('desktop.drive.ingest'),projectId:z.string().uuid(),
 fileId:z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),name:z.string().min(1).max(512),
 mimeType:z.string().min(1).max(150),modifiedTime:z.string().datetime(),version:z.string().regex(/^\d{1,30}$/),
 contentType:z.enum(['text/plain','text/markdown','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
 fileName:z.string().min(1).max(255).refine(s=>!/[\x00-\x1f/\\]/.test(s)),
 base64:z.string().min(4).max(14*1024*1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
}).strict();
export type DesktopDriveFile=z.infer<typeof desktopDriveFileSchema>;
