import {realpath,readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';

const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.jpg':'image/jpeg','.webp':'image/webp'};
export const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export async function assetResponse(root:string,url:string,method='GET'):Promise<Response>{
 const target=new URL(url);
 if(target.protocol!=='orchestra:'||target.host!=='app'||!['GET','HEAD'].includes(method))return new Response(null,{status:403});
 let path:string;try{path=decodeURIComponent(target.pathname);}catch{return new Response(null,{status:400});}
 if(path.startsWith('/v1/'))return Response.json({error:{code:'desktop_bridge_required',message:'Desktop onboarding and API integration are pending Step 4.'}},{status:503});
 if(path.includes('\\')||path.split('/').includes('..')||path.includes('\0'))return new Response(null,{status:403});
 const directory=await realpath(root);
 const requested=resolve(directory,'.'+path);
 if(!requested.startsWith(directory+sep))return new Response(null,{status:403});
 let file:string;
 try{file=await realpath(requested);}catch{
  if(extname(path))return new Response(null,{status:404});
  file=await realpath(resolve(directory,'index.html'));
 }
 if(!file.startsWith(directory+sep)||!mime[extname(file)])return new Response(null,{status:403});
 const bytes=method==='HEAD'?null:new Uint8Array(await readFile(file));
 return new Response(bytes,{headers:{'Content-Type':mime[extname(file)]!,'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff'}});
}
