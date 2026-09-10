import {render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {it,expect,vi} from 'vitest';
import {TruthInboxPage} from './TruthInboxPage';
import {getTruthInbox} from '../lib/api/truthInbox';
vi.mock('../context/AuthContext',()=>({useAuth:()=>({activeProject:{id:'synthetic-project'}})}));
vi.mock('../lib/api/truthInbox',()=>({getTruthInbox:vi.fn().mockResolvedValue({items:[],members:[],summary:{active:0,critical:0,awaitingDecision:0,assignedToMe:0},countsByStatus:{},sourceStates:{},limitations:[],page:{hasMore:false},generatedAt:null}),actOnTruthInboxItem:vi.fn()}));
it('gives every filter an exact stable accessible name, not its option contents',async()=>{
 vi.mocked(getTruthInbox).mockResolvedValue({items:[],members:[],summary:{active:0,critical:0,awaitingDecision:0,assignedToMe:0},countsByStatus:{},sourceStates:{},limitations:[],page:{hasMore:false},generatedAt:null} as never);
 render(<MemoryRouter><TruthInboxPage/></MemoryRouter>);
 await screen.findByText(/Nothing currently matches/);
 for(const name of ['Category','Severity','Status','Source','Owner'])expect(screen.getByRole('combobox',{name})).toHaveAccessibleName(name);
});
