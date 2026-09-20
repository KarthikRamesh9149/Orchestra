import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRetrieval,buildScaleFixture,fixtureContentHash,fixtureId,parseScaleArgs,summarize} from '../scripts/desktop/benchmark-scale-native.mjs';

test('percentiles use explicit empirical nearest rank and withhold tiny-sample p95',()=>{
  assert.deepEqual(summarize([1,2,3]).p95Ms,null);
  const result=summarize(Array.from({length:20},(_,i)=>i+1));assert.equal(result.p50Ms,10);assert.equal(result.p95Ms,19);assert.equal(result.samples,20);
  assert.throws(()=>summarize([NaN]),/Invalid timing/);
});
test('scale arguments are bounded and have no key/profile/cache deletion surface',()=>{
  const options=parseScaleArgs([]);assert.equal(options.documents,1000);assert.equal(options.chunksPerDocument,10);assert.equal(options.cycles,30);
  for(const args of [['--key-file','/private/key'],['--profile','/existing/profile'],['--flush-caches','yes'],['--documents','100000'],['--cycles','1000'],['--max-runtime-ms','99999999']])assert.throws(()=>parseScaleArgs(args));
});
const options={documents:100,chunksPerDocument:4};
const fixture=buildScaleFixture(options,fixtureId('project'),fixtureId('owner'),fixtureId('foreign'));
test('varied fixture has exact active scale and consistent explicit decoys',()=>{
  assert.equal(fixture.documents.length,102);assert.equal(fixture.chunks.length,404);assert.equal(fixture.chunks.filter(chunk=>chunk.allowed).length,400);
  assert.equal(new Set(fixture.chunks.map(chunk=>chunk.id)).size,fixture.chunks.length);
  assert.equal(new Set(fixture.chunks.map(chunk=>chunk.text)).size,fixture.chunks.length);
  assert.equal(fixture.forbidden.length,4);
  assert(fixture.chunks.filter(chunk=>chunk.allowed).every(chunk=>chunk.projectid===fixture.projectId&&chunk.revision===2));
  assert(fixture.cases.find(value=>value.name==='multi_document_recall').expected.length<=6);
});
test('fixture content identity is stable across fresh tenant and user identities',()=>{
  const other=buildScaleFixture(options,fixtureId('another-project'),fixtureId('another-owner'),fixtureId('another-foreign'));
  assert.equal(fixtureContentHash(fixture),fixtureContentHash(other));
  other.chunks[0].text+=' Changed fixture fact.';assert.notEqual(fixtureContentHash(fixture),fixtureContentHash(other));
});
function responseFor(ids){const chunks=ids.map(id=>fixture.chunks.find(chunk=>chunk.id===id));return {sessionId:fixtureId('session'),messageId:fixtureId('message'),answer_md:chunks.map(chunk=>chunk.text).join('\n'),modelMetadata:{provider:'deterministic'},costEstimate:{modelCalls:0,estimatedUsd:0},retrievalSummary:{performance:{retrievalMs:5},sourceCounts:{documents:new Set(chunks.map(chunk=>chunk.documentid)).size}},citations:chunks.map(chunk=>({refId:chunk.id,openTargetId:chunk.id,excerpt:chunk.text.slice(0,220)})),open_targets:chunks.map(chunk=>({id:chunk.id,targetRef:{documentId:chunk.documentid,documentVersionId:chunk.versionid}}))};}
test('sparse-fact oracle requires IDs, exact fact values and real current target mapping',()=>{
  const testCase=fixture.cases[0],response=responseFor(testCase.expected);assert.equal(assessRetrieval(response,testCase,fixture).passed,true);
  assert.equal(assessRetrieval(responseFor([]),testCase,fixture).passed,false);
  response.open_targets[0].targetRef.documentVersionId='wrong';assert.equal(assessRetrieval(response,testCase,fixture).passed,false);
});
test('oracle fails obsolete versions, stale parse, archived and tenant rows',()=>{
  for(const forbidden of fixture.forbidden){const response=responseFor([fixture.factChunks.ancient,forbidden]);assert.equal(assessRetrieval(response,fixture.cases[0],fixture).passed,false);}
});
test('oracle rejects orphan foreign open targets and missing persistence identities',()=>{
  const response=responseFor([fixture.factChunks.ancient]);
  response.open_targets.push(...responseFor([fixture.forbidden.at(-1)]).open_targets);
  assert.equal(assessRetrieval(response,fixture.cases[0],fixture).passed,false);
  const missing=responseFor([fixture.factChunks.ancient]);delete missing.messageId;
  assert.equal(assessRetrieval(missing,fixture.cases[0],fixture).passed,false);
});
test('topical precision requires a relevant passage without imposing strict document scope or a chunk count',()=>{
  const testCase=fixture.cases.find(value=>value.name==='topical_precision');
  const chunks=fixture.chunks.filter(chunk=>chunk.allowed&&chunk.text.includes('Saffronrelay')).slice(0,2);
  const response=responseFor(chunks.map(chunk=>chunk.id));assert.equal(assessRetrieval(response,testCase,fixture).passed,true);
  response.retrievalSummary.sourceCounts.documents=2;assert.equal(assessRetrieval(response,testCase,fixture).passed,true);
  assert.equal(assessRetrieval(responseFor([fixture.factChunks.ancient]),testCase,fixture).passed,false);
  assert.equal(assessRetrieval(responseFor([chunks[0].id]),testCase,fixture).passed,true);
  assert.equal(assessRetrieval(responseFor([chunks[0].id,fixture.factChunks.ancient]),testCase,fixture).passed,false);
});
