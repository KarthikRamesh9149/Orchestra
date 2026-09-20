import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import DesktopAiSettings from './DesktopAiSettings';
const preferences={provider:'openai' as const,generationModel:'gpt-5.4-mini',embeddingProvider:'none' as const,embeddingModel:'text-embedding-3-small',embeddingDimensions:1536 as const,maxRequestsPerDay:50,maxOutputTokens:2048};
beforeEach(()=>{window.orchestra={status:vi.fn(),bootstrap:vi.fn(),completeOnboarding:vi.fn(),ai:{inspect:vi.fn().mockResolvedValue({ok:true,data:{configured:false,preferences:null,semanticSearchAvailable:false,semanticSearchReason:'not_configured'}}),importKey:vi.fn().mockResolvedValue({ok:true,data:{imported:true}}),test:vi.fn().mockResolvedValue({ok:true,data:{tested:true}}),discardDraft:vi.fn().mockResolvedValue({ok:true,data:{discarded:true}}),configure:vi.fn().mockResolvedValue({ok:true,data:{cancelled:true}}),revoke:vi.fn().mockResolvedValue({ok:true,data:{cancelled:true}})}};});
afterEach(()=>{delete window.orchestra;delete window.orchestraShared;});
async function load(){render(<DesktopAiSettings/>);await screen.findByText('Offline evidence search is available. No AI key is saved.');}
it('offers select provider and explicit secure add key, test, then save controls',async()=>{
 await load();expect(screen.getByLabelText('Select provider')).toHaveValue('openai');
 expect(document.querySelector('input[type=password]')).toBeNull();
 const model=screen.getByLabelText('Generation model') as HTMLInputElement;
 const pattern=new RegExp(`^(?:${model.pattern})$`,'v');expect(pattern.test('vendor/model+revision')).toBe(true);expect(pattern.test('model with spaces')).toBe(false);
 expect(screen.getByRole('button',{name:'Test connection'})).toBeDisabled();expect(screen.getByRole('button',{name:'Save and restart'})).toBeDisabled();
 await userEvent.click(screen.getByRole('button',{name:'Add API key'}));
 expect(window.orchestra!.ai!.importKey).toHaveBeenCalledWith({target:'generation',preferences});
 expect(window.orchestra!.ai!.test).not.toHaveBeenCalled();expect(window.orchestra!.ai!.configure).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole('button',{name:'Test connection'}));
 expect(window.orchestra!.ai!.test).toHaveBeenCalledWith(preferences);
 await userEvent.click(screen.getByRole('button',{name:'Save and restart'}));expect(window.orchestra!.ai!.configure).toHaveBeenCalledWith(preferences);
 expect(await screen.findByText('Cancelled. Saved AI settings are unchanged.')).toBeInTheDocument();
 expect(screen.queryByText('OpenAI key saved on this Mac.')).not.toBeInTheDocument();
});
it('supports custom public HTTPS destinations and model IDs without credential renderer fields',async()=>{
 await load();await userEvent.selectOptions(screen.getByLabelText('Select provider'),'openai-compatible');
 await userEvent.type(screen.getByLabelText('API base URL'),'https://api.example.com/v1');
 // Import comes before choosing a model. Native import validates the destination only.
 await userEvent.click(screen.getByRole('button',{name:'Add API key'}));
 await userEvent.type(screen.getByLabelText('Generation model'),'vendor/model+revision');
 expect(screen.getByText(/Generation destination:/)).toHaveTextContent('https://api.example.com/v1/chat/completions');
 await userEvent.click(screen.getByRole('button',{name:'Test connection'}));
 expect(window.orchestra!.ai!.test).toHaveBeenCalledWith(expect.objectContaining({provider:'openai-compatible',baseUrl:'https://api.example.com/v1',generationModel:'vendor/model+revision',embeddingProvider:'none'}));
});
it('keeps same-provider saved keys when changing a model and requires a new successful test',async()=>{
 window.orchestra!.ai!.inspect=vi.fn().mockResolvedValue({ok:true,data:{configured:true,preferences}});
 render(<DesktopAiSettings/>);await screen.findByText('OpenAI key saved on this Mac.');
 await userEvent.click(screen.getByRole('button',{name:'Test connection'}));
 expect(screen.getByRole('button',{name:'Save and restart'})).toBeEnabled();
 await userEvent.type(screen.getByLabelText('Generation model'),'-new');
 expect(screen.getByRole('button',{name:'Save and restart'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Test connection'})).toBeEnabled();
 expect(window.orchestra!.ai!.importKey).not.toHaveBeenCalled();
});
it('discards pending keys and disables save when provider changes',async()=>{
 await load();await userEvent.click(screen.getByRole('button',{name:'Add API key'}));await userEvent.click(screen.getByRole('button',{name:'Test connection'}));
 await userEvent.selectOptions(screen.getByLabelText('Select provider'),'anthropic');
 expect(window.orchestra!.ai!.discardDraft).toHaveBeenCalled();expect(screen.getByRole('button',{name:'Save and restart'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Test connection'})).toBeDisabled();expect(screen.getByRole('button',{name:'Add API key'})).toBeEnabled();
 expect(screen.getByText(/Generation destination:/)).toHaveTextContent('https://api.anthropic.com/v1/messages');
});
it('requires a separate optional embedding key without clearing the generation key',async()=>{
 await load();await userEvent.selectOptions(screen.getByLabelText('Select provider'),'anthropic');
 await userEvent.click(screen.getByRole('button',{name:'Add API key'}));await userEvent.type(screen.getByLabelText('Generation model'),'claude-test');
 await userEvent.selectOptions(screen.getByLabelText('Embeddings (optional)'),'openai');
 expect(screen.getByRole('button',{name:'Replace API key'})).toBeEnabled();
 expect(window.orchestra!.ai!.discardDraft).toHaveBeenLastCalledWith('embedding');
 expect(screen.getByRole('button',{name:'Test connection'})).toBeDisabled();
 await userEvent.click(screen.getByRole('button',{name:'Add embedding API key'}));
 expect(window.orchestra!.ai!.importKey).toHaveBeenLastCalledWith({target:'embedding',preferences:expect.objectContaining({provider:'anthropic',embeddingProvider:'openai'})});
 expect(screen.getByRole('button',{name:'Test connection'})).toBeEnabled();
});
it('displays failures and cancellation without a false tested or saved state',async()=>{
 window.orchestra!.ai!.importKey=vi.fn().mockResolvedValueOnce({ok:true,data:{cancelled:true}}).mockResolvedValue({ok:true,data:{imported:true}});
 await load();await userEvent.click(screen.getByRole('button',{name:'Add API key'}));expect(screen.getByRole('button',{name:'Test connection'})).toBeDisabled();
 await userEvent.click(screen.getByRole('button',{name:'Add API key'}));
 window.orchestra!.ai!.test=vi.fn().mockResolvedValue({ok:false,error:{code:'failed',message:'Model access failed'}});
 await userEvent.click(screen.getByRole('button',{name:'Test connection'}));expect(await screen.findByRole('alert')).toHaveTextContent('Model access failed');
 expect(screen.getByRole('button',{name:'Save and restart'})).toBeDisabled();
});
it('removes configured access only through native confirmation',async()=>{
 window.orchestra!.ai!.inspect=vi.fn().mockResolvedValue({ok:true,data:{configured:true,preferences:null}});render(<DesktopAiSettings/>);
 await userEvent.click(await screen.findByRole('button',{name:'Remove AI access'}));expect(window.orchestra!.ai!.revoke).toHaveBeenCalledOnce();
 expect(screen.getByText('OpenAI key saved on this Mac.')).toBeInTheDocument();
});
it('clearly separates shared server AI and never reads or writes local credentials',async()=>{
 window.orchestraShared={connection:{id:'shared',name:'Team',origin:'https://team.example',serverId:'server'},close:vi.fn(),copyText:vi.fn()};
 render(<DesktopAiSettings/>);expect(screen.getByRole('status')).toHaveTextContent('configured by your team server administrator');
 expect(screen.queryByRole('button',{name:'Add API key'})).not.toBeInTheDocument();
 expect(window.orchestra!.ai!.inspect).not.toHaveBeenCalled();expect(window.orchestra!.ai!.importKey).not.toHaveBeenCalled();
});
it('shows a truthful upgrade requirement if the native setup API is unavailable',async()=>{
 delete window.orchestra!.ai;render(<DesktopAiSettings/>);
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Update the desktop package'));
 expect(screen.getByRole('button',{name:'Add API key'})).toBeDisabled();
});
it('persistently shows the engine reindex requirement alongside a saved key and successful connection test',async()=>{
 window.orchestra!.ai!.inspect=vi.fn().mockResolvedValue({ok:true,data:{configured:true,preferences,semanticSearchAvailable:false,semanticSearchReason:'embedding_reindex_required'}});
 render(<DesktopAiSettings/>);await screen.findByText('OpenAI key saved on this Mac.');
 expect(screen.getByText(/Lexical-only search: embedding reindex required/)).toHaveTextContent('Semantic search remains disabled until a verified reindex is completed');
 await userEvent.click(screen.getByRole('button',{name:'Test connection'}));
 expect(screen.getByText(/Lexical-only search: embedding reindex required/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Save and restart'})).toBeEnabled();
 expect(screen.queryByText(/Semantic search is available with/)).not.toBeInTheDocument();
});
it('reports lexical-only and available search from the engine without inferring them from credentials',async()=>{
 await load();expect(screen.getByText(/Lexical-only search: embeddings are not configured/)).toBeInTheDocument();
});
it('shows semantic readiness only when the local engine confirms it',async()=>{
 window.orchestra!.ai!.inspect=vi.fn().mockResolvedValue({ok:true,data:{configured:true,preferences,semanticSearchAvailable:true,semanticSearchReason:null}});
 render(<DesktopAiSettings/>);expect(await screen.findByText(/Semantic search is available with the current embedding identity/)).toBeInTheDocument();
});
it('shows unavailable runtime capability even when a key is saved',async()=>{
 window.orchestra!.ai!.inspect=vi.fn().mockResolvedValue({ok:true,data:{configured:true,preferences,semanticSearchAvailable:null,semanticSearchReason:'runtime_unavailable'}});
 render(<DesktopAiSettings/>);await screen.findByText('OpenAI key saved on this Mac.');
 expect(screen.getByText(/Search capability status could not be confirmed/)).toHaveTextContent('A saved API key does not mean semantic search is available');
});
it('never reports an empty vault or enables configuration after an inspect failure',async()=>{
 window.orchestra!.ai!.inspect=vi.fn().mockResolvedValue({ok:false,error:{code:'credentials_unavailable',message:'OS-protected AI settings could not be read.'}});
 render(<DesktopAiSettings/>);expect(await screen.findByRole('alert')).toHaveTextContent('OS-protected AI settings could not be read.');
 expect(screen.getByText('AI key status could not be read. Saved settings have not been confirmed.')).toBeInTheDocument();
 expect(screen.queryByText('Offline evidence search is available. No AI key is saved.')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Add API key'})).toBeDisabled();expect(screen.getByRole('button',{name:'Test connection'})).toBeDisabled();expect(screen.getByRole('button',{name:'Save and restart'})).toBeDisabled();
 expect(window.orchestra!.ai!.importKey).not.toHaveBeenCalled();expect(window.orchestra!.ai!.configure).not.toHaveBeenCalled();
});
