// Three bounded real-provider calls with synthetic evidence. No customer data.
// This isolates model contracts; it does not certify database retrieval or UI.
import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {DesktopAiProvider} from '../../src/desktop/ai-provider.js';
const root=resolve(import.meta.dirname,'../..');
const key=parseEnv(await readFile(resolve(root,'.env.local'),'utf8')).OPENAI_API_KEY;
if(!key)throw new Error('Dedicated desktop test key missing');
let requests=0;
const provider=new DesktopAiProvider({apiKey:key,preferences:{generationModel:'gpt-5.4-mini',embeddingModel:'text-embedding-3-small',embeddingDimensions:1536,maxRequestsPerDay:3,maxOutputTokens:1024}},{checkRequestLimit:async()=>({allowed:++requests<=3,code:'socrates_rate_limited'})});
const results:{passed:string[];samples:unknown[];failure?:string}={passed:[],samples:[]};
try{
 const schema=z.object({launchDate:z.string(),sourceId:z.string(),owner:z.string()});
 const structured=await provider.generateObject({prompt:'Synthetic document A-17: The desktop pilot launches on 19 November 2027. Mira owns approval. Extract its launchDate, sourceId and owner. Use ISO date format.',schema,fallback:()=>{throw new Error('Fallback must not run');},timeoutMs:20000});
 assert.deepEqual(structured,{launchDate:'2027-11-19',sourceId:'A-17',owner:'Mira'});results.passed.push('real structured extraction matches synthetic source exactly');
 let deltas=0,firstTextMs:number|undefined;const start=performance.now();
 const answer=await provider.streamText({prompt:'Evidence [A-17]: The pilot launch is 19 November 2027, approved by Mira. Evidence [B-22]: The old proposed date was 3 October 2027 and was rejected. In two sentences, give the approved date and owner with [A-17], then distinguish the rejected proposal with [B-22]. Do not invent facts.',fallback:()=>{throw new Error('Fallback must not run');},timeoutMs:20000,onDelta:()=>{deltas++;firstTextMs??=Math.round(performance.now()-start);}});
 assert(answer.includes('[A-17]')&&answer.includes('[B-22]')&&answer.includes('Mira')&&answer.includes('19')&&/reject/i.test(answer));assert(deltas>0);
 results.samples.push({flow:'direct provider synthetic evidence',firstTextMs,completionMs:Math.round(performance.now()-start),deltas});results.passed.push('real streaming preserves supplied sources and rejected-vs-approved distinction');
 const vector=await provider.embedText('Synthetic desktop approval by Mira.');assert.equal(vector.length,1536);assert(vector.every(Number.isFinite));results.passed.push('real embedding returns the pinned finite 1536-dimensional vector');
 await assert.rejects(provider.embedText('Must not transmit a fourth request'),(error:unknown)=>(error as {code?:string}).code==='ai_request_budget_exceeded');results.passed.push('qualification allowance prevents a fourth provider request');
 console.log(JSON.stringify(results));
}catch(error){results.failure=error instanceof Error?error.name:'Provider qualification failed';console.error('Provider qualification failed; no provider payload or credential logged.');process.exitCode=1;}
finally{provider.revoke();await writeFile(resolve(root,'.desktop/step5-real-provider.json'),JSON.stringify(results,null,2));}
