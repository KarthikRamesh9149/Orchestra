import fs from 'node:fs';
import ts from 'typescript';
// Explicitly reviewed domains. New route files do not gain native authority.
const domains=['projects/routes','projects/context.routes','projects/responsibilities.routes','documents/routes','socrates/routes','socrates/actions.routes','brain/routes','changes/routes','dashboard/routes','beta-timeline/beta-timeline.routes','project-ops/routes','suggestions/suggestions.routes','truth-inbox/truth-inbox.routes','delivery/routes','engineering-evidence/routes','fde-readiness/routes','deep-research/routes','live-doc/routes','me/me.routes','agent-context/routes','agent-files/routes','diagrams/routes','coding-requirements/routes'];
const routes=[];
const readOnlyDomains=['integrations/integrations.routes','communications/communications.routes'];
for(const domain of [...domains,...readOnlyDomains]){const source=`src/modules/${domain}.ts`,text=fs.readFileSync(source,'utf8'),ast=ts.createSourceFile(source,text,ts.ScriptTarget.Latest,true);function visit(node){
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(ast)==='app'&&['get','post','patch','put','delete'].includes(node.expression.name.text)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
  const path='/v1'+node.arguments[0].text,method=node.expression.name.text.toUpperCase();
  // Shared administration and external-provider actions belong to Steps 5/6.
  const readOnly=readOnlyDomains.includes(domain);
  if(readOnly){if(method==='GET'&&!/oauth|callback|authorize|\/connect\b|\/sync\b/.test(path))routes.push({method,path,source});}
  else if((method==='GET'&&path.endsWith('/members'))||!/join-code|invite|client-share|gmail|oauth|connector|calendar|drive|github|\/members|\/sessions\/revoke|\/workspaces\/switch/.test(path))routes.push({method,path,source});
 }
 ts.forEachChild(node,visit);
}visit(ast);}
// Step 5 native import uses this existing authorized read contract. Do not
// automatically admit hosted installation, linking, OAuth or sync endpoints.
routes.push({method:'GET',path:'/v1/projects/:projectId/github/code-status',source:'src/modules/github/routes.ts'});
const result=JSON.stringify(routes.sort((a,b)=>(a.path+a.method).localeCompare(b.path+b.method)),null,2)+'\n';
const file='src/desktop/local-routes.json';if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==result)throw new Error('Local API inventory drift requires review');}else fs.writeFileSync(file,result);
console.log(`${routes.length} explicit local API routes`);
