import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { StorageDriver, StoredFile, UploadInput } from "./types.js";

export class LocalStorageDriver implements StorageDriver {
  private readonly rootPath: string;

  constructor(root: string) {
    this.rootPath = resolve(root);
  }

  async putObject(input: UploadInput): Promise<StoredFile> {
    const filePath = this.pathForKey(input.key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);
    return { key: input.key, size: input.body.length };
  }

  async getObject(key: string) {
    return readFile(this.pathForKey(key));
  }

  async getObjectStream(key: string) {
    const filePath = this.pathForKey(key);
    const details = await stat(filePath);
    return { stream: createReadStream(filePath), size: details.size };
  }

  async getSignedUrl(key: string) {
    return this.pathForKey(key);
  }

  async deleteObject(key: string) {
    try {
      await unlink(this.pathForKey(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private pathForKey(key: string) {
    const filePath = resolve(this.rootPath, key);
    const rel = relative(this.rootPath, filePath);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error("Storage key escapes local storage root.");
    }
    return filePath;
  }
}
