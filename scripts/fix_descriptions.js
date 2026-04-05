const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const TOKEN_PATH = path.join(__dirname, '..', 'tokens', 'orryy_token.json');
const CREDENTIALS_PATH = path.join(__dirname, '..', 'tokens', 'youtube_credentials.json');

async function getAuthClient() {
  const credentials = await fs.readJson(CREDENTIALS_PATH);
  const inst = credentials.installed || credentials.web || {};
  const oauth2Client = new google.auth.OAuth2(
    inst.client_id,
    inst.client_secret,
    inst.redirect_uris?.[0] || 'http://localhost'
  );
  const token = await fs.readJson(TOKEN_PATH);
  oauth2Client.setCredentials(token);

  if (token.expiry_date && Date.now() > token.expiry_date - 60000) {
    console.log('Refreshing expired token...');
    const { credentials: newToken } = await oauth2Client.refreshAccessToken();
    await fs.writeJson(TOKEN_PATH, newToken, { spaces: 2 });
    oauth2Client.setCredentials(newToken);
  }

  return oauth2Client;
}

async function main() {
  const command = process.argv[2] || 'list';

  const auth = await getAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });

  if (command === 'check') {
    // Check which channel we're authenticated as
    const res = await youtube.channels.list({
      part: 'snippet,contentDetails,statistics',
      mine: true,
    });
    const ch = res.data.items[0];
    console.log('Authenticated as:');
    console.log(`  Channel: ${ch.snippet.title}`);
    console.log(`  ID: ${ch.id}`);
    console.log(`  Subscribers: ${ch.statistics.subscriberCount}`);
    console.log(`  Videos: ${ch.statistics.videoCount}`);
    console.log(`  Uploads playlist: ${ch.contentDetails.relatedPlaylists.uploads}`);
    return;
  }

  if (command === 'list') {
    // List all videos with their descriptions
    const channelRes = await youtube.channels.list({
      part: 'contentDetails',
      mine: true,
    });
    const uploadsPlaylist = channelRes.data.items[0].contentDetails.relatedPlaylists.uploads;

    let allVideos = [];
    let nextPageToken = null;

    do {
      const playlistRes = await youtube.playlistItems.list({
        part: 'snippet',
        playlistId: uploadsPlaylist,
        maxResults: 50,
        pageToken: nextPageToken,
      });
      allVideos = allVideos.concat(playlistRes.data.items);
      nextPageToken = playlistRes.data.nextPageToken;
    } while (nextPageToken);

    console.log(`Found ${allVideos.length} videos:\n`);

    // Save to file for review
    const videoData = allVideos.map((item, i) => ({
      index: i + 1,
      videoId: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      publishedAt: item.snippet.publishedAt,
      description: item.snippet.description,
    }));

    await fs.writeJson(
      path.join(__dirname, '..', 'output', 'all_videos.json'),
      videoData,
      { spaces: 2 }
    );

    for (const v of videoData) {
      const hasArtistCredits = v.description.includes('Support ') && v.description.includes('💙');
      const hasLyrics = v.description.includes('🎤 LYRICS');
      const hasOrryySocials = v.description.includes('Follow Orryy');
      const hasSubmissions = v.description.includes('SUBMISSIONS');
      const hasDividers = v.description.includes('▪️◽◼️◽▪️');

      console.log(`${v.index}. ${v.title}`);
      console.log(`   ID: ${v.videoId}`);
      console.log(`   Artist Credits: ${hasArtistCredits ? '✓' : '✗ MISSING'}`);
      console.log(`   Lyrics: ${hasLyrics ? '✓' : '✗ MISSING'}`);
      console.log(`   Orryy Socials: ${hasOrryySocials ? '✓' : '✗ MISSING'}`);
      console.log(`   Submissions: ${hasSubmissions ? '✓' : '✗ MISSING'}`);
      console.log(`   Dividers: ${hasDividers ? '✓' : '✗ MISSING'}`);
      console.log();
    }

    console.log(`\nFull data saved to output/all_videos.json`);
    return;
  }

  if (command === 'get') {
    // Get full description for a specific video
    const videoId = process.argv[3];
    if (!videoId) {
      console.error('Usage: node fix_descriptions.js get <videoId>');
      return;
    }
    const res = await youtube.videos.list({
      part: 'snippet',
      id: videoId,
    });
    const video = res.data.items[0];
    console.log(`Title: ${video.snippet.title}`);
    console.log(`\n--- DESCRIPTION ---\n`);
    console.log(video.snippet.description);
    console.log(`\n--- END ---`);
    return;
  }

  if (command === 'update') {
    // Update a video's description
    const videoId = process.argv[3];
    const descFile = process.argv[4];
    if (!videoId || !descFile) {
      console.error('Usage: node fix_descriptions.js update <videoId> <description_file.txt>');
      return;
    }

    // First get current video data (need categoryId)
    const current = await youtube.videos.list({
      part: 'snippet',
      id: videoId,
    });
    const video = current.data.items[0];
    const newDescription = await fs.readFile(descFile, 'utf-8');

    console.log(`Updating: ${video.snippet.title}`);
    console.log(`Video ID: ${videoId}`);

    await youtube.videos.update({
      part: 'snippet',
      requestBody: {
        id: videoId,
        snippet: {
          title: video.snippet.title,
          description: newDescription,
          categoryId: video.snippet.categoryId,
          tags: video.snippet.tags,
        },
      },
    });

    console.log('✓ Description updated successfully');
    return;
  }

  console.log('Commands: check, list, get <videoId>, update <videoId> <desc_file>');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
