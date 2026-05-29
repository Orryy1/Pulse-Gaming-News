"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  APPROVED_AFFILIATE_PROGRAMMES,
  buildAffiliateLinkManifest,
  buildCommercialLandingPageHtml,
  writeAffiliateLinkManifest,
  writeCommercialLandingPage,
} = require("../../lib/commercial-intelligence-engine");

test("Commercial Intelligence Engine builds a story-matched gaming link manifest", () => {
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "forza-commercial",
      title: "Forza Horizon 6 Steam Numbers Skyrocket",
      suggested_title: "Forza Horizon 6 Hits 92 on Metacritic, Steam Numbers Skyrocket",
      full_script:
        "Forza Horizon 6 just hit 130,000 concurrent players on Steam. The useful player angle is setup: racing wheels, Xbox controllers and Game Pass routes are the hardware-adjacent checks, not a random shopping list.",
      source_card_label: "GamesRadar+",
      youtube_post_id: "yt_forza",
    },
    tag: "pulsegaming-21",
  });

  assert.equal(manifest.story_id, "forza-commercial");
  assert.equal(manifest.vertical, "gaming");
  assert.equal(manifest.commercial_intent_type, "racing_game_setup");
  assert.equal(manifest.primary_affiliate_angle, "Racing wheels and Xbox/PC setup checks");
  assert.deepEqual(
    manifest.approved_affiliate_programmes.map((item) => item.id),
    APPROVED_AFFILIATE_PROGRAMMES.map((item) => item.id),
  );
  assert.ok(manifest.candidate_links.length >= 3);
  assert.equal(manifest.primary_link.merchant, "Amazon UK");
  assert.match(manifest.primary_link.url, /amazon\.co\.uk/);
  assert.match(manifest.primary_link.url, /tag=pulsegaming-21/);
  assert.match(manifest.primary_link.tracking_url, /^\/go\/forza-commercial\//);
  assert.match(manifest.primary_link.platform_tracking_urls.youtube, /platform=youtube/);
  assert.match(manifest.primary_link.platform_tracking_urls.youtube, /video_id=yt_forza/);
  assert.ok(manifest.primary_link.affiliate_score >= 70);
  assert.ok(manifest.relevance_score >= 70);
  assert.ok(manifest.trust_score >= 70);
  assert.equal(manifest.disclosure_required, true);
  assert.match(manifest.disclosure_copy.short, /Affiliate links may earn us a commission/);
  assert.equal(manifest.landing_page_slug, "forza-horizon-6-steam-numbers-skyrocket");
  assert.equal(manifest.landing_page_route, "/p/forza-horizon-6-steam-numbers-skyrocket");
  assert.equal(manifest.tracking_utm.story_id, "forza-commercial");
  assert.equal(manifest.affiliate_tracking_map.story_id, "forza-commercial");
  assert.equal(manifest.affiliate_tracking_map.primary_offer_id, manifest.primary_link.id);
  assert.equal(
    manifest.affiliate_tracking_map.platforms.youtube,
    manifest.primary_link.platform_tracking_urls.youtube,
  );
  assert.equal(manifest.revenue_attribution.story_id, "forza-commercial");
  assert.equal(manifest.revenue_attribution.video_id, "yt_forza");
  assert.match(manifest.platform_specific_ctas.youtube, /story page/i);
  assert.equal(manifest.rejection_reasons.length, 0);
});

test("Commercial Intelligence Engine builds per-platform landing-page attribution", () => {
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "forza-commercial",
      title: "Forza Horizon 6 Steam Numbers Skyrocket",
      full_script:
        "Forza Horizon 6 just hit 130,000 concurrent Steam players. Racing wheels, Xbox controllers and Game Pass routes are the useful setup checks.",
      youtube_post_id: "yt_forza",
    },
    tag: "pulsegaming-21",
  });

  const attribution = manifest.landing_page_attribution;
  const platforms = ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"];

  assert.equal(attribution.verdict, "pass");
  assert.deepEqual(Object.keys(attribution.platforms).sort(), platforms.sort());
  assert.equal(attribution.story_id, "forza-commercial");
  assert.equal(attribution.landing_page_route, manifest.landing_page_route);
  assert.equal(attribution.platforms.youtube.video_id, "yt_forza");
  assert.equal(attribution.platforms.youtube.cta_variant, "story_page");
  assert.match(attribution.platforms.youtube.landing_page_url, /^\/p\/forza-horizon-6-steam-numbers-skyrocket\?/);
  assert.match(attribution.platforms.youtube.landing_page_url, /utm_source=youtube/);
  assert.match(attribution.platforms.youtube.landing_page_url, /utm_medium=social/);
  assert.match(attribution.platforms.youtube.landing_page_url, /utm_campaign=forza-horizon-6-steam-numbers-skyrocket/);
  assert.match(attribution.platforms.youtube.landing_page_url, /utm_content=forza-commercial_youtube_story_page/);
  assert.equal(attribution.platforms.youtube.disclosure_required, true);
  assert.equal(attribution.platforms.youtube.disclosure_copy, manifest.disclosure_copy.short);
  assert.match(attribution.platforms.threads.offer_tracking_url, /platform=threads/);
  assert.match(attribution.platforms.pinterest.offer_tracking_url, /platform=pinterest/);
  assert.equal(
    new Set(attribution.link_tracking.map((item) => item.tracking_key)).size,
    platforms.length,
  );
  assert.equal(attribution.rejection_reasons.length, 0);
});

