// Synthetic, user-authorized product-demo content; no customer records.
import {createDesktopDemoDocuments} from './pdf-fixtures.mjs';
import {createWriteStream} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {finished} from 'node:stream/promises';
const output=resolve(process.argv[2]??'.desktop/demo-content');
await mkdir(output,{recursive:true});
for(const {filename,buffer} of await createDesktopDemoDocuments()){
 const stream=createWriteStream(join(output,filename),{flags:'wx'});
 stream.end(buffer);await finished(stream);console.log(filename);
}
