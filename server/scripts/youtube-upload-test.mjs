#!/usr/bin/env node
/**
 * Resumable upload test: videos.insert + optional thumbnails.set.
 *
 * Required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
 * Required arg/env: VIDEO_PATH to an mp4 (or set VIDEO_PATH=...)
 *
 * Optional: TITLE, DESCRIPTION, TAGS (comma-separated), THUMBNAIL_PATH (jpg/png),
 * PRIVACY (public | unlisted | private, default unlisted),
 * PUBLISH_AT (RFC3339, e.g. 2026-05-01T15:00:00Z) — only when PRIVACY=private (scheduled publish)
 */
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { createYoutubeFromRefreshToken } from '../lib/youtubeClient.js';

const videoPath = process.env.VIDEO_PATH || process.argv[2];
if (!videoPath) {
  console.error(
    'Usage: VIDEO_PATH=/path/to/video.mp4 node scripts/youtube-upload-test.mjs\n' +
      '   or: node scripts/youtube-upload-test.mjs /path/to/video.mp4',
  );
  process.exit(1);
}

const title =
  process.env.TITLE || `TubePilot upload test ${new Date().toISOString()}`;
const description = process.env.DESCRIPTION || 'Uploaded by TubePilot youtube-upload-test script.';
const tags = (process.env.TAGS || 'tubepilot,test')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const privacy = (process.env.PRIVACY || 'unlisted').toLowerCase();
const publishAt = process.env.PUBLISH_AT || '';
const thumbPath = process.env.THUMBNAIL_PATH || '';

if (!['public', 'unlisted', 'private'].includes(privacy)) {
  console.error('PRIVACY must be public, unlisted, or private');
  process.exit(1);
}

const status = {
  privacyStatus: privacy,
  selfDeclaredMadeForKids: false,
};
if (publishAt) {
  if (privacy !== 'private') {
    console.error('PUBLISH_AT only applies when PRIVACY=private (YouTube schedules as private until publish time).');
    process.exit(1);
  }
  status.publishAt = publishAt;
}

async function main() {
  const youtube = createYoutubeFromRefreshToken();
  const filePath = resolve(videoPath);

  console.log('Uploading', filePath, '...');

  const insertRes = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId: '22',
      },
      status,
    },
    media: {
      body: createReadStream(filePath),
    },
  });

  const id = insertRes.data.id;
  console.log('Video ID:', id);
  console.log('URL:', `https://www.youtube.com/watch?v=${id}`);

  if (thumbPath) {
    const thumbFull = resolve(thumbPath);
    console.log('Setting thumbnail', thumbFull, '...');
    await youtube.thumbnails.set({
      videoId: id,
      media: {
        body: createReadStream(thumbFull),
      },
    });
    console.log('Thumbnail set.');
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err.response?.data || err.message || err);
  process.exit(1);
});
