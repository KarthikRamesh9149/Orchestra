import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppEnv } from "../../config/env.js";
import { AppError } from "../../app/errors.js";

type CredentialProvider = string;
type CredentialValue = Record<string, unknown> | null;

type StoredEnvelope = {
  provider: CredentialProvider;
  connectorId: string;
  createdAt: string;
  payload: string | null;
};

const memoryVault = new Map<string, StoredEnvelope>();

export class CredentialVault {
  private readonly rootDir: string;
  private readonly encryptionKey: Buffer;

  constructor(private readonly env: AppEnv) {
    this.rootDir =
      env.STORAGE_DRIVER === "local"
        ? path.resolve(env.STORAGE_LOCAL_ROOT, ".vault", "connectors")
        : path.resolve(process.cwd(), ".vault", "connectors");
    this.encryptionKey = createHash("sha256").update(env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY).digest();
  }

  async putCredential(input: {
    provider: CredentialProvider;
    connectorId: string;
    credential: CredentialValue;
  }) {
    if (input.provider === "manual_import") {
      return { ref: `manual:${input.connectorId}` };
    }

    const ref = `vault:${input.provider}:${input.connectorId}`;

    if (this.env.CONNECTOR_CREDENTIAL_VAULT_MODE === "managed_reference") {
      const managedSecretRef = this.extractManagedSecretRef(input.credential);
      if (!managedSecretRef) {
        throw new AppError(
          500,
          "Managed credential vault mode requires a pre-provisioned external secret reference",
          "managed_credential_reference_required"
        );
      }

      return { ref: managedSecretRef };
    }

    const record: StoredEnvelope = {
      provider: input.provider,
      connectorId: input.connectorId,
      createdAt: new Date().toISOString(),
      payload: input.credential == null ? null : this.encryptPayload(input.credential)
    };

    if (this.env.CONNECTOR_CREDENTIAL_VAULT_MODE === "memory") {
      if (this.env.DEPLOYMENT_ENV === "production") {
        throw new AppError(
          500,
          "In-memory credential storage is disabled in production",
          "credential_vault_mode_forbidden"
        );
      }

      memoryVault.set(ref, record);
      return { ref };
    }

    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    await writeFile(this.pathForRef(ref), JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    return { ref };
  }

  async getCredential(provider: CredentialProvider, connectorId: string, credentialsRef?: string | null) {
    if (provider === "manual_import") {
      return null;
    }

    const ref = credentialsRef ?? `vault:${provider}:${connectorId}`;

    if (this.env.CONNECTOR_CREDENTIAL_VAULT_MODE === "managed_reference") {
      throw new AppError(
        503,
        "Managed credential resolution is not configured in this deployment",
        "managed_credential_resolution_unavailable"
      );
    }

    const stored =
      this.env.CONNECTOR_CREDENTIAL_VAULT_MODE === "memory"
        ? memoryVault.get(ref) ?? null
        : await this.readFileRecord(ref);

    if (!stored || stored.payload == null) {
      return null;
    }

    return this.decryptPayload(stored.payload);
  }

  async revokeCredential(provider: CredentialProvider, connectorId: string, credentialsRef?: string | null) {
    if (provider === "manual_import") {
      return;
    }

    const ref = credentialsRef ?? `vault:${provider}:${connectorId}`;
    if (this.env.CONNECTOR_CREDENTIAL_VAULT_MODE === "managed_reference") {
      return;
    }

    if (this.env.CONNECTOR_CREDENTIAL_VAULT_MODE === "memory") {
      memoryVault.delete(ref);
      return;
    }

    await rm(this.pathForRef(ref), { force: true });
  }

  private encryptPayload(payload: Record<string, unknown>) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  private decryptPayload(envelope: string) {
    const [ivRaw, tagRaw, dataRaw] = envelope.split(".");
    if (!ivRaw || !tagRaw || !dataRaw) {
      throw new AppError(500, "Credential envelope is malformed", "credential_envelope_invalid");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey,
      Buffer.from(ivRaw, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataRaw, "base64url")),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;
  }

  private pathForRef(ref: string) {
    return path.join(this.rootDir, `${ref.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  }

  private async readFileRecord(ref: string) {
    try {
      const payload = await readFile(this.pathForRef(ref), "utf8");
      return JSON.parse(payload) as StoredEnvelope;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  private extractManagedSecretRef(credential: CredentialValue) {
    if (!credential || typeof credential !== "object") {
      return null;
    }

    const managedSecretRef = credential["managedSecretRef"];
    if (typeof managedSecretRef !== "string") {
      return null;
    }

    if (!managedSecretRef.startsWith(this.env.CONNECTOR_MANAGED_SECRET_PREFIX)) {
      throw new AppError(
        500,
        "Managed credential reference does not match the configured prefix",
        "managed_credential_reference_invalid"
      );
    }

    const disallowedSecretKeys = Object.keys(credential).filter((key) =>
      /token|secret|password|credential|api[_-]?key|authorization|private/i.test(key) && key !== "managedSecretRef"
    );
    if (disallowedSecretKeys.length > 0) {
      throw new AppError(
        500,
        "Managed credential references must not include raw secret material",
        "managed_credential_contains_secret_material"
      );
    }

    return managedSecretRef;
  }
}
