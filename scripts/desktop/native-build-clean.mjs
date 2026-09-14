import {access} from 'node:fs/promises';
import {join} from 'node:path';

// Fresh upstream archives have no generated Makefile. Existing configured
// trees must still clean successfully; do not swallow their build failures.
export async function cleanConfiguredSource(directory, run) {
  try {
    await access(join(directory, 'Makefile'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await run('/usr/bin/make', ['clean'], directory);
}
