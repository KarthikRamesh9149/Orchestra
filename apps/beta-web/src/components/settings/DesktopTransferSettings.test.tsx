import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {it,expect,vi,afterEach} from 'vitest';
import DesktopTransferSettings from './DesktopTransferSettings';
vi.mock('../../context/AuthContext',()=>({useAuth:()=>({activeProject:{id:'target',name:'Target'}})}));
afterEach(()=>{delete (window as any).orchestra;});
it('requires explicit identity mapping and acknowledgement before import',async()=>{
 const commit=vi.fn().mockResolvedValue({ok:true,data:{projectId:'target'}});
 (window as any).orchestra={transfer:{preview:vi.fn().mockResolvedValue({ok:true,data:{previewId:'review',source:{name:'Source'},actors:[{id:'old',displayName:'Author'}],targetIdentities:[{id:'new',displayName:'Member'}],counts:{Document:1}}}),commit}};
 render(<DesktopTransferSettings/>);await userEvent.click(screen.getByText('Choose archive to review'));
 const button=await screen.findByRole('button',{name:'Import reviewed core'});expect(button).toBeDisabled();expect(commit).not.toHaveBeenCalled();
 await userEvent.selectOptions(screen.getByRole('combobox'), 'new');expect(button).toBeDisabled();await userEvent.click(screen.getByRole('checkbox'));await userEvent.click(button);
 expect(commit).toHaveBeenCalledWith({projectId:'target',previewId:'review',identityMap:{old:'new'},acknowledgeHistoricalTruth:true});expect(await screen.findByText(/Core import confirmed/)).toBeInTheDocument();
});
it('does not claim a cancelled export was saved',async()=>{
 (window as any).orchestra={transfer:{export:vi.fn().mockResolvedValue({ok:true,data:{cancelled:true}})}};render(<DesktopTransferSettings/>);
 await userEvent.click(screen.getByText('Export project core'));expect(screen.queryByText(/Encrypted archive saved/)).not.toBeInTheDocument();
});
