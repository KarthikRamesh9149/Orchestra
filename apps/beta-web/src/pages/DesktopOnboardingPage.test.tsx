import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DesktopOnboardingPage} from './DesktopOnboardingPage';
vi.mock('../context/AuthContext',()=>({useAuth:()=>({status:'authenticated',activeProject:null})}));
vi.mock('../lib/desktop',()=>({desktopBootstrap:async()=>({onboarded:false})}));
beforeEach(()=>{window.orchestra={status:vi.fn(),bootstrap:vi.fn(),completeOnboarding:vi.fn().mockResolvedValue({ok:true,data:{}})};});
afterEach(()=>{delete window.orchestra;});
function show(){render(<MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<DesktopOnboardingPage/>}/><Route path="/workspaces" element={<p>Local workspace picker</p>}/></Routes></MemoryRouter>);}
it('requires privacy acknowledgement and saves onboarding before advancing',async()=>{
 show();expect(screen.getByRole('button',{name:'Continue without AI'})).toBeDisabled();await userEvent.click(screen.getByRole('checkbox'));await userEvent.click(screen.getByRole('button',{name:'Continue without AI'}));expect(window.orchestra!.completeOnboarding).toHaveBeenCalledOnce();expect(await screen.findByText('Local workspace picker')).toBeInTheDocument();
});
it('shows a durable-save failure without navigating or advertising unavailable shared setup',async()=>{
 vi.mocked(window.orchestra!.completeOnboarding).mockResolvedValue({ok:false,error:{code:'disk_full',message:'Setup could not be saved'}});show();expect(screen.getByRole('button',{name:'Shared setup unavailable'})).toBeDisabled();await userEvent.click(screen.getByRole('checkbox'));await userEvent.click(screen.getByRole('button',{name:'Continue without AI'}));expect(await screen.findByRole('alert')).toHaveTextContent('Setup could not be saved');expect(screen.queryByText('Local workspace picker')).not.toBeInTheDocument();
});
