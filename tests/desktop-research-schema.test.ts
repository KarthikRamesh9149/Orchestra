import {describe,it,expect} from 'vitest';
import {zodTextFormat} from 'openai/helpers/zod';
import {deepResearchStructuredSchema} from '../src/modules/deep-research/schemas.js';
describe('desktop research provider contract',()=>{
 it('requires every object property at every level for strict Responses output',()=>{
  const schema=zodTextFormat(deepResearchStructuredSchema,'desktop_research').schema;
  function verify(value:unknown){if(!value||typeof value!=='object')return;const node=value as Record<string,unknown>;if(node.type==='object'){expect(node.additionalProperties).toBe(false);expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());}for(const child of Object.values(node))if(Array.isArray(child))child.forEach(verify);else verify(child);}
  verify(schema);
 });
 it('does not manufacture a report from empty or malformed provider data',()=>{
  for(const value of [null,{},'garbage',{executiveSummary:''}])expect(deepResearchStructuredSchema.safeParse(value).success).toBe(false);
  expect(deepResearchStructuredSchema.parse({executiveSummary:'No relevant supplied evidence.',findings:[],marketContext:[],expansionOpportunities:[],recommendedActions:[]})).toMatchObject({findings:[]});
 });
});
