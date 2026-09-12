import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import DesktopDriveSettings from './DesktopDriveSettings';
vi.mock('../../context/AuthContext',()=>({useAuth:()=>({activeProject:{id:'project'}})}));
afterEach(()=>{delete window.orchestra;});
it('shows confirmed selected-file state without claiming ingestion',async()=>{
 Object.assign(window,{orchestra:{drive:{inspect:vi.fn().mockResolvedValue({ok:true,data:{connected:true,selectedFileCount:1}})}}});
 render(<DesktopDriveSettings/>);expect(await screen.findByText('1 selected file authorized on this Mac.')).toBeInTheDocument();
 expect(screen.getByText(/Authorization alone does not import content/)).toBeInTheDocument();
});
it('imports only on click and shows authoritative saved state',async()=>{
 const importFiles=vi.fn().mockResolvedValue({ok:true,data:{saved:1,files:[{status:'pending'}]}});
 Object.assign(window,{orchestra:{drive:{inspect:vi.fn().mockResolvedValue({ok:true,data:{connected:true,selectedFileCount:1}}),importFiles}}});
 render(<DesktopDriveSettings/>);await screen.findByText('1 selected file authorized on this Mac.');expect(importFiles).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole('button',{name:'Import selected Drive files'}));
 expect(importFiles).toHaveBeenCalledExactlyOnceWith('project');expect(await screen.findByText(/1 file\(s\) confirmed saved/)).toHaveTextContent('not accepted product truth');
});
it('does not turn a failed or partial import into a success notice',async()=>{
 Object.assign(window,{orchestra:{drive:{inspect:vi.fn().mockResolvedValue({ok:true,data:{connected:true,selectedFileCount:1}}),importFiles:vi.fn().mockResolvedValue({ok:false,error:{message:'Import stopped; 0 files saved'}})}}});
 render(<DesktopDriveSettings/>);await screen.findByText('1 selected file authorized on this Mac.');
 await userEvent.click(screen.getByRole('button',{name:'Import selected Drive files'}));expect(await screen.findByRole('alert')).toHaveTextContent('0 files saved');
 expect(screen.queryByText(/confirmed saved/)).not.toBeInTheDocument();
});
it('reports failed authorization and retains the authoritative disconnected state',async()=>{
 Object.assign(window,{orchestra:{drive:{inspect:vi.fn().mockResolvedValue({ok:true,data:{connected:false,clientConfigured:true}}),connect:vi.fn().mockResolvedValue({ok:false,error:{message:'Google declined authorization'}})}}});
 render(<DesktopDriveSettings/>);await screen.findByText('Not connected on this Mac.');
 await userEvent.click(screen.getByRole('button',{name:'Select Google Drive files'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Google declined authorization');
 expect(screen.getByText('Not connected on this Mac.')).toBeInTheDocument();
});
