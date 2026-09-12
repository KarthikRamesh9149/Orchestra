import {describe,it,expect} from 'vitest';
import {sharedConnectionSchema,assertSharedCompatibility,sharedCachePolicySchema} from '../src/desktop/shared-contract.js';
const id='11111111-1111-4111-8111-111111111111';
const manifest={product:'orchestra',protocol:1,minClientProtocol:1,maxClientProtocol:1,serverId:id,mode:'self-hosted',capabilities:['bearer-sessions-v1'],offlineCache:{enabled:false}};
describe('shared desktop trust contract',()=>{
 it('binds a connection to one canonical HTTPS origin',()=>expect(sharedConnectionSchema.parse({id,name:'Test server',origin:'https://EXAMPLE.invalid:443/'}).origin).toBe('https://example.invalid'));
 it.each(['http://example.invalid','https://user:password@example.invalid','https://example.invalid/api','https://example.invalid/?token=x','https://example.invalid/#x','file:///tmp/app','https://example.invalid/../api'])('rejects unsafe or ambiguous origins: %s',origin=>expect(sharedConnectionSchema.safeParse({id,name:'Test',origin}).success).toBe(false));
 it('rejects connection credentials in the public descriptor',()=>expect(sharedConnectionSchema.safeParse({id,name:'Test',origin:'https://example.invalid',accessToken:'secret'}).success).toBe(false));
 it('requires explicit compatible protocol and persistent server identity',()=>{
  expect(assertSharedCompatibility(manifest,id).serverId).toBe(id);
  for(const patch of [{protocol:2},{minClientProtocol:2},{maxClientProtocol:0},{mode:'desktop-local'},{capabilities:[]},{serverId:'22222222-2222-4222-8222-222222222222'}])expect(()=>assertSharedCompatibility({...manifest,...patch},id)).toThrow();
 });
 it('defaults to no offline cache and rejects unbounded or writable policy',()=>{
  expect(sharedCachePolicySchema.parse(undefined)).toEqual({enabled:false});
  for(const policy of [{enabled:true},{enabled:true,ttlSeconds:0,maxBytes:1024,readOnly:true},{enabled:true,ttlSeconds:300,maxBytes:1024,readOnly:false},{enabled:false,queueWrites:true}])expect(sharedCachePolicySchema.safeParse(policy).success).toBe(false);
  expect(sharedCachePolicySchema.parse({enabled:true,ttlSeconds:300,maxBytes:1048576,readOnly:true})).toMatchObject({readOnly:true});
 });
});
