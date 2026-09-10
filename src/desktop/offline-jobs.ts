import {JobNames,type JobName} from '../lib/jobs/types.js';

// These are deterministic projections of source bytes and human decisions,
// despite their historical "generate" names. They do not call a model.
const projections=new Set<JobName>([
 JobNames.generateSourcePackage,JobNames.generateClarifiedBrief,
 JobNames.generateBrainGraph,JobNames.generateProductBrain,
 JobNames.generateLiveDoc,JobNames.applyAcceptedChange
]);
export function requiresExternalGeneration(name:JobName):boolean {
 return !projections.has(name)&&(name.startsWith('generate_')||name.startsWith('classify_')||name===JobNames.deepResearchRun);
}
