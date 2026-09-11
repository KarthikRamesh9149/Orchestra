import {it,expect} from 'vitest';
import {commandSchema} from '../apps/desktop/src/contracts.js';
it('preserves explicit native chat scope and rejects unknown or empty selections',()=>{
 const request={operation:'socrates.ask',projectId:'00000000-0000-4000-8000-000000000001',requestId:'00000000-0000-4000-8000-000000000002',question:'What changed?',selectedSources:['slack']};
 expect(commandSchema.parse(request)).toMatchObject({selectedSources:['slack']});
 expect(commandSchema.safeParse({...request,selectedSources:['unknown']}).success).toBe(false);
 expect(commandSchema.safeParse({...request,selectedSources:[]}).success).toBe(false);
});
