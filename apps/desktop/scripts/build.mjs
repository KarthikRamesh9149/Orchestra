import {build} from 'esbuild';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
await build({entryPoints:[resolve(root,'src/main.ts'),resolve(root,'src/preload.ts'),resolve(root,'src/shared-preload.ts')],outdir:resolve(root,'dist'),outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node24',format:'cjs',external:['electron'],sourcemap:false});