test("Commercial Intelligence Engine refuses unrelated policy stories instead of adding random links", () => {
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "xbox-policy",
      title: "Xbox account verification policy changes",
      full_script:
        "Xbox account verification policy changed without a product, hardware, subscription or game purchase angle.",
    },
    tag: "pulsegaming-21",
  });

  assert.equal(manifest.vertical, "gaming");
  assert.equal(manifest.commercial_intent_type, "no_safe_commercial_intent");
  assert.equal(manifest.primary_link, null);
  assert.deepEqual(manifest.fallback_links, []);
  assert.ok(
    manifest.rejection_reasons.includes(
      "story_does_not_naturally_support_affiliate",
    ),
  );
});

test("Commercial Intelligence Engine does not let stale racing context override a Super Mario RPG deal", () => {
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "mario-rpg-deal",
      selected_title: "Super Mario RPG Drops To $15",
      canonical_title: "Super Mario RPG - $15 at GameStop",
      canonical_subject: "Super Mario RPG",
      canonical_game: "Super Mario RPG",
      canonical_angle: "racing_game_setup",
      narration_script:
        "Super Mario RPG just dropped to $15 at GameStop. GameStop lists Super Mario RPG at $15, 70% off its listed price.",
      confirmed_claims: ["GameStop lists Super Mario RPG at $15, 70% off its listed price."],
      primary_source: "GameStop",
    },
    tag: "pulsegaming-21",
  });

  assert.equal(manifest.vertical, "gaming");
  assert.equal(manifest.commercial_intent_type, "nintendo_franchise_game_deal");
  assert.notEqual(manifest.primary_link?.product_category, "racing wheel");
  assert.doesNotMatch(
    manifest.candidate_links.map((link) => `${link.label} ${link.query}`).join(" "),
    /racing wheel/i,
  );
  assert.match(manifest.primary_link?.label || "", /Mario|Nintendo|eShop/i);
  assert.ok(manifest.relevance_score >= 70);
});

test("Commercial Intelligence Engine ignores incidental Forza wording when the public story is Subnautica", () => {
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "subnautica-leak",
      selected_title: "Subnautica 2 Reportedly Leaked Early",
      canonical_title: "After Forza Horizon 6, Now Subnautica 2 Has Reportedly Leaked 48 Hours Ahead of Launch",
      canonical_subject: "Subnautica 2",
      canonical_game: "Subnautica 2",
      canonical_angle: "racing_game_setup",
      narration_script:
        "Subnautica 2 reportedly leaked before launch. Rough leaked material can shape expectations before the official build gets a fair look.",
      confirmed_claims: ["Subnautica 2 reportedly appeared online before launch."],
      primary_source: "Respawnfirst",
    },
    tag: "pulsegaming-21",
  });

  assert.equal(manifest.vertical, "gaming");
  assert.equal(manifest.commercial_intent_type, "no_safe_commercial_intent");
  assert.equal(manifest.primary_link, null);
  assert.doesNotMatch(
    manifest.candidate_links.map((link) => `${link.label} ${link.query}`).join(" "),
    /racing wheel|game pass|xbox controller/i,
  );
});

test("Commercial Intelligence Engine treats Forza-branded Xbox controller stories as accessory offers", () => {
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "xbox-controller-accessory",
      selected_title: "Xbox Controller Deal Has One Catch",
      canonical_title: "FH6 limited-edition Xbox controller and headset have just leaked",
      canonical_subject: "Xbox Controller",
      canonical_game: "Xbox Controller",
      canonical_angle: "racing_game_setup",
      narration_script:
        "Xbox controller deals are getting aggressive, but the catch is the retailer. Xbox lists official Forza Horizon 6 limited-edition Xbox Wireless Controller and Xbox Wireless Headset accessories.",
      confirmed_claims: [
        "Xbox lists official Forza Horizon 6 limited-edition Xbox Wireless Controller and Xbox Wireless Headset accessories.",
      ],
      primary_source: "Xbox",
    },
    tag: "pulsegaming-21",
  });

  assert.equal(manifest.vertical, "gaming");
  assert.equal(manifest.commercial_intent_type, "controller_accessory_context");
  assert.match(manifest.primary_link?.label || "", /controller/i);
  assert.notEqual(manifest.primary_link?.product_category, "racing wheel");
  assert.doesNotMatch(
    manifest.candidate_links.map((link) => `${link.label} ${link.query}`).join(" "),
    /racing wheel/i,
  );
});

