import {act,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Link,MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DesktopOnboardingPage} from './DesktopOnboardingPage';
const {bootstrap,auth}=vi.hoisted(()=>({bootstrap:vi.fn(),auth:{status:'authenticated',activeProject:null as {id:string}|null}}));
vi.mock('../context/AuthContext',()=>({useAuth:()=>auth}));
vi.mock('../lib/desktop',()=>({desktopBootstrap:bootstrap}));
beforeEach(()=>{bootstrap.mockReset().mockResolvedValue({onboarded:false});auth.status='authenticated';auth.activeProject=null;window.orchestra={shared:{list:vi.fn().mockResolvedValue({ok:true,data:[]}),connect:vi.fn(),open:vi.fn(),remove:vi.fn()},status:vi.fn(),bootstrap:vi.fn(),completeOnboarding:vi.fn().mockResolvedValue({ok:true,data:{}})};});
afterEach(()=>{delete window.orchestra;});
function show(entry='/'){return render(<MemoryRouter initialEntries={[entry]}><Link to="/onboarding">Open privacy settings</Link><Routes><Route path="/" element={<DesktopOnboardingPage/>}/><Route path="/login" element={<DesktopOnboardingPage/>}/><Route path="/onboarding" element={<DesktopOnboardingPage/>}/><Route path="/memory" element={<p>Saved workspace memory</p>}/><Route path="/workspaces" element={<p>Local workspace picker</p>}/></Routes></MemoryRouter>);}
it('requires privacy acknowledgement and saves onboarding before advancing',async()=>{
 show();expect(await screen.findByRole('button',{name:'Continue locally'})).toBeDisabled();await userEvent.click(screen.getByRole('checkbox'));await userEvent.click(screen.getByRole('button',{name:'Continue locally'}));expect(window.orchestra!.completeOnboarding).toHaveBeenCalledOnce();expect(await screen.findByText('Local workspace picker')).toBeInTheDocument();
});
it('shows a durable-save failure without navigating and keeps shared setup separate',async()=>{
 vi.mocked(window.orchestra!.completeOnboarding).mockResolvedValue({ok:false,error:{code:'disk_full',message:'Setup could not be saved'}});show();expect(await screen.findByRole('button',{name:'Connect team server'})).toBeInTheDocument();await userEvent.click(screen.getByRole('checkbox'));await userEvent.click(screen.getByRole('button',{name:'Continue locally'}));expect(await screen.findByRole('alert')).toHaveTextContent('Setup could not be saved');expect(screen.queryByText('Local workspace picker')).not.toBeInTheDocument();
});
it('does not render first-run privacy while a returning installation is checked',async()=>{
 let resolve!:(value:{onboarded:boolean})=>void;bootstrap.mockReturnValue(new Promise(done=>{resolve=done;}));auth.activeProject={id:'saved-project'};
 show();expect(screen.getByRole('status')).toHaveTextContent('Checking saved setup');expect(screen.queryByText('Your product brain, locally')).not.toBeInTheDocument();expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Connect team server'})).not.toBeInTheDocument();
 await act(async()=>resolve({onboarded:true}));expect(await screen.findByText('Saved workspace memory')).toBeInTheDocument();expect(window.orchestra!.completeOnboarding).not.toHaveBeenCalled();
});
it('opens workspace selection for a returning installation without an active project',async()=>{
 bootstrap.mockResolvedValue({onboarded:true});show();expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(await screen.findByText('Local workspace picker')).toBeInTheDocument();
});
it('keeps explicit privacy settings available without a startup redirect check',()=>{
 bootstrap.mockResolvedValue({onboarded:true});auth.activeProject={id:'saved-project'};show('/onboarding');expect(screen.getByText('Your product brain, locally')).toBeInTheDocument();expect(screen.getByRole('checkbox')).toBeInTheDocument();expect(bootstrap).not.toHaveBeenCalled();
});
it('shows startup failure and retries the authoritative check before displaying initial setup',async()=>{
 bootstrap.mockRejectedValueOnce(new Error('Local runtime unavailable')).mockResolvedValue({onboarded:false});show();expect(await screen.findByRole('alert')).toHaveTextContent('Local runtime unavailable');expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Continue locally'})).not.toBeInTheDocument();
 await userEvent.click(screen.getByRole('button',{name:'Retry startup'}));expect(await screen.findByRole('checkbox')).toBeInTheDocument();expect(bootstrap).toHaveBeenCalledTimes(2);expect(window.orchestra!.completeOnboarding).not.toHaveBeenCalled();
});
it('does not treat an incomplete saved setup response as first run',async()=>{
 bootstrap.mockResolvedValue({});show();expect(await screen.findByRole('alert')).toHaveTextContent('Saved setup status could not be confirmed');expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Retry startup'})).toBeEnabled();
});
it('ignores a late implicit startup result after opening explicit privacy settings',async()=>{
 let resolve!:(value:{onboarded:boolean})=>void;bootstrap.mockReturnValue(new Promise(done=>{resolve=done;}));auth.activeProject={id:'saved-project'};show();await userEvent.click(screen.getByRole('link',{name:'Open privacy settings'}));expect(screen.getByRole('checkbox')).toBeInTheDocument();await act(async()=>resolve({onboarded:true}));expect(screen.getByText('Your product brain, locally')).toBeInTheDocument();expect(screen.queryByText('Saved workspace memory')).not.toBeInTheDocument();
});
