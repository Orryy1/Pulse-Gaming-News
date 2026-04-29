"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { extractSteamTrailerUrls } = require("../../images_download");

// 2026-04-29: extend the Steam search fallback in images_download.js
// to also pull trailer URLs out of the appdetails payload.
// Before this change, the fallback only consumed `screenshots` from
// appdetails and left every RSS-sourced Steam-matched story to fall
// through to the IGDB / YouTube b-roll path — even though Steam itself
// already had the official publisher trailer cached one HTTP request
// away. This file pins the URL-selection behaviour so the renderer
// gets real motion footage on Steam-matched stories.

// ── basic happy path ─────────────────────────────────────────────

test("extractSteamTrailerUrls: prefers webm.max over mp4.max", () => {
  const appData = {
    movies: [
      {
        id: 1,
        name: "Reveal Trailer",
        webm: { 480: "https://cdn/w480", max: "https://cdn/wmax" },
        mp4: { 480: "https://cdn/m480", max: "https://cdn/mmax" },
      },
    ],
  };
  const got = extractSteamTrailerUrls(appData, 2);
  assert.equal(got.length, 1);
  assert.equal(got[0].url, "https://cdn/wmax");
  assert.equal(got[0].name, "Reveal Trailer");
});

test("extractSteamTrailerUrls: webm.480 wins over mp4 when webm.max missing", () => {
  const appData = {
    movies: [
      {
        webm: { 480: "https://cdn/w480" },
        mp4: { max: "https://cdn/mmax" },
      },
    ],
  };
  const got = extractSteamTrailerUrls(appData, 2);
  assert.equal(got[0].url, "https://cdn/w480");
});

test("extractSteamTrailerUrls: falls through to mp4.max when webm absent", () => {
  const appData = {
    movies: [
      {
        mp4: { 480: "https://cdn/m480", max: "https://cdn/mmax" },
      },
    ],
  };
  const got = extractSteamTrailerUrls(appData, 2);
  assert.equal(got[0].url, "https://cdn/mmax");
});

test("extractSteamTrailerUrls: mp4.480 used when nothing else available", () => {
  const appData = {
    movies: [{ mp4: { 480: "https://cdn/m480" } }],
  };
  const got = extractSteamTrailerUrls(appData, 2);
  assert.equal(got[0].url, "https://cdn/m480");
});

// ── max cap ──────────────────────────────────────────────────────

test("extractSteamTrailerUrls: respects the max param", () => {
  const appData = {
    movies: [
      { webm: { max: "https://cdn/1" } },
      { webm: { max: "https://cdn/2" } },
      { webm: { max: "https://cdn/3" } },
      { webm: { max: "https://cdn/4" } },
    ],
  };
  const got = extractSteamTrailerUrls(appData, 2);
  assert.equal(got.length, 2);
  assert.equal(got[0].url, "https://cdn/1");
  assert.equal(got[1].url, "https://cdn/2");
});

test("extractSteamTrailerUrls: max=0 returns empty", () => {
  const appData = { movies: [{ webm: { max: "x" } }] };
  assert.deepEqual(extractSteamTrailerUrls(appData, 0), []);
});

// ── defensive paths ──────────────────────────────────────────────

test("extractSteamTrailerUrls: null appData returns []", () => {
  assert.deepEqual(extractSteamTrailerUrls(null), []);
  assert.deepEqual(extractSteamTrailerUrls(undefined), []);
});

test("extractSteamTrailerUrls: appData with no movies returns []", () => {
  assert.deepEqual(extractSteamTrailerUrls({}), []);
  assert.deepEqual(extractSteamTrailerUrls({ movies: [] }), []);
  assert.deepEqual(extractSteamTrailerUrls({ movies: null }), []);
});

test("extractSteamTrailerUrls: movies with no usable URL are skipped, not erroring", () => {
  const appData = {
    movies: [
      { name: "broken", webm: {}, mp4: {} },
      { webm: { max: "https://cdn/good" } },
      null,
      "garbage",
    ],
  };
  const got = extractSteamTrailerUrls(appData, 5);
  assert.equal(got.length, 1);
  assert.equal(got[0].url, "https://cdn/good");
});

test("extractSteamTrailerUrls: name field defaults to null when absent", () => {
  const appData = { movies: [{ webm: { max: "https://cdn/u" } }] };
  const got = extractSteamTrailerUrls(appData, 1);
  assert.equal(got[0].name, null);
});
