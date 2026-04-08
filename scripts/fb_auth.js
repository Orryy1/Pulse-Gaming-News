/*
  Facebook + Instagram Token Setup

  This script handles the full token flow for Facebook Reels and Instagram Reels/Stories.
  Both use the Facebook Graph API, so one token covers both platforms.

  Usage:
    node scripts/fb_auth.js exchange SHORT_LIVED_TOKEN   - exchange for 60-day token
    node scripts/fb_auth.js refresh                       - refresh existing token
    node scripts/fb_auth.js status                        - check token expiry
    node scripts/fb_auth.js pages                         - list pages + IG accounts

  How to get a short-lived token:
    1. Go to https://developers.facebook.com/tools/explorer/
    2. Select your app
    3. Click "Generate Access Token"
    4. Grant pages_manage_posts, pages_read_engagement, instagram_basic,
       instagram_content_publish, pages_show_list permissions
    5. Copy the token and run: node scripts/fb_auth.js exchange YOUR_TOKEN
*/

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const FB_TOKEN_PATH = path.join(
  __dirname,
  "..",
  "tokens",
  "facebook_token.json",
);
const IG_TOKEN_PATH = path.join(
  __dirname,
  "..",
  "tokens",
  "instagram_token.json",
);
const APP_ID = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;

async function exchangeForLongLived(shortToken) {
  if (!APP_ID || !APP_SECRET) {
    console.error("Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in .env first");
    process.exit(1);
  }

  console.log("Exchanging short-lived token for 60-day token...");

  // Step 1: Exchange user token for long-lived user token
  const response = await axios.get(
    "https://graph.facebook.com/v21.0/oauth/access_token",
    {
      params: {
        grant_type: "fb_exchange_token",
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: shortToken,
      },
    },
  );

  const longLivedUserToken = response.data.access_token;
  const expiresIn = response.data.expires_in || 5184000; // default 60 days
  console.log(
    `Long-lived user token acquired (expires in ${Math.round(expiresIn / 86400)} days)`,
  );

  // Step 2: Get page access token
  // Try /me/accounts first, then fall back to direct page ID query
  // (needed when page is in a different business portfolio than the app)
  const targetPageId = process.env.FACEBOOK_PAGE_ID;
  let page = null;

  const pagesRes = await axios.get(
    "https://graph.facebook.com/v21.0/me/accounts",
    {
      params: { access_token: longLivedUserToken },
    },
  );

  const pages = pagesRes.data.data || [];
  if (pages.length > 0) {
    console.log(`\nFound ${pages.length} page(s) via /me/accounts:`);
    pages.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (ID: ${p.id})`));
    page = targetPageId
      ? pages.find((p) => p.id === targetPageId) || pages[0]
      : pages[0];
  }

  // If target page not found in /me/accounts, query it directly by ID
  if (!page && targetPageId) {
    console.log(
      `\nPage not in /me/accounts, querying ${targetPageId} directly...`,
    );
    try {
      const directRes = await axios.get(
        `https://graph.facebook.com/v21.0/${targetPageId}`,
        {
          params: {
            fields: "id,name,access_token",
            access_token: longLivedUserToken,
          },
        },
      );
      page = directRes.data;
      console.log(`Found page via direct query: ${page.name} (${page.id})`);
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      console.error(`Direct page query failed: ${errMsg}`);
      process.exit(1);
    }
  }

  if (!page) {
    console.error(
      "No Facebook Pages found. Set FACEBOOK_PAGE_ID in .env or grant pages_manage_posts.",
    );
    process.exit(1);
  }

  const pageToken = page.access_token;
  console.log(`\nUsing page: ${page.name} (${page.id})`);

  // Save Facebook token
  const fbTokenData = {
    access_token: pageToken,
    page_id: page.id,
    page_name: page.name,
    expires_at: 0, // Page tokens from long-lived user tokens don't expire
    created_at: new Date().toISOString(),
    note: "Page token derived from long-lived user token. Does not expire unless user revokes access.",
  };

  await fs.ensureDir(path.dirname(FB_TOKEN_PATH));
  await fs.writeJson(FB_TOKEN_PATH, fbTokenData, { spaces: 2 });
  console.log(`Facebook token saved to ${FB_TOKEN_PATH}`);

  // Step 3: Get Instagram Business Account linked to this page
  try {
    const igRes = await axios.get(
      `https://graph.facebook.com/v21.0/${page.id}`,
      {
        params: {
          fields: "instagram_business_account",
          access_token: pageToken,
        },
      },
    );

    const igAccountId = igRes.data?.instagram_business_account?.id;
    if (igAccountId) {
      const igTokenData = {
        access_token: pageToken, // Same token works for IG Graph API
        instagram_business_account_id: igAccountId,
        expires_at: 0, // Inherits page token longevity
        created_at: new Date().toISOString(),
        note: "Uses Facebook Page token for Instagram Graph API. Does not expire.",
      };

      await fs.writeJson(IG_TOKEN_PATH, igTokenData, { spaces: 2 });
      console.log(`Instagram token saved to ${IG_TOKEN_PATH}`);
      console.log(`Instagram Business Account ID: ${igAccountId}`);
      console.log("\nUpdate .env on Railway:");
      console.log(`  FACEBOOK_PAGE_ID=${page.id}`);
      console.log(`  FACEBOOK_PAGE_TOKEN=${pageToken}`);
      console.log(`  INSTAGRAM_ACCESS_TOKEN=${pageToken}`);
      console.log(`  INSTAGRAM_BUSINESS_ACCOUNT_ID=${igAccountId}`);
    } else {
      console.log("\nNo Instagram Business account linked to this page.");
      console.log("Link one at: Facebook Page Settings > Instagram");
    }
  } catch (err) {
    console.log(`\nCould not fetch Instagram account: ${err.message}`);
  }

  console.log("\nDone. Token does not expire unless you revoke app access.");
}

