const fs = require('fs');
const path = require('path');

const tsgoJs = path.resolve(__dirname, '../node_modules/@typescript/native-preview/bin/tsgo.js');

const shim = `
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsc = resolve(__dirname, '../../../.bin/tsc');
execFileSync(tsc, process.argv.slice(2), { stdio: 'inherit' });
`;

fs.writeFileSync(tsgoJs, shim.trim());
console.log('[shim] tsgo.js -> tsc (SunOS fallback)');
