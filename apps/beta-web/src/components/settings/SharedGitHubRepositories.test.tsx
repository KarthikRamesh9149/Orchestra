import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import {apiJson} from '../../lib/api/client';
import SharedGitHubRepositories from './SharedGitHubRepositories';
vi.mock('../../lib/api/client',()=>({apiJson:vi.fn()}));
const repo={githubRepositoryId:'12',owner:'example',name:'test',fullName:'example/test'};
it('loads only on request and links an explicit selection before reporting success',async()=>{
 const api=vi.mocked(apiJson),changed=vi.fn();
 api.mockResolvedValueOnce([{id:'install',status:'active'}]).mockResolvedValueOnce([repo]).mockResolvedValueOnce({id:'link'}).mockResolvedValueOnce({linkedRepositories:[{id:'link',status:'active',repository:repo}]});
 render(<SharedGitHubRepositories projectId="project" onChanged={changed}/>);
 expect(api).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole('button',{name:'Choose GitHub repository'}));
 await userEvent.selectOptions(await screen.findByLabelText('Authorized GitHub repository'),'install:12');
 await userEvent.click(screen.getByRole('button',{name:'Link selected repository'}));
 expect(await screen.findByRole('status')).toHaveTextContent('example/test linked');
 expect(api).toHaveBeenNthCalledWith(3,'/v1/projects/project/github/repositories/link',expect.objectContaining({method:'POST',body:JSON.stringify({installationId:'install',githubRepositoryId:'12',owner:'example',name:'test'})}));
 expect(changed).toHaveBeenCalledOnce();
});
it('shows denied listing rather than empty success',async()=>{
 vi.mocked(apiJson).mockRejectedValueOnce(new Error('Forbidden'));
 render(<SharedGitHubRepositories projectId="project" onChanged={vi.fn()}/>);
 await userEvent.click(screen.getByRole('button',{name:'Choose GitHub repository'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
});
it('does not claim a saved link when authoritative reload fails',async()=>{
 const api=vi.mocked(apiJson),changed=vi.fn();
 api.mockResolvedValueOnce([{id:'install',status:'active'}]).mockResolvedValueOnce([repo]).mockResolvedValueOnce({id:'link'}).mockRejectedValueOnce(new Error('Reload failed'));
 render(<SharedGitHubRepositories projectId="project" onChanged={changed}/>);
 await userEvent.click(screen.getByRole('button',{name:'Choose GitHub repository'}));
 await userEvent.selectOptions(await screen.findByLabelText('Authorized GitHub repository'),'install:12');
 await userEvent.click(screen.getByRole('button',{name:'Link selected repository'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Reload failed');expect(changed).not.toHaveBeenCalled();
});
