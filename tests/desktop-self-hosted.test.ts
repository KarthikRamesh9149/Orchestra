import {describe,it,expect} from 'vitest';
import {parseEnv} from '../src/config/env.js';
import {createGenerationProvider,createEmbeddingProvider,createTranscriptionProvider} from '../src/lib/ai/index.js';
import {z} from 'zod';
const base={RUNTIME_PROFILE:'self-hosted',NODE_ENV:'production',DEPLOYMENT_ENV:'production',DESKTOP_SHARED_SERVER_ID:'11111111-1111-4111-8111-111111111111',SELF_HOST_DATA_ROOT:'/var/lib/orchestra',APP_BASE_URL:'https://team.example.invalid',FRONTEND_BASE_URL:'https://team.example.invalid',CORS_ALLOWED_ORIGINS:'https://team.example.invalid',DATABASE_URL:'postgresql://runtime:synthetic@database/orchestra',REDIS_URL:'redis://redis:6379',QUEUE_MODE:'bullmq',SIGNUP_MODE:'disabled',STORAGE_DRIVER:'local',STORAGE_LOCAL_ROOT:'/var/lib/orchestra/files',CONNECTOR_CREDENTIAL_VAULT_MODE:'encrypted_file',JWT_ACCESS_SECRET:'a'.repeat(48),JWT_REFRESH_SECRET:'b'.repeat(48),CONNECTOR_OAUTH_STATE_SECRET:'c'.repeat(48),CONNECTOR_CREDENTIAL_ENCRYPTION_KEY:'d'.repeat(48),CLIENT_SHARE_TOKEN_SECRET:'e'.repeat(48),API_PROXY_SHARED_SECRET:'f'.repeat(48),METRICS_TOKEN:'g'.repeat(48)};
describe('explicit self-hosted production controls',()=>{
 it('defaults caching off and rejects unbounded operator cache settings',()=>{
  expect(parseEnv(base).DESKTOP_SHARED_CACHE_ENABLED).toBe(false);
  expect(parseEnv({...base,DESKTOP_SHARED_CACHE_ENABLED:'true'}).DESKTOP_SHARED_CACHE_ENABLED).toBe(true);
  for(const patch of [{DESKTOP_SHARED_CACHE_TTL_SECONDS:'0'},{DESKTOP_SHARED_CACHE_TTL_SECONDS:'86401'},{DESKTOP_SHARED_CACHE_MAX_BYTES:'52428801'}])expect(()=>parseEnv({...base,...patch})).toThrow();
 });
 it('runs without Railway, paid sinks or simulated AI, keeping production security',()=>{const env=parseEnv(base);expect(env.DEPLOYMENT_ENV).toBe('production');expect(env.AUTH_COOKIE_SECURE).toBe(true);expect(env.MVP_BETA_FREE_TIER_MODE).toBe(false);expect(env.QUEUE_MODE).toBe('bullmq');});
 it.each([{SELF_HOST_DATA_ROOT:''},{SELF_HOST_DATA_ROOT:'/'},{STORAGE_LOCAL_ROOT:'/tmp/ephemeral'},{DESKTOP_SHARED_SERVER_ID:''},{APP_BASE_URL:'http://team.example.invalid'},{SIGNUP_MODE:'open'},{QUEUE_MODE:'inline'},{MVP_BETA_FREE_TIER_MODE:'true'},{JWT_ACCESS_SECRET:'weak'},{CONNECTOR_CREDENTIAL_VAULT_MODE:'memory'}])('rejects unsafe self-hosted configuration %j',patch=>{expect(()=>parseEnv({...base,...patch})).toThrow();});
 it('does not enable these exceptions for managed production',()=>{expect(()=>parseEnv({...base,RUNTIME_PROFILE:'managed'})).toThrow();});
 it('never returns mock AI output when the self-hosted key is absent',async()=>{const env=parseEnv(base);await expect(createGenerationProvider(env).generateObject({schema:z.object({answer:z.string()}),fallback:()=>({answer:'fabricated'})} as any)).rejects.toMatchObject({code:'ai_not_configured'});expect((createEmbeddingProvider(env) as {unavailable?:boolean}).unavailable).toBe(true);await expect(createTranscriptionProvider(env).transcribeAudio({fileName:'test',contentType:'audio/wav',buffer:Buffer.from('not an audio file')})).rejects.toMatchObject({code:'transcription_not_configured'});});
});
