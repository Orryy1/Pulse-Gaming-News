import { test } from "node:test";
import assert from "node:assert/strict";

// TITLE_KEEP_WHOLE (27 Nov 2026): real titles that went live broken.
const withEnv = async (v: string | undefined, fn: () => Promise<void>) => {
  const old = process.env.TITLE_KEEP_WHOLE;
  if (v === undefined) delete process.env.TITLE_KEEP_WHOLE;
  else process.env.TITLE_KEEP_WHOLE = v;
  try {
    await fn();
  } finally {
    if (old === undefined) delete process.env.TITLE_KEEP_WHOLE;
    else process.env.TITLE_KEEP_WHOLE = old;
  }
};

const gtaFile = async (
  title: string,
  headline = "GTA 6 radio keeps playing on foot",
) => {
  const { goodScript } = await import("./helpers.ts");
  const s = goodScript() as any;
  return {
    ...s,
    game_title: "Grand Theft Auto VI",
    headline,
    youtube: { ...s.youtube, title },
  };
};

test("a GTA File title keeps its part number and its last word (zsMUOYm9d2A went live as 'GTA VI File : ... You're on')", async () => {
  const { polishTitle } = await import("../src/editorial/seo.ts");
  const { gtaFileTitle } = await import("../src/gtafile.ts");
  const raw = gtaFileTitle(
    3,
    "GTA 6 radio now keeps playing when you're on foot",
  );
  await withEnv(undefined, async () => {
    const t = polishTitle(await gtaFile(raw));
    assert.equal(
      t,
      "GTA VI File #3: GTA 6 Radio Now Keeps Playing When You're on Foot",
    );
  });
  await withEnv("false", async () => {
    const t = polishTitle(await gtaFile(raw));
    assert.equal(
      t,
      "GTA VI File : GTA 6 Radio Now Keeps Playing When You're on",
      "off restores the old behaviour",
    );
  });
});

test("a series title is never rebuilt from the headline, so the part survives a long claim", async () => {
  const { polishTitle } = await import("../src/editorial/seo.ts");
  const long =
    "GTA VI File #5: The police now remember your car, your clothes and the exact street where they last saw you";
  await withEnv(undefined, async () => {
    const t = polishTitle(await gtaFile(long));
    assert.ok(t.startsWith("GTA VI File #5: "), t);
    assert.ok(t.length <= 76, `${t.length}: ${t}`);
    assert.ok(
      !/\b(the|and|your|of|on|to)$/i.test(t),
      `ends on a dangling word: ${t}`,
    );
  });
});

test("real hashtags still come out of a title, part numbers stay", async () => {
  const { polishTitle } = await import("../src/editorial/seo.ts");
  await withEnv(undefined, async () => {
    const t = polishTitle(
      await gtaFile("GTA 6 radio keeps playing on foot #GTA6 #shorts"),
    );
    assert.equal(t, "GTA 6 Radio Keeps Playing on Foot");
  });
});

test("a cut title drops a dangling small word at the end", async () => {
  const { truncateWords } = await import("../src/editorial/seo.ts");
  const s =
    "Halo Infinite Finally Lets You Change the Colour of Your Armour in Ranked";
  await withEnv(undefined, async () => {
    const t = truncateWords(s, 60);
    assert.ok(t.length <= 60);
    assert.equal(t, "Halo Infinite Finally Lets You Change the Colour");
  });
  await withEnv("false", async () => {
    assert.equal(
      truncateWords(s, 60),
      "Halo Infinite Finally Lets You Change the Colour of Your",
    );
  });
});

test("the word after a question mark is capitalised ('Police Cars? the Honest Answer' went live)", async () => {
  const { titleCase } = await import("../src/editorial/seo.ts");
  await withEnv(undefined, async () => {
    assert.equal(
      titleCase("GTA 6 Can You Keep Police Cars? the honest answer"),
      "GTA 6 Can You Keep Police Cars? The Honest Answer",
    );
  });
  await withEnv("false", async () => {
    assert.equal(
      titleCase("GTA 6 Can You Keep Police Cars? the honest answer"),
      "GTA 6 Can You Keep Police Cars? the Honest Answer",
    );
  });
});

test("titleProblems: a part number is not a hashtag and a series title gets its prefix's room", async () => {
  const { titleProblems } = await import("../src/editorial/seo.ts");
  await withEnv(undefined, async () => {
    assert.deepEqual(
      titleProblems(
        "GTA VI File #3: GTA 6 Radio Now Keeps Playing When You're on Foot",
      ),
      [],
    );
    assert.ok(
      titleProblems("GTA 6 radio #GTA6").includes("No hashtags in the title."),
    );
    assert.ok(
      titleProblems("A".repeat(10) + " " + "b".repeat(55)).length > 0,
      "non-series titles keep the 60 cap",
    );
  });
});

test("a cut that leaves a one- or two-word clause drops it with its comma", async () => {
  const { truncateWords } = await import("../src/editorial/seo.ts");
  const s = "Why Star Wars Battlefront 2 Got a Remaster, Not a Battlefront 3";
  await withEnv(undefined, async () => {
    assert.equal(truncateWords(s, 52), "Why Star Wars Battlefront 2 Got a Remaster");
    assert.equal(truncateWords("Short title, fine", 60), "Short title, fine", "uncut titles are untouched");
  });
});

test("review 27 Nov: a series title is still cleaned of clickbait words and punctuation", async () => {
  const { polishTitle, titleProblems } = await import("../src/editorial/seo.ts");
  await withEnv(undefined, async () => {
    const t = polishTitle(await gtaFile("GTA VI File #3: Is this INSANE?!? Shocking insane leak"));
    assert.ok(t.startsWith("GTA VI File #3: "), t);
    assert.deepEqual(titleProblems(t), [], t);
  });
});

test("review 27 Nov: only the factory's own series count as a series prefix", async () => {
  const { seriesPrefix, titleProblems } = await import("../src/editorial/seo.ts");
  assert.equal(seriesPrefix("GTA VI File #3: Radio on foot"), "GTA VI File #3: ");
  assert.equal(seriesPrefix("The Why #12: Why Halo 3 ended"), "The Why #12: ");
  assert.equal(seriesPrefix("Ranked #1: The best open world ever"), "");
  await withEnv(undefined, async () => {
    assert.ok(titleProblems("Steam Top Seller #1: Something completely unrelated to the game").length > 0);
  });
});

test("review 27 Nov: clause drop, 3-word clauses kept, more dangling words, non-ASCII hashtags", async () => {
  const { truncateWords, polishTitle } = await import("../src/editorial/seo.ts");
  await withEnv(undefined, async () => {
    assert.equal(truncateWords("GTA 6 Runs Steadier on Series X Than Base PS5, PS5 Pro and PC", 50), "GTA 6 Runs Steadier on Series X Than Base PS5");
    assert.equal(truncateWords("Halo Infinite Is Getting a Brand New Battle Pass That You Will Be", 60), "Halo Infinite Is Getting a Brand New Battle Pass");
    assert.equal(truncateWords("Switch 2 Will Not Run It", 17), "Switch 2 Will Not", "'not' is never stripped on its own");
    const t = polishTitle(await gtaFile("Pokémon Legends Z-A #Pokémon trailer drops today"));
    assert.ok(!/émon Trailer/.test(t.replace("Pokémon Legends", "")), t);
  });
});
