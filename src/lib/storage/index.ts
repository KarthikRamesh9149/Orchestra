import type { AppEnv } from "../../config/env.js";
import { LocalStorageDriver } from "./local.js";
import { S3StorageDriver } from "./s3.js";

export function createStorageDriver(env: AppEnv) {
  if (env.STORAGE_DRIVER === "s3") {
    return new S3StorageDriver(env);
  }

  return new LocalStorageDriver(env.STORAGE_LOCAL_ROOT);
}
