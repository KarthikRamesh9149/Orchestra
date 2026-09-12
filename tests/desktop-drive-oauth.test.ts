import {describe,it,expect,vi} from 'vitest';
import {connectDrive,refreshDrive,revokeDrive,boundedGoogleBody,parseDriveClient,DRIVE_FILE_SCOPE,type DriveCredential} from '../apps/desktop/src/drive-oauth.js';
const credential:DriveCredential={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:1,fileIds:['synthetic-file'],scope:DRIVE_FILE_SCOPE};
describe('desktop Google credential boundary',()=>{
 it('accepts only a user-owned installed client configuration and sends its secret only to the token endpoint',async()=>{
  const client=parseDriveClient(JSON.stringify({installed:{client_id:'123-synthetic.apps.googleusercontent.com',client_secret:'synthetic-client-secret',token_uri:'https://attacker.invalid'}}));
  expect(client).toEqual({clientId:'123-synthetic.apps.googleusercontent.com',clientSecret:'synthetic-client-secret'});
  expect(()=>parseDriveClient(JSON.stringify({web:{client_id:client.clientId,client_secret:client.clientSecret}}))).toThrow();
  const request=vi.fn().mockResolvedValue(Response.json({access_token:'synthetic-access',expires_in:3600,token_type:'Bearer',scope:DRIVE_FILE_SCOPE}));
  await refreshDrive({...credential,client},request);
  expect(request.mock.calls[0]![0]).toBe('https://oauth2.googleapis.com/token');
  expect(request.mock.calls[0]![1].body.get('client_secret')).toBe(client.clientSecret);
 });
 it('distinguishes provider configuration errors without exposing provider descriptions',async()=>{
  const request=vi.fn().mockResolvedValue(Response.json({error:'invalid_client',error_description:'synthetic confidential diagnostic'},{status:401}));
  await expect(refreshDrive(credential,request)).rejects.toThrow('client configuration');
 });
 it('uses the external Picker, S256 and only selected-file scope without a shared secret',async()=>{
  const request=vi.fn().mockResolvedValue(Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'Bearer',scope:DRIVE_FILE_SCOPE}));
  const result=await connectDrive(async address=>{
   const url=new URL(address);expect(url.origin).toBe('https://accounts.google.com');expect(url.searchParams.get('scope')).toBe(DRIVE_FILE_SCOPE);expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('trigger_onepick')).toBe('true');expect(url.searchParams.get('include_granted_scopes')).toBe('false');
   const callback=new URL(url.searchParams.get('redirect_uri')!);callback.search=new URLSearchParams({state:url.searchParams.get('state')!,code:'synthetic-code',picked_file_ids:'synthetic-file'}).toString();
   expect((await fetch(callback)).status).toBe(200);
  },undefined,request);
  expect(result.fileIds).toEqual(['synthetic-file']);expect(request.mock.calls[0]![1].body.has('client_secret')).toBe(false);
 });
 it('refreshes only at the fixed Google endpoint and retains selected files',async()=>{
  const request=vi.fn().mockResolvedValue(Response.json({access_token:'synthetic-new-access',expires_in:3600,token_type:'Bearer',scope:DRIVE_FILE_SCOPE}));
  const refreshed=await refreshDrive(credential,request);expect(refreshed.fileIds).toEqual(credential.fileIds);expect(refreshed.refreshToken).toBe(credential.refreshToken);
  expect(request).toHaveBeenCalledWith('https://oauth2.googleapis.com/token',expect.objectContaining({method:'POST',redirect:'error'}));
  expect(request.mock.calls[0]![1].body.has('client_secret')).toBe(false);
 });
 it('rejects expanded scopes and preserves working credentials without a network request',async()=>{
  const request=vi.fn().mockResolvedValue(Response.json({access_token:'synthetic-new-access',expires_in:3600,token_type:'Bearer',scope:'https://www.googleapis.com/auth/drive'}));
  await expect(refreshDrive(credential,request)).rejects.toThrow('permissions');request.mockClear();
  await refreshDrive({...credential,expiresAt:Date.now()+120000},request);expect(request).not.toHaveBeenCalled();
 });
 it('does not treat revocation failure as success',async()=>{
  await expect(revokeDrive(credential,vi.fn().mockResolvedValue(new Response('failure',{status:503})))).rejects.toThrow('confirmed');
  await expect(revokeDrive(credential,vi.fn().mockResolvedValue(Response.json({error:'invalid_token'},{status:400})))).resolves.toBeUndefined();
 });
 it('bounds provider response sizes and fails honestly on inaccessible data',async()=>{
  await expect(boundedGoogleBody(new Response('too large'),3)).rejects.toThrow('limit');
  await expect(boundedGoogleBody(new Response('',{status:403}))).rejects.toThrow('rejected');
 });
});
