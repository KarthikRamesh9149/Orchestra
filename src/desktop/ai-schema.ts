import {isDeepStrictEqual} from 'node:util';

type Schema=Record<string,unknown>;
const schemaMaps=new Set(['properties','$defs','$def','definitions']);
const schemaLists=new Set(['anyOf','oneOf','allOf','prefixItems']);
const schemaChildren=new Set(['items','additionalProperties','contains','not','if','then','else','propertyNames']);
function record(value:unknown):value is Schema{return !!value&&typeof value==='object'&&!Array.isArray(value);}

/** zodTextFormat can repeat its entire root in definitions. Remove only the
 * structurally identical named copy, retaining all other definitions and
 * retargeting local references to the equivalent root. No schema semantics,
 * literal data, or validation bounds are otherwise changed. */
export function compactDesktopWireSchema(input:Schema):Schema{
 const definitions=input.definitions;
 if(!record(definitions)||!record(definitions.orchestra_result))return input;
 const root=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='definitions'&&key!=='$schema'));
 if(!isDeepStrictEqual(definitions.orchestra_result,root))return input;
 let scoped=false,nodes=0;
 const prefix='#/definitions/orchestra_result';
 const visit=(schema:Schema,depth:number):Schema=>{
  if(depth>64||++nodes>10000)throw new Error('Structured schema exceeds supported complexity.');
  if('$id' in schema)scoped=true;
  return Object.fromEntries(Object.entries(schema).map(([key,value])=>{
   if(key==='$ref'&&typeof value==='string'&&(value===prefix||value.startsWith(`${prefix}/`)))return [key,`#${value.slice(prefix.length)}`];
   if(schemaMaps.has(key)&&record(value))return [key,Object.fromEntries(Object.entries(value).map(([name,child])=>[name,record(child)?visit(child,depth+1):child]))];
   if(schemaLists.has(key)&&Array.isArray(value))return [key,value.map(child=>record(child)?visit(child,depth+1):child)];
   if(schemaChildren.has(key)&&record(value))return [key,visit(value,depth+1)];
   return [key,value];
  }));
 };
 const result=visit(input,0);
 // A nested $id changes reference scope. Such schemas are deliberately left
 // alone rather than assuming a local pointer has the same meaning everywhere.
 if(scoped)return input;
 const remaining={...(result.definitions as Schema)};
 delete remaining.orchestra_result;
 if(Object.keys(remaining).length)result.definitions=remaining;else delete result.definitions;
 return result;
}
