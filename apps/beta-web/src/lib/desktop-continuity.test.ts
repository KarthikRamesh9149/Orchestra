import {afterEach,expect,it,vi} from 'vitest';
import {http,HttpResponse} from 'msw';
import {server} from '../test/server';
import {getDocs,clearAuth} from './api';
import {useChatStore} from '../store/chatStore';
afterEach(()=>{useChatStore.getState().resetContinuity();delete window.orchestra;vi.useRealTimers();localStorage.clear();sessionStorage.clear();clearAuth();});
it('preserves partial indexing without an endless processing indicator',async()=>{
 clearAuth();server.use(http.get('http://localhost:3000/v1/projects/local/documents',()=>HttpResponse.json({data:[{id:'doc',title:'Offline evidence',currentVersion:{status:'partial'}}]})));
 expect((await getDocs('local'))[0].status).toBe('partial');
});
it('checkpoints local drafts to durable storage and clears on identity change',async()=>{
 vi.useFakeTimers();window.orchestra={status:vi.fn(),bootstrap:vi.fn(),completeOnboarding:vi.fn()};
 useChatStore.getState().resetContinuity();useChatStore.getState().bindIdentity('local-owner:installation');useChatStore.getState().setProject('project');useChatStore.getState().setDraft('project',null,'Local restart draft');vi.advanceTimersByTime(300);
 expect(localStorage.getItem('orchestra_chat_drafts_v1')).toContain('Local restart draft');expect(sessionStorage.getItem('orchestra_chat_drafts_v1')).toBeNull();
 // The durable storage boundary is independently checked by the packaged restart suite.
 useChatStore.getState().bindIdentity('another-owner:installation');expect(localStorage.getItem('orchestra_chat_drafts_v1')).not.toContain('Local restart draft');
});
