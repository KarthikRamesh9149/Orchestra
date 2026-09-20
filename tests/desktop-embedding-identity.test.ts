import {describe,it,expect,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {ensureDesktopEmbeddingIdentity} from '../src/desktop/embedding-identity.js';

function database(saved:unknown[],populated=false){
  const execute=vi.fn().mockResolvedValue(1);
  const tx={$executeRaw:execute,$queryRaw:vi.fn().mockResolvedValueOnce(saved).mockResolvedValueOnce([{present:populated}])};
  return {execute,db:{$transaction:(fn:(tx:unknown)=>unknown)=>fn(tx)} as unknown as PrismaClient};
}
describe('desktop semantic index identity',()=>{
  const custom={provider:'openai-compatible',model:'vendor/embedding',dimensions:1536 as const,endpoint:'https://models.example/v1'};
  it('keeps legacy native OpenAI indexes compatible',async()=>{
    const {db}=database([{data:{provider:'openai',model:'text-embedding-3-small',dimensions:1536}}]);
    await expect(ensureDesktopEmbeddingIdentity(db)).resolves.toBeUndefined();
  });
  it('records the endpoint as part of custom embedding identity',async()=>{
    const {db,execute}=database([]);
    await ensureDesktopEmbeddingIdentity(db,custom);
    expect(execute.mock.calls.at(-1)?.slice(1)).toContain(JSON.stringify(custom));
  });
  it.each([
    {...custom,endpoint:'https://different.example/v1'},
    {...custom,model:'different-model'},
    {...custom,provider:'openai'},
    {...custom,dimensions:3072}
  ])('rejects a changed vector identity without overwriting it',async previous=>{
    const {db,execute}=database([{data:previous}]);
    await expect(ensureDesktopEmbeddingIdentity(db,custom)).rejects.toMatchObject({code:'embedding_reindex_required'});
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('does not stamp unknown existing vectors with a new identity',async()=>{
    const {db}=database([],true);
    await expect(ensureDesktopEmbeddingIdentity(db,custom)).rejects.toMatchObject({code:'embedding_reindex_required'});
  });
});
