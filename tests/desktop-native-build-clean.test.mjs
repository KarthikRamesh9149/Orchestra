import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cleanConfiguredSource} from '../scripts/desktop/native-build-clean.mjs';

test('fresh source skips clean; configured source cleans and propagates failure', async () => {
  const directory = await mkdtemp(join(tmpdir(),'orchestra-native-clean-test-'));
  try {
    const calls = [];
    await cleanConfiguredSource(directory, async (...args) => calls.push(args));
    assert.equal(calls.length,0);
    await writeFile(join(directory,'Makefile'),'# synthetic');
    await cleanConfiguredSource(directory, async (...args) => calls.push(args));
    assert.deepEqual(calls,[['/usr/bin/make',['clean'],directory]]);
    await assert.rejects(cleanConfiguredSource(directory, async () => {throw new Error('clean failed');}), /clean failed/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
