import {describe,it,expect,vi} from 'vitest';
import {dueTarget,finishedTarget,type SyncTarget} from '../apps/desktop/src/connector-sync-state.js';
import {rememberSyncTarget,refreshSelectedSource} from '../apps/desktop/src/connector-sync.js';
const target:SyncTarget={id:'00000000-0000-4000-8000-000000000001',provider:'drive',projectId:'00000000-0000-4000-8000-000000000002',resourceIds:['synthetic_file'],enabled:true,nextAt:100};
describe('selected source refresh lifecycle',()=>{
 it('never runs disabled or future selections; oldest due source wins',()=>{
  expect(dueTarget([{...target,enabled:false}],200)).toBeUndefined();expect(dueTarget([target],99)).toBeUndefined();expect(dueTarget([{...target,nextAt:150},target],200)).toBe(target);
 });
 it('retains the last successful time on failure and schedules a bounded retry',()=>{
  const before={...target,lastSuccessAt:'2026-09-01T00:00:00.000Z'},failed=finishedTarget(before,false,1000);
  expect(failed.lastSuccessAt).toBe(before.lastSuccessAt);expect(failed.nextAt).toBe(61000);expect(failed.error).toBe('source_refresh_failed');
  expect(finishedTarget(failed,true,2000)).toMatchObject({error:null,nextAt:302000,lastSuccessAt:new Date(2000).toISOString()});
 });
 it('remembers an exact manual selection with background access disabled by default',async()=>{
  let state:any={version:1,ai:null};const settings={read:vi.fn(async()=>state),write:vi.fn(async v=>{state=v;})};
  const input={provider:'drive' as const,projectId:target.projectId,resourceIds:['synthetic_file']};
  await rememberSyncTarget(settings as any,input);await rememberSyncTarget(settings as any,input);
  expect(state.syncTargets).toHaveLength(1);expect(state.syncTargets[0].enabled).toBe(false);
 });
 it('does not use a changed grant or an inaccessible project',async()=>{
  const settings={read:vi.fn(async()=>({version:1,ai:null,drive:null}))};
  const host={request:vi.fn().mockResolvedValue({ok:true,data:[]})};
  await expect(refreshSelectedSource(target,settings as any,host as any)).rejects.toThrow('Workspace');expect(settings.read).not.toHaveBeenCalled();
  host.request.mockResolvedValue({ok:true,data:[{id:target.projectId}]} as any);
  await expect(refreshSelectedSource(target,settings as any,host as any)).rejects.toThrow('Drive selection');
 });
});
