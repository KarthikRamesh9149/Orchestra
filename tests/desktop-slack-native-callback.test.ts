import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {SlackNativeCallback,SLACK_NATIVE_REDIRECT,slackNativeCallback} from '../apps/desktop/src/slack-native-callback.js';
import {connectSlack} from '../apps/desktop/src/slack-oauth.js';
describe('Slack native callback',()=>{
 it('accepts one exact state-bound callback and ignores unsolicited/replayed launches',async()=>{
  const broker=new SlackNativeCallback();expect(broker.accept(SLACK_NATIVE_REDIRECT)).toBe(false);
  const pending=broker.begin();const callback=`${SLACK_NATIVE_REDIRECT}?state=${pending.state}&code=synthetic-code`;
  expect(pending.challenge).toBe(createHash('sha256').update(pending.verifier).digest('base64url'));
  expect(()=>broker.begin()).toThrow('already pending');expect(broker.accept(callback)).toBe(true);
  await expect(pending.code).resolves.toBe('synthetic-code');expect(broker.accept(callback)).toBe(false);
 });
 it('rejects attacker routes, state, duplicates and credentials without consuming the valid request',async()=>{
  const broker=new SlackNativeCallback(),pending=broker.begin();
  const valid=`${SLACK_NATIVE_REDIRECT}?state=${pending.state}&code=synthetic-code`;
  for(const url of [valid.replace('oauth/','evil/'),valid.replace('/slack/','/drive/'),valid.replace('://','://user@'),valid+'#fragment',valid+'&state='+pending.state,valid+'&code=another',valid+'&error=denied',valid.replace(pending.state,'wrong'),'x'.repeat(4097)])expect(broker.accept(url)).toBe(false);
  expect(broker.accept(valid)).toBe(true);await pending.code;
 });
 it('cancels, expires, and declines without preserving a pending request',async()=>{
  const broker=new SlackNativeCallback(),abort=new AbortController(),pending=broker.begin(abort.signal);
  abort.abort();await expect(pending.code).rejects.toThrow('cancelled');
  const expired=broker.begin(undefined,1);await expect(expired.code).rejects.toThrow('expired');
  const denied=broker.begin();expect(broker.accept(`${SLACK_NATIVE_REDIRECT}?state=${denied.state}&error=access_denied`)).toBe(true);await expect(denied.code).rejects.toThrow('declined');
  const alreadyAborted=broker.begin(abort.signal);await expect(alreadyAborted.code).rejects.toThrow('cancelled');
 });
 it('exchanges native authorization with PKCE and verifies identity without a client secret',async()=>{
  let challenge='';let requests=0;
  const credential=await connectSlack(async raw=>{
   const url=new URL(raw);challenge=url.searchParams.get('code_challenge')!;
   expect(url.searchParams.get('redirect_uri')).toBe(SLACK_NATIVE_REDIRECT);expect(url.searchParams.get('code_challenge_method')).toBe('S256');
   expect(slackNativeCallback.accept(`${SLACK_NATIVE_REDIRECT}?state=${url.searchParams.get('state')}&code=synthetic-code`)).toBe(true);
  },undefined,async(raw,options)=>{
   requests++;
   if(String(raw).endsWith('oauth.v2.access')){
    const params=options!.body as URLSearchParams;expect(params.get('redirect_uri')).toBe(SLACK_NATIVE_REDIRECT);expect(params.has('client_secret')).toBe(false);
    expect(createHash('sha256').update(params.get('code_verifier')!).digest('base64url')).toBe(challenge);
    return new Response(JSON.stringify({ok:true,team:{id:'TTEST',name:'Synthetic'},authed_user:{id:'UTEST',token_type:'user',access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:43200,scope:'channels:read,channels:history'}}));
   }
   return new Response(JSON.stringify({ok:true,team_id:'TTEST',user_id:'UTEST'}));
  });expect(credential.teamId).toBe('TTEST');expect(requests).toBe(2);
 });
});
