import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import DesktopGitHubSettings from './DesktopGitHubSettings';
vi.mock('../../context/AuthContext',()=>({useAuth:()=>({activeProject:{id:'synthetic-project'}})}));
afterEach(()=>{delete window.orchestra;});
const install=(github:unknown)=>Object.assign(window,{orchestra:{github}});
async function selectImport(importRepository:unknown){
 install({inspect:vi.fn().mockResolvedValue({ok:true,data:{configured:true}}),repositories:vi.fn().mockResolvedValue({ok:true,data:[{id:123,full_name:'test/repo'}]}),importRepository});
 render(<DesktopGitHubSettings/>);await screen.findByText('GitHub credentials saved on this Mac.');
 await userEvent.click(screen.getByRole('button',{name:'List authorized repositories'}));
 await userEvent.selectOptions(await screen.findByLabelText('Repository to import'),'123');
}
it('imports only the selected repository and confirms authoritative counts',async()=>{
 const save=vi.fn().mockResolvedValue({ok:true,data:{evidenceCount:5,created:3,updated:2}});await selectImport(save);
 await userEvent.click(screen.getByRole('button',{name:'Import selected GitHub repository'}));
 expect(await screen.findByText('5 GitHub evidence records confirmed: 3 new, 2 updated. No product truth was approved.')).toBeInTheDocument();
 expect(save).toHaveBeenCalledExactlyOnceWith({projectId:'synthetic-project',repositoryId:123});
});
it('blocks overlapping imports and displays a failed import instead of a save',async()=>{
 let finish!:(value:unknown)=>void;const save=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));await selectImport(save);
 const button=screen.getByRole('button',{name:'Import selected GitHub repository'});await userEvent.dblClick(button);
 expect(save).toHaveBeenCalledTimes(1);expect(button).toBeDisabled();
 finish({ok:false,error:{message:'Repository permission revoked'}});
 expect(await screen.findByRole('alert')).toHaveTextContent('Repository permission revoked');
 expect(screen.queryByText(/evidence records confirmed/)).not.toBeInTheDocument();
 expect(button).toBeEnabled();
});
it('lets the user retry a failed protected-settings read without reloading',async()=>{
 const inspect=vi.fn().mockResolvedValueOnce({ok:false,error:{message:'Credential store unavailable'}}).mockResolvedValue({ok:true,data:{configured:false}});
 install({inspect});render(<DesktopGitHubSettings/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Credential store unavailable');
 await userEvent.click(screen.getByRole('button',{name:'Retry GitHub status'}));
 expect(await screen.findByText('Not connected on this Mac.')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Connect desktop GitHub'})).toBeEnabled();
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('does not claim sign-in succeeded after native rejection',async()=>{
 install({inspect:vi.fn().mockResolvedValue({ok:true,data:{configured:false}}),connect:vi.fn().mockResolvedValue({ok:false,error:{message:'Authorization expired'}})});
 render(<DesktopGitHubSettings/>);await screen.findByText('Not connected on this Mac.');
 await userEvent.click(screen.getByRole('button',{name:'Connect desktop GitHub'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Authorization expired');
 expect(screen.queryByText('GitHub credentials saved on this Mac.')).not.toBeInTheDocument();
});
it('confirms saved credentials from native state and displays repository failures honestly',async()=>{
 const inspect=vi.fn().mockResolvedValueOnce({ok:true,data:{configured:false}}).mockResolvedValue({ok:true,data:{configured:true}});
 install({inspect,connect:vi.fn().mockResolvedValue({ok:true}),repositories:vi.fn().mockResolvedValue({ok:false,error:{message:'GitHub rate limit'}})});
 render(<DesktopGitHubSettings/>);await screen.findByText('Not connected on this Mac.');
 await userEvent.click(screen.getByRole('button',{name:'Connect desktop GitHub'}));
 await screen.findByText('GitHub credentials saved on this Mac.');
 await userEvent.click(screen.getByRole('button',{name:'List authorized repositories'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('GitHub rate limit');
 expect(screen.queryByText(/No repositories are available/)).not.toBeInTheDocument();
 expect(inspect).toHaveBeenCalledTimes(2);
});
