#!/usr/bin/env node
/**
 * Prints whether credentials loaded from youtube.env (no secrets printed).
 * Run: cd server && npm run youtube:check-env
 * (package.json passes: node --env-file=youtube.env ...)
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../youtube.env');

const id = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
const secret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
const refresh = process.env.YOUTUBE_REFRESH_TOKEN?.trim() ?? '';

console.log('Reading env from:', envPath);
console.log('');
console.log('GOOGLE_CLIENT_ID     ', id ? `set (${id.length} chars)` : 'EMPTY');
console.log('GOOGLE_CLIENT_SECRET ', secret ? `set (${secret.length} chars)` : 'EMPTY');
console.log('YOUTUBE_REFRESH_TOKEN', refresh ? `set (${refresh.length} chars)` : 'empty');
console.log('');

if (!id || !secret) {
  console.log('The Client secret is missing or not saved. In youtube.env put the value on one line, e.g.:');
  console.log('  GOOGLE_CLIENT_SECRET=GOCSPX-your_secret_here');
  console.log('No spaces around =. Save the file (⌘S).');
  console.log('');
  console.log('Where to copy from: Google Cloud → APIs & Services → Credentials →');
  console.log('OAuth 2.0 Client IDs → your Web client → Client secret.');
  console.log('If hidden, use Reset secret and paste the new value.');
  process.exit(1);
}

if (!refresh) {
  console.log('OK — next run: npm run youtube:token');
  process.exit(0);
}

console.log('OK — you can run: npm run youtube:test-upload');
process.exit(0);
