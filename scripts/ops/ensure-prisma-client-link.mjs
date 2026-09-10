import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "../..");

const generatedPrismaDir = path.join(repoRoot, "node_modules", ".prisma");
const clientPrismaDir = path.join(repoRoot, "node_modules", "@prisma", "client", ".prisma");

if (!fs.existsSync(path.join(generatedPrismaDir, "client", "index.d.ts"))) {
  throw new Error("Generated Prisma client is missing. Run `prisma generate` before repairing the client link.");
}

fs.rmSync(clientPrismaDir, { force: true, recursive: true });
fs.mkdirSync(path.dirname(clientPrismaDir), { recursive: true });

try {
  fs.symlinkSync(generatedPrismaDir, clientPrismaDir, "junction");
} catch {
  fs.cpSync(generatedPrismaDir, clientPrismaDir, { recursive: true });
}

console.log("Prisma client package link verified.");
