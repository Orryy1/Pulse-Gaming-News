"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");
const sharp = require("sharp");

const {
  svgForScene,
} = require("../../lib/services/governed-autonomous-production-media-adapters");
const {
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  getAssCaptionSafeZoneContract,
  getPlatformSafeZoneProfile,
} = require("../../lib/services/platform-safe-zones");

const CANVAS = Object.freeze({ width: 1080, height: 1920 });
const PROGRAMME_ZOOM = 1.06;
const SAFE_RECT = getPlatformSafeZoneProfile(
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
).safe_rect;
const CAPTION_RECT = getAssCaptionSafeZoneContract(
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
).caption_rect;
const TOWNFALL_SCENES = Object.freeze([
  Object.freeze({
    headline: "SILENT HILL: TOWNFALL LAUNCHES 24 SEPTEMBER",
    supporting_text:
      "Silent Hill: Townfall launches 24 September on PlayStation 5 with first-person combat.",
  }),
  Object.freeze({
    headline: "SCREEN BURN INTERACTIVE CONFIRMS THE GAME",
    supporting_text:
      "Screen Burn Interactive confirms the game replaces the iconic radio with an active CRTV device.",
  }),
  Object.freeze({
    headline: "THIS SHIFT MARKS THE FRANCHISE'S FIRST",
    supporting_text:
      "This shift marks the franchise's first full-length title using this perspective.",
  }),
  Object.freeze({
    headline:
      "Silent Hill: Townfall Developers discuss the Scottish setting, retro technology, first-person combat",
    supporting_text:
      "Silent Hill: Townfall marks the first full-length Silent Hill game to adopt a first-person perspective.",
  }),
  Object.freeze({
    headline: "W".repeat(96),
    supporting_text: "W".repeat(180),
  }),
]);
const UNICODE_SCENES = Object.freeze([
  Object.freeze({
    headline: "界".repeat(96),
    supporting_text: "語".repeat(180),
  }),
  Object.freeze({
    headline: "🎮".repeat(48),
    supporting_text: "🎮".repeat(90),
  }),
  Object.freeze({
    headline: "ÉLAN ÑANDÚ ÜBER ÇAĞRI ".repeat(5).slice(0, 96),
    supporting_text:
      "São Tomé déjà vu — naïve façade, Łódź, Māori and İSTANBUL. "
        .repeat(4)
        .slice(0, 180),
  }),
]);

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (bundledError) {
    try {
      return await chromium.launch({
        headless: true,
        channel: "chrome",
      });
    } catch (chromeError) {
      chromeError.cause = bundledError;
      throw chromeError;
    }
  }
}

test(
  "authored Silent Hill scenes keep every text box inside the strict portrait rect after programme zoom",
  { timeout: 30_000 },
  async (t) => {
    const browser = await launchBrowser();
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1920 },
    });

    for (const [index, townfall] of TOWNFALL_SCENES.entries()) {
      const svg = svgForScene({
        role: index === 0 ? "hook_slam" : `verified_detail_${index}`,
        design: {
          accent_colour: "#FF6B1A",
          layout: index === 0 ? "TITLE" : "COMPARISON",
          ...townfall,
        },
      });
      assert.match(svg, /PULSE \/ /);
      assert.doesNotMatch(svg, /\u00e2\u20ac\u00a2/);
      const rendered = await sharp(Buffer.from(svg, "utf8")).metadata();
      assert.equal(rendered.width, CANVAS.width);
      assert.equal(rendered.height, CANVAS.height);
      await page.setContent(svg, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts.ready);

      const { canvas, labels, textBoxes } = await page.$$eval(
        "svg text",
        (elements) => ({
          canvas: {
            width: elements[0].ownerSVGElement.width.baseVal.value,
            height: elements[0].ownerSVGElement.height.baseVal.value,
          },
          labels: elements
            .map((element) => element.getAttribute("aria-label"))
            .filter(Boolean),
          textBoxes: elements.map((element) => {
            const box = element.getBBox();
            return {
              text: element.textContent,
              x: box.x,
              y: box.y,
              right: box.x + box.width,
              bottom: box.y + box.height,
            };
          }),
        }),
      );
      assert.deepEqual(canvas, CANVAS);
      assert.ok(labels.includes(townfall.headline.toUpperCase()));
      assert.ok(labels.includes(townfall.supporting_text));
      assert.ok(textBoxes.length >= 4);
      for (let textIndex = 1; textIndex < textBoxes.length; textIndex += 1) {
        assert.ok(
          textBoxes[textIndex - 1].bottom <= textBoxes[textIndex].y,
          `authored text boxes overlap: ${JSON.stringify([
            textBoxes[textIndex - 1],
            textBoxes[textIndex],
          ])}`,
        );
      }
      for (const box of textBoxes) {
        const zoomed = {
          text: box.text,
          x:
            CANVAS.width / 2 +
            (box.x - CANVAS.width / 2) * PROGRAMME_ZOOM,
          y:
            CANVAS.height / 2 +
            (box.y - CANVAS.height / 2) * PROGRAMME_ZOOM,
          right:
            CANVAS.width / 2 +
            (box.right - CANVAS.width / 2) * PROGRAMME_ZOOM,
          bottom:
            CANVAS.height / 2 +
            (box.bottom - CANVAS.height / 2) * PROGRAMME_ZOOM,
        };
        assert.ok(
          zoomed.x >= SAFE_RECT.x &&
            zoomed.right <= SAFE_RECT.x + SAFE_RECT.width &&
            zoomed.y >= SAFE_RECT.y &&
            zoomed.bottom <= SAFE_RECT.y + SAFE_RECT.height,
          `authored text escapes after programme zoom: ${JSON.stringify(zoomed)}`,
        );
        assert.ok(
          zoomed.bottom <= CAPTION_RECT.y ||
            zoomed.y >= CAPTION_RECT.y + CAPTION_RECT.height,
          `authored text overlaps the caption lane after programme zoom: ${JSON.stringify(zoomed)}`,
        );
      }
    }
  },
);

