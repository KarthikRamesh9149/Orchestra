// Runs inside the actual installed VS Code extension host. No model calls.
const vscode=require('vscode');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
exports.run=async()=>{
 const folder=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
 assert(folder&&path.basename(folder).startsWith('vscode-qualification-'));
 const input=JSON.parse(await fs.readFile(path.join(folder,'qualification.json'),'utf8'));
 const result={clientVersion:vscode.version,passed:[],tools:[]};
 try{
  const configuration=JSON.parse(await fs.readFile(path.join(folder,'.vscode','mcp.json'),'utf8'));
  const names=Object.keys(configuration.servers??{});assert.equal(names.length,1);assert(names[0].includes('orchestra'));
  // Invoke the installed client's own command, including its normal trust UI.
  // This disposable profile contains only the explicitly authorized server.
  const commands=await vscode.commands.getCommands(true);
  assert(commands.includes('workbench.mcp.startServer'),'Installed client has no MCP start command');
  let started=false;
  const deadline=Date.now()+150000;
  let read,write;
  while(Date.now()<deadline){
   if(vscode.workspace.isTrusted&&!started){started=true;void vscode.commands.executeCommand('workbench.mcp.startServer','*').catch(error=>{result.startError=String(error.message).slice(0,200);});}
   const tools=vscode.lm.tools;
   read=tools.find(t=>t.name.includes('orchestra')&&t.name.endsWith('get_context_pack'));
   write=tools.find(t=>t.name.includes('orchestra')&&t.name.endsWith('record_agent_run'));
   if(read&&write)break;
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  result.availableTools=vscode.lm.tools.map(t=>t.name);
  assert(read&&write,'Start the scoped Orchestra MCP server in VS Code to discover its tools');
  result.tools=[read.name,write.name];
  const pack=await vscode.lm.invokeTool(read.name,{input:{projectId:input.projectId,packId:input.packId}});
  assert(JSON.stringify(pack).includes(input.packId),'Exact context pack was not retrieved');
  result.passed.push('actual VS Code MCP client retrieved the exact paired pack');
  const recorded=await vscode.lm.invokeTool(write.name,{input:{projectId:input.projectId,contextPackId:input.packId,taskTitle:'Synthetic VS Code MCP qualification',taskType:'review',status:'completed',outputSummary:'Read-only client qualification retrieved the paired context pack. No implementation or truth approval.',testStatus:'not_run',limitations:['Transport qualification only. No AI generation, implementation or agent-run tests.']}});
  const serialized=JSON.stringify(recorded);assert(!serialized.includes('"isError":true'));assert(serialized.includes(input.packId),'Postflight lineage missing');
  result.passed.push('actual VS Code MCP client recorded read-only Postflight linked to that pack');
 }catch(error){result.failure=String(error.message).slice(0,300);throw error;}
 finally{await fs.writeFile(path.join(folder,'result.json'),JSON.stringify(result,null,2),{mode:0o600});}
};
