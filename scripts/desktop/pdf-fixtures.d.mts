export function createDesktopSmokePdf(): Promise<Buffer>;
export function createDesktopRecoveryPdf(): Promise<Buffer>;
export function createDesktopTransferPdf(): Promise<Buffer>;
export function createDesktopWorkerCrashPdf(): Promise<Buffer>;
export function createDesktopCorpusChatPdf(): Promise<Buffer>;
export function createDesktopDemoDocuments(): Promise<Array<{filename: string; buffer: Buffer}>>;