test("Commercial Intelligence Engine keeps gaming stories with camera wording out of tech creator offers", () => {
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "star-wars-racer-date",
      selected_title: "Star Wars Racer Date Leaked Early",
      canonical_subject: "Star Wars: Galactic Racer",
      canonical_game: "Star Wars: Galactic Racer",
      narration_script:
        "Star Wars: Galactic Racer may have leaked its own release date. Now players can see the pace, camera and combat instead of reading another announcement.",
      confirmed_claims: ["The release date appeared early."],
    },
    tag: "pulsegaming-21",
  });

  assert.equal(manifest.vertical, "gaming");
  assert.equal(manifest.commercial_intent_type, "no_safe_commercial_intent");
  assert.equal(manifest.primary_link, null);
  assert.ok(manifest.rejection_reasons.includes("story_does_not_naturally_support_affiliate"));
});

test("Commercial Intelligence Engine keeps finance and crypto promotions compliance-first", () => {
  const crypto = buildAffiliateLinkManifest({
    story: {
      id: "crypto-risk",
      title: "Bitcoin leverage exchange promotion claims guaranteed upside",
      full_script:
        "A crypto exchange is pushing price prediction hype and leverage. The story needs source links and risk notes, not a buy or sell recommendation.",
      channel_id: "stacked",
    },
    tag: "pulsegaming-21",
  });

  assert.equal(crypto.vertical, "crypto");
  assert.equal(crypto.primary_link, null);
  assert.ok(crypto.compliance_risk_score >= 80);
  assert.ok(
    crypto.rejection_reasons.includes("crypto_financial_promotion_risk_high"),
  );
  assert.match(crypto.platform_specific_ctas.youtube, /No buy\/sell recommendation/);

  const finance = buildAffiliateLinkManifest({
    story: {
      id: "finance-education",
      title: "UK budgeting app changes fees for savers",
      full_script:
        "This is a personal finance story about budgeting tools and consumer fees. Sources and further reading matter more than a product push.",
      channel_id: "stacked",
    },
    tag: "pulsegaming-21",
  });

  assert.equal(finance.vertical, "finance");
  assert.match(finance.platform_specific_ctas.youtube, /not financial advice/i);
  assert.equal(finance.compliance.disclaimer_required, true);
});

test("Commercial Intelligence Engine penalises overused offers", () => {
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "forza-repeat",
      title: "Forza Horizon 6 racing wheel demand jumps after launch",
      full_script:
        "Forza Horizon 6 players are comparing racing wheel and Xbox controller setups after the launch spike.",
    },
    tag: "pulsegaming-21",
    recentOfferUse: {
      "racing wheel": 6,
    },
  });

  const racingWheel = manifest.candidate_links.find((link) =>
    /racing wheel/i.test(`${link.label} ${link.query}`),
  );
  assert.ok(racingWheel);
  assert.ok(racingWheel.spam_penalty >= 25);
  assert.ok(racingWheel.rejection_reasons.includes("offer_overused_recently"));
});

test("Commercial Intelligence Engine writes manifest JSON and /p landing page HTML", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-commercial-"));
  const manifest = buildAffiliateLinkManifest({
    story: {
      id: "steam-deck-oled",
      title: "Steam Deck OLED deal gets a useful storage catch",
      full_script:
        "Steam Deck OLED storage and microSD choices are the practical part of this story.",
      article_url: "https://example.com/steam-deck-oled",
    },
    tag: "pulsegaming-21",
  });

  const manifestWrite = await writeAffiliateLinkManifest(manifest, {
    outputDir: path.join(tmp, "commercial"),
  });
  const landingWrite = await writeCommercialLandingPage(manifest, {
    outputDir: path.join(tmp, "p"),
  });
  const parsed = JSON.parse(await fs.readFile(manifestWrite.path, "utf8"));
  const html = await fs.readFile(landingWrite.path, "utf8");

  assert.equal(parsed.story_id, "steam-deck-oled");
  assert.equal(path.basename(manifestWrite.path), "steam-deck-oled_affiliate_link_manifest.json");
  assert.equal(path.basename(landingWrite.path), `${manifest.landing_page_slug}.html`);
  assert.match(html, /Affiliate links may earn us a commission/);
  assert.match(html, /Sources/);
  assert.match(html, /Best related offers/);
  assert.match(html, /href="\/go\/steam-deck-oled\//);
  assert.match(
    html,
    /<a href="https:\/\/example\.com\/steam-deck-oled" rel="nofollow">Source<\/a>/,
  );
  assert.match(buildCommercialLandingPageHtml(manifest), /newsletter/i);
});
