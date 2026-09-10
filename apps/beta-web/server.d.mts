import type { Server } from "node:http";

export function resolveAsset(url: string): string;
export function createBetaWebServer(options?: {
  apiTarget?: URL | null;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Server;
