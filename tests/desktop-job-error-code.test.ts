import {it,expect} from 'vitest';
import {safeDesktopJobFailure} from '../src/lib/jobs/postgres-worker.js';
it('retains actionable safe failure codes without exception text or provider secrets',()=>{
 expect(safeDesktopJobFailure({code:'ai_request_budget_exceeded',message:'private'})).toBe('ai_request_budget_exceeded');
 expect(safeDesktopJobFailure({code:'P2010',meta:{code:'42883',message:'private'}})).toBe('P2010_42883');
 expect(safeDesktopJobFailure({code:'token-secret',message:'private'})).toBe('handler_failed');
 expect(safeDesktopJobFailure(new TypeError('private'))).toBe('handler_type_error');
});
