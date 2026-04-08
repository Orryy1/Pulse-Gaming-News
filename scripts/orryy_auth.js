const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, '..', 'tokens', 'youtube_credentials.json');
const ORRYY_TOKEN_PATH = path.join(__dirname, '..', 'tokens', 'orryy_token.json');

async function main() {
  const command = process.argv[2];
  const credentials = await fs.readJson(CREDENTIALS_PATH);
  const inst = credentials.installed || credentials.web || {};

  const oauth2Client = new google.auth.OAuth2(
    inst.client_id,
    inst.client_secret,
    inst.redirect_uris?.[0] || 'http://localhost'
  );

  if (command === 'auth') {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/youtube.upload',
      ],
      prompt: 'consent',  // Force consent to ensure we get a refresh token
    });
    console.log('Visit this URL and sign in with your ORRYY Google account:\n');
    console.log(url);
    console.log('\nThen run: node scripts/orryy_auth.js token YOUR_CODE_HERE');
    return;
  }

  if (command === 'token') {
    const code = process.argv[3];
    if (!code) {
      console.error('Usage: node scripts/orryy_auth.js token YOUR_CODE');
      return;
    }
    const { tokens } = await oauth2Client.getToken(code);
    await fs.ensureDir(path.dirname(ORRYY_TOKEN_PATH));
    await fs.writeJson(ORRYY_TOKEN_PATH, tokens, { spaces: 2 });
    console.log('✓ Orryy token saved to tokens/orryy_token.json');

    // Verify
    oauth2Client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const res = await youtube.channels.list({ part: 'snippet', mine: true });
    console.log(`Authenticated as: ${res.data.items[0].snippet.title} (${res.data.items[0].id})`);
    return;
  }

  console.log('Usage:\n  node scripts/orryy_auth.js auth    - get auth URL\n  node scripts/orryy_auth.js token CODE - exchange code for token');
}

main().catch(err => {
  console.error('Error:', err.message);
});
