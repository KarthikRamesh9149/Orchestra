/** Separate ownership process: even SIGKILL of the engine closes its IPC pipe. */
import {spawn,type ChildProcess} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {z} from 'zod';
const config=z.object({executable:z.string().refine(isAbsolute),cluster:z.string().refine(isAbsolute),port:z.number().int().min(1024).max(65535)}).strict();
let child:ChildProcess|undefined,started=false,closing=false;
function close(){
 if(closing)return;closing=true;
 if(!child||child.exitCode!==null||child.signalCode!==null){process.exit(0);return;}
 const timer=setTimeout(()=>child?.kill('SIGKILL'),15000);
 child.once('exit',()=>{clearTimeout(timer);process.exit(0);});child.kill('SIGINT');
}
process.on('disconnect',close);process.on('SIGTERM',close);process.on('SIGINT',close);
process.on('message',message=>{
 if(started||closing)return;started=true;
 try{
  const value=config.parse(message);
  child=spawn(value.executable,['-D',value.cluster,'-h','127.0.0.1','-p',String(value.port),'-c','unix_socket_directories='],{env:{PATH:'',LANG:'C',LC_ALL:'C',TMPDIR:process.env.TMPDIR??''},stdio:'ignore'});
  child.once('error',()=>process.exit(1));
  child.once('exit',code=>{if(!closing)process.exit(code??1);});
 }catch{process.exit(1);}
});
