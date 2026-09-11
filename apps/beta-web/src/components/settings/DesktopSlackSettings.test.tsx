import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import DesktopSlackSettings from './DesktopSlackSettings';
vi.mock('../../context/AuthContext',()=>({useAuth:()=>({activeProject:{id:'synthetic-project'}})}));
afterEach(()=>{delete window.orchestra;});
it('does not claim connection on a rejected native action',async()=>{
 const inspect=vi.fn().mockResolvedValue({ok:true,data:{connected:false,teamName:null}});
 Object.assign(window,{orchestra:{slack:{inspect,connect:vi.fn().mockResolvedValue({ok:false,error:{message:'Authorization expired'}})}}});
 render(<DesktopSlackSettings/>);await screen.findByText('Not connected on this Mac.');await userEvent.click(screen.getByRole('button',{name:'Connect desktop Slack'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Authorization expired');expect(screen.queryByText(/Credentials saved/)).not.toBeInTheDocument();
});
it('re-reads authoritative state after connecting',async()=>{
 const inspect=vi.fn().mockResolvedValueOnce({ok:true,data:{connected:false,teamName:null}}).mockResolvedValue({ok:true,data:{connected:true,teamName:'Synthetic'}});
 Object.assign(window,{orchestra:{slack:{inspect,connect:vi.fn().mockResolvedValue({ok:true})}}});render(<DesktopSlackSettings/>);
 await screen.findByText('Not connected on this Mac.');await userEvent.click(screen.getByRole('button',{name:'Connect desktop Slack'}));expect(await screen.findByText('Credentials saved for Synthetic.')).toBeInTheDocument();expect(inspect).toHaveBeenCalledTimes(2);
});
