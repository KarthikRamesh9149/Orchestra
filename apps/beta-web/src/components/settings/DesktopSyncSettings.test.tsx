import {render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import DesktopSyncSettings from './DesktopSyncSettings';
vi.mock('../../context/AuthContext',()=>({useAuth:()=>({activeProject:{id:'project'}})}));
afterEach(()=>{delete window.orchestra;});
it('shows only the active workspace and never enables background access on mount',async()=>{
 const update=vi.fn(),inspect=vi.fn().mockResolvedValue({ok:true,data:{targets:[{id:'one',projectId:'project',provider:'drive',resourceIds:['file'],enabled:false},{id:'two',projectId:'other',provider:'github',resourceIds:['repo'],enabled:true}]}});
 Object.assign(window,{orchestra:{sync:{inspect,update}}});render(<DesktopSyncSettings/>);
 const row=await screen.findByRole('listitem',{name:'Google Drive refresh selection'});expect(within(row).getByRole('status')).toHaveTextContent('paused');expect(screen.queryByRole('listitem',{name:'GitHub refresh selection'})).not.toBeInTheDocument();expect(update).not.toHaveBeenCalled();
});
it('keeps a failed refresh visible instead of pretending it succeeded',async()=>{
 Object.assign(window,{orchestra:{sync:{inspect:vi.fn().mockResolvedValue({ok:true,data:{targets:[{id:'one',projectId:'project',provider:'drive',resourceIds:['file'],enabled:false}]}}),update:vi.fn().mockResolvedValue({ok:false,error:{message:'Selected source unavailable'}})}}});
 render(<DesktopSyncSettings/>);await userEvent.click(await screen.findByRole('button',{name:'Refresh now'}));expect(await screen.findByRole('alert')).toHaveTextContent('Selected source unavailable');
});
