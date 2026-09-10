import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageDriver } from "../src/lib/storage/local.js";

describe("LocalStorageDriver path safety", () => {
  let root: string;
  let storage: LocalStorageDriver;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "orchestra-storage-"));
    storage = new LocalStorageDriver(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores normal keys under the configured storage root", async () => {
    await storage.putObject({
      key: "project-1/documents/file.txt",
      body: Buffer.from("safe"),
      contentType: "text/plain"
    });

    await expect(readFile(join(root, "project-1", "documents", "file.txt"), "utf8")).resolves.toBe("safe");
    const streamed = await storage.getObjectStream("project-1/documents/file.txt");
    expect(streamed.size).toBe(4);
    const chunks: Buffer[] = [];
    for await (const chunk of streamed.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toBe("safe");
    await storage.deleteObject("project-1/documents/file.txt");
    await expect(readFile(join(root, "project-1", "documents", "file.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(storage.deleteObject("project-1/documents/file.txt")).resolves.toBeUndefined();
  });

  it("rejects traversal keys before reading or writing local files", async () => {
    await expect(
      storage.putObject({
        key: "project-1/documents/hash-../../../../../outside.txt",
        body: Buffer.from("pwned"),
        contentType: "text/plain"
      })
    ).rejects.toThrow("Storage key escapes local storage root");

    await expect(storage.getObject("../outside.txt")).rejects.toThrow("Storage key escapes local storage root");
    await expect(storage.getSignedUrl("../outside.txt")).rejects.toThrow("Storage key escapes local storage root");
    await expect(storage.getObjectStream("../outside.txt")).rejects.toThrow("Storage key escapes local storage root");
    await expect(storage.deleteObject("../outside.txt")).rejects.toThrow("Storage key escapes local storage root");
  });
});