async function checkStatus() {
  let found = false;

  for (const [name, tokenPath] of [
    ["Facebook", FB_TOKEN_PATH],
    ["Instagram", IG_TOKEN_PATH],
  ]) {
    if (await fs.pathExists(tokenPath)) {
      found = true;
      const data = await fs.readJson(tokenPath);
      console.log(`\n${name} (${tokenPath}):`);
      console.log(`  Created: ${data.created_at || "unknown"}`);

      if (data.expires_at === 0) {
        console.log("  Expires: Never (page token)");
      } else if (data.expires_at) {
        const expiry = new Date(data.expires_at);
        const daysLeft = Math.round((expiry - Date.now()) / 86400000);
        console.log(
          `  Expires: ${expiry.toISOString()} (${daysLeft > 0 ? daysLeft + " days left" : "EXPIRED"})`,
        );
      }

      // Test the token
      try {
        const res = await axios.get("https://graph.facebook.com/v21.0/me", {
          params: { access_token: data.access_token },
        });
        console.log(`  Status: VALID (${res.data.name || res.data.id})`);
      } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        console.log(`  Status: INVALID - ${msg}`);
      }
    }
  }

  if (!found) {
    console.log(
      "No token files found. Run: node scripts/fb_auth.js exchange YOUR_SHORT_TOKEN",
    );
  }
}

async function listPages() {
  let token;
  if (await fs.pathExists(FB_TOKEN_PATH)) {
    const data = await fs.readJson(FB_TOKEN_PATH);
    token = data.access_token;
  } else if (process.env.FACEBOOK_PAGE_TOKEN) {
    token = process.env.FACEBOOK_PAGE_TOKEN;
  } else {
    console.error("No token available. Exchange a token first.");
    process.exit(1);
  }

  const pagesRes = await axios.get(
    "https://graph.facebook.com/v21.0/me/accounts",
    {
      params: { access_token: token },
    },
  );

  const pages = pagesRes.data.data || [];
  for (const page of pages) {
    console.log(`\nPage: ${page.name} (ID: ${page.id})`);
    try {
      const igRes = await axios.get(
        `https://graph.facebook.com/v21.0/${page.id}`,
        {
          params: {
            fields: "instagram_business_account",
            access_token: page.access_token,
          },
        },
      );
      const igId = igRes.data?.instagram_business_account?.id;
      console.log(`  Instagram: ${igId || "Not linked"}`);
    } catch (err) {
      console.log(`  Instagram: Error - ${err.message}`);
    }
  }
}

