import { describe, it, expect } from "vitest";
import { assertUnrecoverableDelivery } from "../scripts/ops/historical-github-reconciliation.js";
const now = new Date("2026-09-05T06:00:00Z");
const row = { id:"973a2037-2e71-467a-baa0-73eda8e99956",status:"received",eventType:"push",githubDeliveryId:"expired-delivery",updatedAt:new Date("2026-08-21T02:49:50Z"),payloadJson:{repository:{id:1213133955}} };
describe("narrow historical delivery reconciliation",()=>{
  it("admits only expired, incomplete, unavailable targets",()=>expect(()=>assertUnrecoverableDelivery(row,[],now)).not.toThrow());
  it.each([{id:"unrelated"},{status:"processed"},{eventType:"pull_request"},{updatedAt:now},{payloadJson:{ref:"refs/heads/main"}},{payloadJson:{commits:[]}}])("refuses unsafe or recoverable state %j",patch=>expect(()=>assertUnrecoverableDelivery({...row,...patch},[],now)).toThrow());
  it("refuses a provider-retained delivery",()=>expect(()=>assertUnrecoverableDelivery(row,[row.githubDeliveryId],now)).toThrow());
});
