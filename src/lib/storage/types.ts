export interface StoredFile {
  key: string;
  size: number;
}

export interface UploadInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StorageDriver {
  putObject(input: UploadInput): Promise<StoredFile>;
  getObject(key: string): Promise<Buffer>;
  getObjectStream(key: string): Promise<{ stream: Readable; size?: number }>;
  getSignedUrl(key: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
import type { Readable } from "node:stream";
