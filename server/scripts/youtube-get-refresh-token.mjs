#!/usr/bin/env node
/**
 * One-time OAuth: opens a local callback URL and prints YOUTUBE_REFRESH_TOKEN.
 *
 * Prereqs in Google Cloud Console:
 * - Enable "YouTube Data API v3"
 * - OAuth consent screen (External or Internal) with scopes youtube.upload + youtube
 * - OAuth client type "Desktop app" OR Web with redirect http://127.0.0.1:34567/oauth2callback
 *
 * Load env: export $(cat youtube.env | xargs)   OR use direnv
 */
import http from 'node:http';
import { createOAuth2Client, getYoutubeAuthUrl } from '../lib/youtubeClient.js';

const PORT = Number(process.env.YOUTUBE_OAUTH_PORT || 34567);
const REDIRECT_PATH = '/oauth2callback';
const REDIRECT_URI = `http://127.0.0.1:${PORT}${REDIRECT_PATH}`;

function main() {
  const oauth2Client = createOAuth2Client(REDIRECT_URI);
  const authUrl = getYoutubeAuthUrl(oauth2Client);

  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith(REDIRECT_PATH)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const code = url.searchParams.get('code');
    const err = url.searchParams.get('error');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (err) {
      res.end(`<p>OAuth error: ${err}</p>`);
      server.close();
      process.exit(1);
      return;
    }
    if (!code) {
      res.end('<p>No code in callback.</p>');
      server.close();
      process.exit(1);
      return;
    }
    res.end(
      '<p>Authorized. You can close this tab and return to the terminal.</p>',
    );
    server.close();
    try {
      const { tokens } = await oauth2Client.getToken(code);
      if (tokens.refresh_token) {
        console.log('\n--- Add this to your env file (keep secret) ---\n');
        console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
      } else {
        console.log(
          '\nNo refresh_token returned. Try revoking app access in Google Account ' +
            '→ Security → Third-party access, then run this script again with prompt=consent (already set).\n',
        );
      }
      if (tokens.access_token) {
        console.log('Access token received (short-lived; use refresh token in apps).');
      }
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
    process.exit(0);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Listening on ${REDIRECT_URI}`);
    console.log('Add this exact redirect URI in Google Cloud → Credentials → your OAuth client.');
    console.log('\nOpen this URL in your browser:\n');
    console.log(authUrl);
    console.log('');
  });
}

main();
