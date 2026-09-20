import {build} from 'esbuild';
import {resolve} from 'node:path';
import {writeEsbuildNotices} from '../../../scripts/desktop/build-notices.mjs';
const root=resolve(import.meta.dirname,'..');
const result=await build({entryPoints:[resolve(root,'src/main.ts'),resolve(root,'src/preload.ts'),resolve(root,'src/shared-preload.ts')],outdir:resolve(root,'dist'),outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node24',format:'cjs',external:['electron'],sourcemap:false,metafile:true});
await writeEsbuildNotices(result.metafile,{root:resolve(root,'../..'),cwd:process.cwd(),outdir:resolve(root,'dist')});
