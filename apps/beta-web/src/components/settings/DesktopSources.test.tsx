import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import DesktopSources from './DesktopSources';
vi.mock('../../context/AuthContext',()=>({useAuth:()=>({activeProject:{id:'synthetic-project'}})}));
afterEach(()=>{delete window.orchestra;});
function setup(upload:unknown={ok:true}){const chooseFolder=vi.fn().mockResolvedValue({ok:true,data:{files:[{selectionId:'selection',name:'docs/prd.md',size:10}],skipped:2}});const uploadEvidence=vi.fn().mockResolvedValue(upload);Object.assign(window,{orchestra:{chooseFolder,uploadEvidence}});return {chooseFolder,uploadEvidence};}
it('requires preview and explicit import before sending selected documents',async()=>{const {uploadEvidence}=setup();render(<DesktopSources/>);await userEvent.click(screen.getByRole('button',{name:'Choose document folder'}));expect(await screen.findByText('docs/prd.md')).toBeInTheDocument();expect(uploadEvidence).not.toHaveBeenCalled();await userEvent.click(screen.getByRole('button',{name:'Import 1 documents'}));expect(await screen.findByRole('status')).toHaveTextContent('1 documents saved to Memory');expect(uploadEvidence).toHaveBeenCalledWith('synthetic-project','selection');});
it('reports failure without claiming the document was saved',async()=>{setup({ok:false,error:{message:'Runtime unavailable'}});render(<DesktopSources/>);await userEvent.click(screen.getByRole('button',{name:'Choose document folder'}));await userEvent.click(await screen.findByRole('button',{name:'Import 1 documents'}));expect(await screen.findByRole('alert')).toHaveTextContent('0 documents saved');expect(screen.getByRole('alert')).toHaveTextContent('Runtime unavailable');});
