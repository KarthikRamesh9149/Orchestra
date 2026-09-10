#!/usr/bin/env node
// Build-only wrapper: upstream PGXS cannot parse whitespace in pg_config paths.
import {execFileSync} from 'node:child_process';
const value=execFileSync(process.env.ORCHESTRA_BUILD_PG_CONFIG,process.argv.slice(2),{encoding:'utf8'});
process.stdout.write(value.split(process.env.ORCHESTRA_BUILD_REAL_PREFIX).join(process.env.ORCHESTRA_BUILD_ALIAS_PREFIX));
