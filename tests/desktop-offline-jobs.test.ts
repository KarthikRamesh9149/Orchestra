import {describe,it,expect} from 'vitest';
import {requiresExternalGeneration} from '../src/desktop/offline-jobs.js';
import {JobNames} from '../src/lib/jobs/types.js';
import {boundaryStates} from '../src/modules/truth-inbox/truth-change-packet.service.js';
describe('offline projection policy',()=>{
 it('does not display a completed human decision as still awaiting approval',()=>{
  for(const status of ['accepted','rejected','superseded']){
   const boundary=boundaryStates(1,true,1,status).find(b=>b.stage==='proposed_change');
   expect(boundary?.state).toBe('present');expect(boundary?.detail).toContain(status);expect(boundary?.detail).not.toContain('Awaiting');
  }
  expect(boundaryStates(1,true,1,'proposed')[2]?.state).toBe('pending');
 });
 it('preserves the complete deterministic approval projection chain',()=>{
  for(const name of [JobNames.generateSourcePackage,JobNames.generateClarifiedBrief,JobNames.generateBrainGraph,JobNames.generateProductBrain,JobNames.generateLiveDoc,JobNames.applyAcceptedChange])expect(requiresExternalGeneration(name),name).toBe(false);
 });
 it('does not enable model-driven interpretation or research',()=>{
  for(const name of [JobNames.classifyMessageInsight,JobNames.classifyThreadInsight,JobNames.generateChangeProposalFromInsight,JobNames.deepResearchRun])expect(requiresExternalGeneration(name),name).toBe(true);
 });
});
