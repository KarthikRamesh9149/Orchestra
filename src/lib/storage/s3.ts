import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppEnv } from "../../config/env.js";
import type { StorageDriver, StoredFile, UploadInput } from "./types.js";

export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;

  constructor(private readonly env: AppEnv) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY
            }
          : undefined
    });
  }

  async putObject(input: UploadInput): Promise<StoredFile> {
    if (!this.env.S3_BUCKET) {
      throw new Error("S3_BUCKET must be configured for s3 storage driver.");
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType
      })
    );

    return { key: input.key, size: input.body.length };
  }

  async getObject(key: string): Promise<Buffer> {
    if (!this.env.S3_BUCKET) {
      throw new Error("S3_BUCKET must be configured for s3 storage driver.");
    }

    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key
      })
    );

    const bytes = await response.Body?.transformToByteArray();
    return Buffer.from(bytes ?? []);
  }

  async getObjectStream(key: string) {
    if (!this.env.S3_BUCKET) {
      throw new Error("S3_BUCKET must be configured for s3 storage driver.");
    }
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
    if (!response.Body) throw new Error("S3 object body is unavailable.");
    const stream = Symbol.asyncIterator in response.Body
      ? Readable.from(response.Body as AsyncIterable<Uint8Array>)
      : Readable.fromWeb(response.Body.transformToWebStream() as never);
    return { stream, size: response.ContentLength };
  }

  async getSignedUrl(key: string): Promise<string> {
    if (!this.env.S3_BUCKET) {
      throw new Error("S3_BUCKET must be configured for s3 storage driver.");
    }

    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key
      }),
      {
        expiresIn: this.env.SIGNED_URL_TTL_SECONDS
      }
    );
  }

  async deleteObject(key: string) {
    if (!this.env.S3_BUCKET) {
      throw new Error("S3_BUCKET must be configured for s3 storage driver.");
    }
    await this.client.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
  }
}
