"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const PROJECT = path.join(
  ROOT,
  "videos",
  "evercold-bastion-short",
);
const AUDIT = JSON.parse(
  fs.readFileSync(
    path.join(PROJECT, "evidence", "platform-safe-zone-audit.json"),
    "utf8",
  ),
);

function closeEnough(actual, expected, tolerance) {
  return Math.abs(actual - expected) <= tolerance;
}

async function launchRuntimeBrowser() {
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

async function seekAndMeasure(page, atSeconds, ids) {
  return page.evaluate(
    ({ atSeconds: time, ids: elementIds }) => {
      window.__timelines.main.pause().seek(time, false);
      const isEffectivelyVisible = (element) => {
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
          const style = getComputedStyle(current);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity) <= 0.02
          ) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      };
      return Object.fromEntries(
        elementIds.map((id) => {
          const element = document.getElementById(id);
          if (!element) return [id, null];
          const rect = element.getBoundingClientRect();
          return [
            id,
            {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              right: rect.right,
              bottom: rect.bottom,
              visible: isEffectivelyVisible(element),
            },
          ];
        }),
      );
    },
    { atSeconds, ids },
  );
}

test(
  "Evercold computed geometry matches the audit and stays inside the strict safe zone throughout deterministic motion",
  { timeout: 45_000 },
  async (t) => {
    const browser = await launchRuntimeBrowser();
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1920 },
    });
    await page.addInitScript({
      path: require.resolve("gsap/dist/gsap.min.js"),
    });
    await page.goto(
      pathToFileURL(path.join(PROJECT, "index.html")).href,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForFunction(
      () =>
        window.__timelines?.main &&
        typeof window.__timelines.main.seek === "function",
    );

    const elements = new Map(
      AUDIT.elements.map((element) => [element.id, element]),
    );
    const tolerance =
      AUDIT.runtime_geometry_evidence.tolerance_px;

    for (const sample of AUDIT.runtime_geometry_evidence
      .rest_samples) {
      const measured = await seekAndMeasure(
        page,
        sample.at_seconds,
        sample.element_ids,
      );
      for (const id of sample.element_ids) {
        const actual = measured[id];
        const declared = elements.get(id)?.bbox;
        assert.ok(actual, `runtime element exists: ${id}`);
        assert.ok(declared, `audit box exists: ${id}`);
        for (const field of ["x", "y", "width", "height"]) {
          assert.ok(
            closeEnough(actual[field], declared[field], tolerance),
            `${id} ${field} is ${actual[field]}px at ${sample.at_seconds}s; expected ${declared[field]}±${tolerance}px`,
          );
        }
      }
    }

    const safe = AUDIT.safe_rect;
    const allIds = AUDIT.elements.map((element) => element.id);
    for (const atSeconds of AUDIT.runtime_geometry_evidence
      .sweep_seconds) {
      const measured = await seekAndMeasure(
        page,
        atSeconds,
        allIds,
      );
      for (const element of AUDIT.elements) {
        const actual = measured[element.id];
        assert.ok(actual, `runtime element exists: ${element.id}`);
        if (!actual.visible) continue;
        assert.ok(
          actual.x >= safe.x - tolerance &&
            actual.y >= safe.y - tolerance &&
            actual.right <= safe.x + safe.width + tolerance &&
            actual.bottom <= safe.y + safe.height + tolerance,
          `${element.id} escapes the strict safe rect at ${atSeconds}s: ${JSON.stringify(actual)}`,
        );
      }
    }
  },
);