test(
  "maximum-valid Unicode authored text reconstructs exactly and stays strict-safe after zoom",
  { timeout: 30_000 },
  async (t) => {
    const browser = await launchBrowser();
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1920 },
    });

    for (const [index, authored] of UNICODE_SCENES.entries()) {
      assert.equal(authored.headline.length, 96);
      assert.equal(authored.supporting_text.length, 180);
      const svg = svgForScene({
        role: `unicode_case_${index}`,
        design: {
          accent_colour: "#FF6B1A",
          layout: "TITLE",
          ...authored,
        },
      });
      await page.setContent(svg, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => document.fonts.ready);

      const blocks = await page.$$eval(
        "svg text[aria-label]",
        (elements) =>
          elements.map((element) => {
            const box = element.getBBox();
            return {
              label: element.getAttribute("aria-label"),
              visible: Array.from(element.querySelectorAll("tspan"))
                .map((line) => line.textContent)
                .join(""),
              x: box.x,
              y: box.y,
              right: box.x + box.width,
              bottom: box.y + box.height,
            };
          }),
      );
      for (const expected of [
        authored.headline.toUpperCase(),
        authored.supporting_text,
      ]) {
        const block = blocks.find((candidate) => candidate.label === expected);
        assert.ok(block, `authored block exists: ${expected.slice(0, 24)}`);
        assert.equal(block.visible, expected);
      }
      for (const box of blocks) {
        const zoomed = {
          x:
            CANVAS.width / 2 +
            (box.x - CANVAS.width / 2) * PROGRAMME_ZOOM,
          y:
            CANVAS.height / 2 +
            (box.y - CANVAS.height / 2) * PROGRAMME_ZOOM,
          right:
            CANVAS.width / 2 +
            (box.right - CANVAS.width / 2) * PROGRAMME_ZOOM,
          bottom:
            CANVAS.height / 2 +
            (box.bottom - CANVAS.height / 2) * PROGRAMME_ZOOM,
        };
        assert.ok(
          zoomed.x >= SAFE_RECT.x &&
            zoomed.right <= SAFE_RECT.x + SAFE_RECT.width &&
            zoomed.y >= SAFE_RECT.y &&
            zoomed.bottom <= SAFE_RECT.y + SAFE_RECT.height,
          `Unicode text escapes after programme zoom: ${JSON.stringify(zoomed)}`,
        );
        assert.ok(
          zoomed.bottom <= CAPTION_RECT.y ||
            zoomed.y >= CAPTION_RECT.y + CAPTION_RECT.height,
          `Unicode text overlaps the caption lane: ${JSON.stringify(zoomed)}`,
        );
      }
    }
  },
);

test(
  "short authored scene text keeps its original type size and one-line treatment",
  { timeout: 30_000 },
  async (t) => {
    const svg = svgForScene({
      role: "player_impact",
      design: {
        accent_colour: "#FF6B1A",
        layout: "IMPACT",
        headline: "BASTION",
        supporting_text: "Patch live.",
      },
    });
    const browser = await launchBrowser();
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1920 },
    });
    await page.setContent(svg, { waitUntil: "domcontentloaded" });

    const headline = await page.$eval(
      'text[aria-label="BASTION"]',
      (element) => ({
        content: element.getAttribute("aria-label"),
        fontSize: element.getAttribute("font-size"),
        lineCount: element.querySelectorAll("tspan").length,
      }),
    );
    const supporting = await page.$eval(
      'text[aria-label="Patch live."]',
      (element) => ({
        content: element.getAttribute("aria-label"),
        fontSize: element.getAttribute("font-size"),
        lineCount: element.querySelectorAll("tspan").length,
      }),
    );

    assert.deepEqual(headline, {
      content: "BASTION",
      fontSize: "104",
      lineCount: 1,
    });
    assert.deepEqual(supporting, {
      content: "Patch live.",
      fontSize: "44",
      lineCount: 1,
    });
  },
);

test("an authored scene fails closed when one token cannot fit at the minimum type size", () => {
  assert.throws(
    () =>
      svgForScene({
        role: "hook_slam",
        design: {
          accent_colour: "#FF6B1A",
          layout: "TITLE",
          headline: "W".repeat(500),
          supporting_text: "Patch live.",
        },
      }),
    /svg_text_layout_cannot_fit/,
  );
});
