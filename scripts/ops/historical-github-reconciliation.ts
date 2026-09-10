import assert from "node:assert/strict";
import { createHash, createSign } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const TARGETS = ["973a2037-2e71-467a-baa0-73eda8e99956", "4ec3d04c-231f-4077-ba03-0f468d816732"];
export const REASON = "historical_payload_unrecoverable: original push commit/ref details were not retained and the GitHub redelivery window has expired. Not successfully processed; original event history was not recovered.";
export function assertUnrecoverableDelivery(row: { id: string; status: string; eventType: string; githubDeliveryId: string; updatedAt: Date; payloadJson: unknown }, retainedGuids: string[], now: Date) {
  assert.ok(TARGETS.includes(row.id), "Unexpected delivery target");
  assert.equal(row.status, "received", "Delivery state changed; do not overwrite it");
  assert.equal(row.eventType, "push");
  assert.ok(now.getTime() - row.updatedAt.getTime() > 3 * 86_400_000, "Delivery may still be active or replayable");
  assert.ok(!retainedGuids.includes(row.githubDeliveryId), "Provider still retains this delivery");
  const payload = row.payloadJson as Record<string, unknown>;
  assert.ok(payload && typeof payload === "object");
  assert.ok(!payload.ref && !payload.after && !payload.head_commit && !payload.commits, "Payload may still be recoverable");
}

async function main() {
  let raw = ""; for await (const chunk of process.stdin) raw += chunk;
  const config = JSON.parse(raw);
  assert.equal(config.DEPLOYMENT_ENV, "production");
  const database = new URL(config.DATABASE_URL);
  assert.equal(database.username.split(".").pop(), "ntpfbyeneihrdqknwhym");
  database.searchParams.set("connection_limit", "2");
  process.env.DATABASE_URL = database.toString();
  const now = new Date();
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const seconds = Math.floor(now.getTime() / 1000);
  const input = `${encode({alg:"RS256",typ:"JWT"})}.${encode({iat:seconds-60,exp:seconds+300,iss:config.GITHUB_APP_ID})}`;
  const signer = createSign("RSA-SHA256"); signer.update(input); signer.end();
  const token = `${input}.${signer.sign(config.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g,"\n")).toString("base64url")}`;
  const response = await fetch("https://api.github.com/app/hook/deliveries?per_page=100", { headers: { Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28" },signal:AbortSignal.timeout(20_000) });
  assert.equal(response.status,200,"Provider delivery inspection failed");
  assert.ok(!response.headers.get("link")?.includes('rel="next"'),"Delivery list is incomplete; inspect all pages first");
  const retained = await response.json() as Array<{guid:string}>;
  assert.ok(Array.isArray(retained));
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.gitHubWebhookEvent.findMany({where:{id:{in:TARGETS}}});
    assert.equal(rows.length,2);
    for (const row of rows) {
      assert.equal(row.orgId,"a5db996a-f15a-4615-b4ef-886fb6411e9d");
      assert.equal(row.repositoryLinkId,"9eed047b-a4ff-457a-a25b-2656a8d36e6a");
      assertUnrecoverableDelivery(row,retained.map(item=>item.guid),now);
    }
    console.log(JSON.stringify({mode:process.argv.includes("--execute")?"execute":"dry_run",targets:rows.map(row=>({id:row.id,from:row.status,to:"failed",payloadPreserved:true})),reason:REASON}));
    if (!process.argv.includes("--execute")) return;
    await prisma.$transaction(async tx => {
      for (const row of rows) {
        const result=await tx.gitHubWebhookEvent.updateMany({where:{id:row.id,status:"received",updatedAt:row.updatedAt},data:{status:"failed",errorMessage:REASON,processedAt:now}});
        assert.equal(result.count,1,"Concurrent delivery change; roll back reconciliation");
        await tx.auditEvent.create({data:{orgId:row.orgId!,projectId:"f558218b-8ad1-429c-a9b5-b4b8f3213a50",eventType:"github.webhook.reconciled_unrecoverable",entityType:"github_webhook_event",entityId:row.id,payloadJson:{previousStatus:row.status,previousUpdatedAt:row.updatedAt.toISOString(),githubDeliveryId:row.githubDeliveryId,payloadSha256:createHash("sha256").update(JSON.stringify(row.payloadJson)).digest("hex"),providerDeliveriesChecked:retained.length,providerOriginalAvailable:false,historyRecovered:false,reason:REASON}}});
      }
    });
    const final = await prisma.gitHubWebhookEvent.findMany({where:{id:{in:TARGETS}}});
    assert.ok(final.every(row=>row.status==="failed"&&row.errorMessage===REASON));
    for (const row of final) assert.deepEqual(row.payloadJson,rows.find(before=>before.id===row.id)!.payloadJson);
    console.log("Verified: exactly two historical records reconciled as unrecoverable failures; original payloads preserved; audit events recorded. No source history fabricated.");
  } finally { await prisma.$disconnect(); }
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error instanceof Error?error.message:"Reconciliation failed");process.exitCode=1;});