async function setupDirect(userToken) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!pageId) {
    console.error(
      "Set FACEBOOK_PAGE_ID in .env first (use 1009371542267922 for Pulse Gaming)",
    );
    process.exit(1);
  }

  console.log(`Querying page ${pageId} directly with user token...`);

  // Get page token by querying the page directly
  const pageRes = await axios.get(
    `https://graph.facebook.com/v25.0/${pageId}`,
    {
      params: {
        fields: "id,name,access_token,instagram_business_account",
        access_token: userToken,
      },
    },
  );

  const page = pageRes.data;
  console.log(`Page: ${page.name} (${page.id})`);

  if (!page.access_token) {
    console.error(
      "No access_token returned. Token may lack pages_manage_posts permission.",
    );
    process.exit(1);
  }

  // Save Facebook token
  const fbTokenData = {
    access_token: page.access_token,
    page_id: page.id,
    page_name: page.name,
    expires_at: 0,
    created_at: new Date().toISOString(),
    note: "Page token from Graph API Explorer user token. Does not expire unless user revokes access.",
  };

  await fs.ensureDir(path.dirname(FB_TOKEN_PATH));
  await fs.writeJson(FB_TOKEN_PATH, fbTokenData, { spaces: 2 });
  console.log(`Facebook token saved to ${FB_TOKEN_PATH}`);

  // Get Instagram Business Account
  const igAccountId = page.instagram_business_account?.id;
  if (igAccountId) {
    const igTokenData = {
      access_token: page.access_token,
      instagram_business_account_id: igAccountId,
      expires_at: 0,
      created_at: new Date().toISOString(),
      note: "Uses Facebook Page token for Instagram Graph API.",
    };

    await fs.writeJson(IG_TOKEN_PATH, igTokenData, { spaces: 2 });
    console.log(`Instagram token saved to ${IG_TOKEN_PATH}`);
    console.log(`Instagram Business Account ID: ${igAccountId}`);
  } else {
    console.log("No Instagram Business account linked to this page.");
  }

  console.log("\nUpdate .env / Railway with:");
  console.log(`  FACEBOOK_PAGE_ID=${page.id}`);
  console.log(`  FACEBOOK_PAGE_TOKEN=${page.access_token}`);
  if (igAccountId) {
    console.log(`  INSTAGRAM_ACCESS_TOKEN=${page.access_token}`);
    console.log(`  INSTAGRAM_BUSINESS_ACCOUNT_ID=${igAccountId}`);
  }
  console.log("\nDone.");
}

async function main() {
  const command = process.argv[2];

  if (command === "setup") {
    const token = process.argv[3];
    if (!token) {
      console.error("Usage: node scripts/fb_auth.js setup YOUR_USER_TOKEN");
      console.error(
        "\nGet a user token from Graph API Explorer with these permissions:",
      );
      console.error(
        "  pages_manage_posts, pages_read_engagement, pages_show_list,",
      );
      console.error(
        "  instagram_basic, instagram_content_publish, publish_video",
      );
      process.exit(1);
    }
    await setupDirect(token);
  } else if (command === "exchange") {
    const shortToken = process.argv[3];
    if (!shortToken) {
      console.error(
        "Usage: node scripts/fb_auth.js exchange YOUR_SHORT_LIVED_TOKEN",
      );
      console.error(
        "\nGet a short-lived token from: https://developers.facebook.com/tools/explorer/",
      );
      process.exit(1);
    }
    await exchangeForLongLived(shortToken);
  } else if (command === "status") {
    await checkStatus();
  } else if (command === "pages") {
    await listPages();
  } else {
    console.log("Facebook + Instagram Token Setup\n");
    console.log("Usage:");
    console.log(
      "  node scripts/fb_auth.js exchange TOKEN  - exchange short-lived token for permanent page token",
    );
    console.log(
      "  node scripts/fb_auth.js status          - check current token status",
    );
    console.log(
      "  node scripts/fb_auth.js pages           - list pages + IG accounts",
    );
    console.log("\nTo get a short-lived token:");
    console.log("  1. Visit https://developers.facebook.com/tools/explorer/");
    console.log('  2. Select your app, click "Generate Access Token"');
    console.log("  3. Grant: pages_manage_posts, pages_read_engagement,");
    console.log(
      "     instagram_basic, instagram_content_publish, pages_show_list",
    );
    console.log(
      "  4. Copy token and run: node scripts/fb_auth.js exchange YOUR_TOKEN",
    );
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
