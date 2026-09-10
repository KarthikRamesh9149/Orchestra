import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import type { TelemetryService } from "../../lib/observability/telemetry.js";

export type ConnectorLease = {
  connectorId: string;
  ownerToken: string;
  fencingToken: bigint;
  expiresAt: Date;
};

export class ConnectorLeaseLostError extends AppError {
  constructor() {
    super(409, "Connector lease was lost to another worker", "connector_lease_lost");
  }
}

export class ConnectorLeaseService {
  private readonly ttlMs: number;
  private readonly heartbeatMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    env: Pick<AppEnv, "CONNECTOR_LEASE_TTL_SECONDS" | "CONNECTOR_LEASE_HEARTBEAT_SECONDS">,
    private readonly telemetry?: TelemetryService
  ) {
    this.ttlMs = env.CONNECTOR_LEASE_TTL_SECONDS * 1000;
    this.heartbeatMs = env.CONNECTOR_LEASE_HEARTBEAT_SECONDS * 1000;
    if (this.heartbeatMs >= this.ttlMs) {
      throw new Error("CONNECTOR_LEASE_HEARTBEAT_SECONDS must be lower than CONNECTOR_LEASE_TTL_SECONDS");
    }
  }

  async acquire(connectorId: string): Promise<ConnectorLease | null> {
    const ownerToken = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const claimed = await this.prisma.communicationConnector.updateMany({
      where: {
        id: connectorId,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
      },
      data: {
        leaseOwnerToken: ownerToken,
        leaseHeartbeatAt: now,
        leaseExpiresAt: expiresAt,
        leaseFencingToken: { increment: 1 }
      }
    });
    if (claimed.count !== 1) {
      this.telemetry?.increment("connector_lease_claims_total", { status: "contended" });
      return null;
    }
    const row = await this.prisma.communicationConnector.findFirstOrThrow({
      where: { id: connectorId, leaseOwnerToken: ownerToken },
      select: { leaseFencingToken: true, leaseExpiresAt: true }
    });
    this.telemetry?.increment("connector_lease_claims_total", { status: "acquired" });
    return {
      connectorId,
      ownerToken,
      fencingToken: row.leaseFencingToken,
      expiresAt: row.leaseExpiresAt!
    };
  }

  async heartbeat(lease: ConnectorLease): Promise<ConnectorLease> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const updated = await this.prisma.communicationConnector.updateMany({
      where: {
        id: lease.connectorId,
        leaseOwnerToken: lease.ownerToken,
        leaseFencingToken: lease.fencingToken,
        leaseExpiresAt: { gt: now }
      },
      data: { leaseHeartbeatAt: now, leaseExpiresAt: expiresAt }
    });
    if (updated.count !== 1) {
      this.telemetry?.increment("connector_lease_heartbeats_total", { status: "lost" });
      throw new ConnectorLeaseLostError();
    }
    lease.expiresAt = expiresAt;
    this.telemetry?.increment("connector_lease_heartbeats_total", { status: "renewed" });
    return lease;
  }

  startHeartbeat(lease: ConnectorLease) {
    let lost: unknown = null;
    let running = false;
    const timer = setInterval(() => {
      if (running || lost) return;
      running = true;
      void this.heartbeat(lease).catch((error) => { lost = error; }).finally(() => { running = false; });
    }, this.heartbeatMs);
    timer.unref?.();
    return {
      assertValid: async () => {
        if (lost) throw lost;
        await this.heartbeat(lease);
        if (lost) throw lost;
      },
      stop: () => clearInterval(timer)
    };
  }

  async release(lease: ConnectorLease) {
    const released = await this.prisma.communicationConnector.updateMany({
      where: {
        id: lease.connectorId,
        leaseOwnerToken: lease.ownerToken,
        leaseFencingToken: lease.fencingToken
      },
      data: { leaseOwnerToken: null, leaseHeartbeatAt: null, leaseExpiresAt: null }
    });
    this.telemetry?.increment("connector_lease_releases_total", { status: released.count === 1 ? "released" : "stale_owner" });
    return released.count === 1;
  }

  async fencedConnectorUpdate(lease: ConnectorLease, data: Record<string, unknown>) {
    const updated = await this.prisma.communicationConnector.updateMany({
      where: {
        id: lease.connectorId,
        leaseOwnerToken: lease.ownerToken,
        leaseFencingToken: lease.fencingToken,
        leaseExpiresAt: { gt: new Date() }
      },
      data
    });
    if (updated.count !== 1) throw new ConnectorLeaseLostError();
  }
}
