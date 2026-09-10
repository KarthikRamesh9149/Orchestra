import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ConnectorLeaseLostError, ConnectorLeaseService } from "../src/modules/communications/connector-lease.service.js";

const env = { CONNECTOR_LEASE_TTL_SECONDS: 90, CONNECTOR_LEASE_HEARTBEAT_SECONDS: 20 };

describe("[FIX-24] fenced connector leases", () => {
  it("claims with a unique owner, increments fencing, heartbeats, fences writes, and releases", async () => {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const prisma = {
      communicationConnector: {
        updateMany,
        findFirstOrThrow: vi.fn().mockResolvedValue({ leaseFencingToken: 7n, leaseExpiresAt: new Date(Date.now() + 90_000) })
      }
    } as any;
    const telemetry = { increment: vi.fn() } as any;
    const service = new ConnectorLeaseService(prisma, env as any, telemetry);

    const lease = await service.acquire("connector-1");
    expect(lease).toMatchObject({ connectorId: "connector-1", fencingToken: 7n });
    expect(lease?.ownerToken).toMatch(/^[0-9a-f-]{36}$/i);
    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "connector-1", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: expect.any(Date) } }] },
      data: expect.objectContaining({ leaseFencingToken: { increment: 1 } })
    }));

    await service.heartbeat(lease!);
    await service.fencedConnectorUpdate(lease!, { status: "connected" });
    expect(updateMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({ leaseOwnerToken: lease!.ownerToken, leaseFencingToken: 7n, leaseExpiresAt: { gt: expect.any(Date) } })
    }));
    expect(await service.release(lease!)).toBe(true);
  });

  it("allows only one live owner and rejects overlapping workers", async () => {
    const prisma = {
      communicationConnector: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ leaseFencingToken: 1n, leaseExpiresAt: new Date(Date.now() + 90_000) })
      }
    } as any;
    const service = new ConnectorLeaseService(prisma, env as any);
    expect(await service.acquire("connector-1")).not.toBeNull();
    expect(await service.acquire("connector-1")).toBeNull();
  });

  it("rejects stale heartbeats and stale-owner writes after expiry or takeover", async () => {
    const prisma = {
      communicationConnector: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirstOrThrow: vi.fn()
      }
    } as any;
    const service = new ConnectorLeaseService(prisma, env as any);
    const stale = { connectorId: "connector-1", ownerToken: "11111111-1111-4111-8111-111111111111", fencingToken: 3n, expiresAt: new Date() };
    await expect(service.heartbeat(stale)).rejects.toBeInstanceOf(ConnectorLeaseLostError);
    await expect(service.fencedConnectorUpdate(stale, { status: "connected" })).rejects.toBeInstanceOf(ConnectorLeaseLostError);
    expect(await service.release(stale)).toBe(false);
  });

  it("persists the owner/fence/expiry contract and database shape guards", () => {
    const sql = readFileSync("prisma/migrations/20260820120000_connector_fenced_leases/migration.sql", "utf8");
    expect(sql).toContain('ADD COLUMN "lease_owner_token" UUID');
    expect(sql).toContain('ADD COLUMN "lease_fencing_token" BIGINT NOT NULL DEFAULT 0');
    expect(sql).toContain('CREATE UNIQUE INDEX "communication_sync_runs_idempotency_key"');
    expect(sql).toContain('"lease_expires_at" > "lease_heartbeat_at"');
    expect(sql).toContain('"lease_fencing_token" > 0');
  });
});
