// Primary sources over Wikipedia, and credits that don't repeat (13 Nov 2026): src/discovery/wikirefs.ts and
// src/editorial/attribution.ts, and where the writers, checks and descriptions use them.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  citeArticle,
  descriptionSources,
  excerptFor,
  marksIn,
  outletName,
  parseCitedPage,
  primaryCredits,
  readPrimaries,
  refMark,
  refTable,
  renumber,
  sentencesCiting,
  sourceHeading,
  stripRefMarks,
} from "../src/discovery/wikirefs.ts";
import {
  mergeArticles,
  researchGame,
  type WikiArticle,
} from "../src/discovery/wikipedia.ts";
import {
  ATTRIBUTION_RULE,
  attributionCounts,
  attributionFrames,
  attributionProblems,
  scrubNarration,
  scrubWikipedia,
} from "../src/editorial/attribution.ts";
import { PULSE_FACT_RULES, writingProblems } from "../src/editorial/voice.ts";
import { factDrift, friendPassPrompt } from "../src/editorial/friendpass.ts";
import {
  docAttribution,
  docSources,
  groundDocMoments,
  sourceCredit,
  type DocMoment,
} from "../src/editorial/documentary.ts";
import { evidenceCredit } from "../src/editorial/evidence.ts";

const coins = (o: Record<string, string>) =>
  new URLSearchParams({ ctx_ver: "Z39.88-2004", ...o })
    .toString()
    .replace(/&/g, "&amp;");

/** A page the way the parse API renders it: a body with footnote marks, and the reference list. */
const PAGE = `<div class="mw-parser-output">
<p>Grand Theft Auto VI is an action-adventure game.</p>
<div class="mw-heading mw-heading2"><h2 id="Development">Development</h2></div>
<p>Rockstar confirmed in February 2022 that the game was in development.<sup id="cite_ref-a" class="reference"><a href="#cite_note-Confirm-1">[1]</a></sup> The first trailer drew 90 million views in a day.<sup class="reference"><a href="#cite_note-Views-2">[2]</a></sup><sup class="reference"><a href="#cite_note-Confirm-1">[1]</a></sup></p>
<p>Lucia was described as the first female lead.<sup class="reference"><a href="#cite_note-note-a">[a]</a></sup></p>
<table class="infobox"><tr><td>Developer<sup class="reference"><a href="#cite_note-Info-3">[3]</a></sup></td></tr></table>
<div class="mw-heading mw-heading2"><h2 id="References">References</h2></div>
<div class="reflist"><ol class="references">
<li id="cite_note-Confirm-1"><span class="reference-text"><cite class="citation web">"<a rel="nofollow" class="external text" href="https://www.rockstargames.com/newswire/article/abc/a-message">A Message from Rockstar Games</a>". <a rel="nofollow" class="external text" href="https://web.archive.org/web/2022/https://www.rockstargames.com/newswire/article/abc/a-message">Archived</a></cite><span title="${coins({ "rft.btitle": "A Message from Rockstar Games", "rft.pub": "Rockstar Games", "rft.date": "2022-02-04", rft_id: "https://www.rockstargames.com/newswire/article/abc/a-message" })}" class="Z3988"></span></span></li>
<li id="cite_note-Views-2"><span class="reference-text"><cite class="citation news">Smith (2023). <a rel="nofollow" class="external text" href="https://www.ign.com/articles/gta-6-trailer-views">"GTA 6 Trailer Breaks Records"</a>. <i>IGN</i>.</cite><span title="${coins({ "rft.atitle": "GTA 6 Trailer Breaks Records", "rft.jtitle": "IGN", "rft.date": "2023-12-06", "rft.aulast": "Smith", rft_id: "https://www.ign.com/articles/gta-6-trailer-views" })}" class="Z3988"></span></span></li>
<li id="cite_note-note-a"><span class="reference-text">Several outlets said so.</span></li>
<li id="cite_note-Info-3"><span class="reference-text"><a rel="nofollow" class="external text" href="https://example.com/info">Info</a></span></li>
</ol></div>
</div>`;

test("the cited page keeps each sentence's footnotes as marks and reads the references' own metadata", () => {
  const { extract, refs } = parseCitedPage(PAGE);
  assert.match(extract, /== Development ==/);
  assert.match(extract, new RegExp(`in development\\.${refMark(1)}`));
  assert.match(extract, new RegExp(`in a day\\.${refMark(2)}${refMark(1)}`));
  // An explanatory note ([a]) and the infobox carry no mark; the reference list is not body text.
  assert.doesNotMatch(extract, /female lead\.⁽/);
  assert.doesNotMatch(extract, /Developer|Several outlets|References/);
  assert.equal(refs.size, 2);
  assert.deepEqual(refs.get(1), {
    url: "https://www.rockstargames.com/newswire/article/abc/a-message",
    archive:
      "https://web.archive.org/web/2022/https://www.rockstargames.com/newswire/article/abc/a-message",
    outlet: "Rockstar Games",
    title: "A Message from Rockstar Games",
    date: "2022-02-04",
  });
  assert.equal(refs.get(2)!.outlet, "IGN");
  assert.equal(refs.get(2)!.author, "Smith");
});

test("marks are superscript, so a grounding check that keeps only digits never reads one as a figure", () => {
  assert.equal(refMark(12), "⁽¹²⁾");
  assert.equal(
    stripRefMarks(`It sold 90 million.${refMark(12)} Then more.${refMark(3)}`),
    "It sold 90 million. Then more.",
  );
  assert.doesNotMatch(refMark(1234), /\d/);
  assert.deepEqual(
    marksIn(`a${refMark(2)} b${refMark(5)} c${refMark(5)}`),
    [5, 2],
  );
});

test("renumbering runs from 1 in reading order and merged articles never share a number", () => {
  const r = renumber(`x${refMark(7)} y${refMark(3)} z${refMark(7)}`, [
    { n: 3, outlet: "IGN", url: "https://ign.com/a" },
    { n: 7, outlet: "Kotaku", url: "https://kotaku.com/b" },
  ]);
  assert.equal(r.text, `x${refMark(1)} y${refMark(2)} z${refMark(1)}`);
  assert.deepEqual(
    r.refs.map((x) => [x.n, x.outlet]),
    [
      [1, "Kotaku"],
      [2, "IGN"],
    ],
  );
  const a: WikiArticle = {
    title: "A",
    url: "https://en.wikipedia.org/wiki/A",
    text: `one${refMark(1)}`,
    refs: [{ n: 1, outlet: "IGN", url: "https://ign.com/1" }],
    primaries: [
      { n: 1, outlet: "IGN", url: "https://ign.com/1", title: "t", chars: 200 },
    ],
  };
  const b: WikiArticle = {
    title: "B",
    url: "https://en.wikipedia.org/wiki/B",
    text: `two${refMark(1)} three${refMark(2)}`,
    refs: [
      { n: 1, outlet: "Polygon", url: "https://polygon.com/1" },
      { n: 2, outlet: "Eurogamer", url: "https://eurogamer.net/2" },
    ],
    primaries: [
      {
        n: 2,
        outlet: "Eurogamer",
        url: "https://eurogamer.net/2",
        title: "e",
        chars: 300,
      },
    ],
  };
  const m = mergeArticles([a, b])!;
  assert.match(
    m.text,
    new RegExp(`one${refMark(1)}[\\s\\S]*two${refMark(2)} three${refMark(3)}`),
  );
  assert.deepEqual(
    m.refs!.map((x) => `${x.n} ${x.outlet}`),
    ["1 IGN", "2 Polygon", "3 Eurogamer"],
  );
  assert.deepEqual(
    m.primaries!.map((x) => `${x.n} ${x.outlet}`),
    ["1 IGN", "3 Eurogamer"],
  );
});

test("an original's excerpt is the part that backs what the notes cite it for", () => {
  const notes = `Rockstar confirmed the game in February 2022.${refMark(1)} It is set in Leonida.${refMark(2)}`;
  assert.deepEqual(sentencesCiting(notes, 1), [
    `Rockstar confirmed the game in February 2022.${refMark(1)}`,
  ]);
  const original = [
    "Welcome to the newsroom. Here are some unrelated words about a soundtrack and a cookie policy.",
    "We are pleased to confirm that active development for the next entry in the Grand Theft Auto series is well underway, Rockstar said in February 2022.",
    "Thanks for reading and see you soon at the next event, which is about something else entirely.",
  ].join("\n");
  const ex = excerptFor(original, sentencesCiting(notes, 1));
  assert.match(ex, /active development/);
  assert.doesNotMatch(ex, /cookie|Thanks for reading/);
  assert.equal(excerptFor(original, []), "");
});

test("the originals are read most-cited first, under their outlet's header, and archived when the original is gone", async () => {
  const article: WikiArticle = {
    title: "Grand Theft Auto VI",
    url: "https://en.wikipedia.org/wiki/Grand_Theft_Auto_VI",
    text: `The trailer drew 90 million views in a day.${refMark(1)} Rockstar confirmed development in February 2022.${refMark(2)} It drew praise.${refMark(1)}`,
    refs: [
      {
        n: 1,
        outlet: "IGN",
        title: "GTA 6 Trailer Breaks Records",
        url: "https://www.ign.com/x",
        date: "2023-12-06",
      },
      {
        n: 2,
        outlet: "Rockstar Games",
        title: "A Message",
        url: "https://dead.example/y",
        archive: "https://web.archive.org/web/1/https://dead.example/y",
      },
    ],
  };
  const asked: string[] = [];
  const pages: Record<string, string> = {
    "https://www.ign.com/x": `${"Intro words about nothing in particular here. ".repeat(4)}\nThe GTA 6 trailer drew 90 million views in its first day, a record for the series and for Rockstar.\n${"Footer text. ".repeat(30)}`,
    "https://web.archive.org/web/1/https://dead.example/y": `${"Header filler. ".repeat(20)}\nRockstar Games confirmed in February 2022 that development of the next Grand Theft Auto is well underway.`,
  };
  const out = await readPrimaries(article, async (u) => {
    asked.push(u);
    return pages[u] ? { title: "t", text: pages[u]! } : undefined;
  });
  assert.deepEqual(asked, [
    "https://www.ign.com/x",
    "https://dead.example/y",
    "https://web.archive.org/web/1/https://dead.example/y",
  ]);
  assert.match(
    out.text,
    /\n\[IGN\] GTA 6 Trailer Breaks Records \(2023-12-06\) ⁽¹⁾\nThe GTA 6 trailer drew 90 million views/,
  );
  assert.match(
    out.text,
    /\[Rockstar Games\] A Message ⁽²⁾\nRockstar Games confirmed in February 2022/,
  );
  assert.deepEqual(
    out.primaries!.map((p) => [p.outlet, p.url]),
    [
      ["IGN", "https://www.ign.com/x"],
      ["Rockstar Games", "https://dead.example/y"],
    ],
  );
  // Never Wikipedia itself, and a brief with nothing cited is left alone.
  const none = await readPrimaries({ ...article, refs: [] }, async () => ({
    title: "",
    text: "",
  }));
  assert.equal(none.text, article.text);
});

test("research made cited: the same picked sections with marks, and the plain article when the page won't load", async () => {
  const extract = `Intro paragraph about the game that is long enough to count as a lead for the article. ${"More lead text. ".repeat(20)}\n\n== Development ==\nRockstar confirmed in February 2022 that the game was in development. The first trailer drew 90 million views in a day. ${"Development detail. ".repeat(30)}`;
  const fake = async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("action=parse"))
      return new Response(
        JSON.stringify({
          parse: {
            title: "Grand Theft Auto VI",
            text: PAGE.replace(
              "<p>Grand Theft Auto VI is an action-adventure game.</p>",
              `<p>${"Intro paragraph about the game that is long enough to count as a lead. ".repeat(8)}</p>`,
            ).replace(
              "</p>\n<p>Lucia",
              ` ${"Development detail. ".repeat(30)}</p>\n<p>Lucia`,
            ),
          },
        }),
      );
    if (u.includes("prop=extracts"))
      return new Response(
        JSON.stringify({
          query: { pages: [{ title: "Grand Theft Auto VI", extract }] },
        }),
      );
    return new Response("", { status: 404 });
  };
  const plain = await researchGame(
    "Grand Theft Auto VI",
    "q",
    9000,
    fake as typeof fetch,
  );
  assert.ok(plain && !plain.refs);
  const cited = await researchGame(
    "Grand Theft Auto VI",
    "q",
    9000,
    fake as typeof fetch,
    undefined,
    {
      cited: true,
      read: async (u) =>
        u.includes("ign.com")
          ? {
              title: "IGN",
              text: `${"x ".repeat(10)}\nThe first GTA 6 trailer drew 90 million views in a single day, IGN reported.\n${"y ".repeat(200)}`,
            }
          : undefined,
    },
  );
  assert.ok(cited?.refs?.length);
  assert.match(cited!.text, /in development\.⁽/);
  assert.equal(cited!.primaries?.[0]?.outlet, "IGN");
  assert.match(sourceHeading(cited!), /marks name who first reported/);
  assert.match(refTable(cited!.refs), /never Wikipedia/);
  // The page fails: the plain article stands.
  const broken = await citeArticle(
    plain!,
    9000,
    undefined,
    (async () => new Response("", { status: 500 })) as typeof fetch,
  );
  assert.equal(broken, plain);
});

test("outlets go by the names people say, and descriptions credit them over Wikipedia", () => {
  assert.equal(outletName("https://www.ign.com/articles/x"), "IGN");
  assert.equal(outletName("https://www.take2games.com/ir/news/x"), "Take-Two");
  assert.equal(outletName("https://www.gamesradar.com/x", "Edge"), "Edge");
  assert.equal(outletName("https://en.wikipedia.org/wiki/X"), "the record");
  assert.equal(outletName("https://smallsite.net/x"), "smallsite.net");
  assert.deepEqual(
    descriptionSources([
      "https://en.wikipedia.org/wiki/GTA",
      "https://kotaku.com/a",
      "https://kotaku.com/a",
    ]),
    ["• Kotaku: https://kotaku.com/a"],
  );
  assert.deepEqual(descriptionSources(["https://en.wikipedia.org/wiki/GTA"]), [
    "• Wikipedia: https://en.wikipedia.org/wiki/GTA",
  ]);
  assert.deepEqual(
    primaryCredits([
      {
        refs: [{ n: 1, outlet: "Polygon", url: "https://polygon.com/p" }],
        primaries: [
          {
            n: 2,
            outlet: "IGN",
            url: "https://ign.com/i",
            title: "",
            chars: 1,
          },
        ],
      },
    ]).map((x) => x.name),
    ["IGN", "Polygon"],
  );
});

// ---------------------------------------------------------------- credits

const SAID = (n: number) =>
  " This is a plain sentence about the game that adds nothing and runs to ten words.".repeat(
    n,
  );

test("Wikipedia said on air is always flagged, whoever wrote it", () => {
  const p = attributionProblems(
    "According to Wikipedia, the map is big. It sold well.",
  );
  assert.equal(p.length, 1);
  assert.match(p[0]!, /names Wikipedia once; never say Wikipedia on air/);
  // Inside a quotation it is someone else's words.
  assert.deepEqual(
    attributionProblems('He said "check Wikipedia" and left.'),
    [],
  );
});

test("one credit frame twice within a minute, or more than three times in a video, goes back", () => {
  const close = `Kotaku says the map is big.${SAID(2)} Kotaku says the price is $80.`;
  assert.match(
    attributionProblems(close).join(" "),
    /"Kotaku says" comes twice within a minute/,
  );
  // Far enough apart (about three minutes at 140 words a minute) it is fine.
  assert.deepEqual(
    attributionProblems(
      `Kotaku says the map is big.${SAID(40)} Kotaku says the price is $80.`,
    ),
    [],
  );
  const many = [
    "Rockstar confirms A.",
    "Rockstar confirmed B.",
    "Rockstar also confirms C.",
    "Rockstar confirms D.",
  ].join(SAID(20));
  assert.match(
    attributionProblems(many).join(" "),
    /\(rockstar confirm\) is used 4 times/,
  );
  // "According to" as a shape, whoever follows it.
  const according = [
    "According to IGN, a.",
    "According to Kotaku, b.",
    "According to Polygon, c.",
    "According to Eurogamer, d.",
    "According to VGC, e.",
  ].join(SAID(20));
  assert.match(
    attributionProblems(according).join(" "),
    /"According to" opens a credit 5 times/,
  );
  // A rumor's label repeats by rule and is never a frame.
  assert.deepEqual(
    attributionFrames("It reportedly costs $80. It reportedly ships in May."),
    [],
  );
});

test("earlier chapters count toward the limit, but only this chapter's uses are reported", () => {
  const before = [
    "Rockstar confirms A.",
    "Rockstar confirms B.",
    "Rockstar confirms C.",
  ].join(SAID(20));
  assert.deepEqual(
    attributionProblems(`${SAID(20)} It sold well.`, { before }),
    [],
  );
  assert.match(
    attributionProblems(`${SAID(20)} Rockstar confirms D.`, { before }).join(
      " ",
    ),
    /is used 4 times/,
  );
});

test("the counts the preview reports", () => {
  const c = attributionCounts(
    "According to Wikipedia, a. According to Kotaku, b. Rockstar confirms c. Rockstar told IGN d.",
  );
  assert.equal(c.wikipedia, 1);
  assert.equal(c.accordingTo, 2);
  assert.equal(c.byKey["rockstar confirm"], 1);
  assert.equal(c.byKey["rockstar tell"], 1);
});

test("Wikipedia comes off the air with the fact kept", () => {
  assert.equal(
    scrubWikipedia("According to Wikipedia, GTA 6 restricts weapons."),
    "GTA 6 restricts weapons.",
  );
  assert.equal(
    scrubWikipedia("It sold well, according to Wikipedia. Then it slowed."),
    "It sold well. Then it slowed.",
  );
  assert.equal(
    scrubWikipedia("First. According to Wikipedia's article, the map is big."),
    "First. The map is big.",
  );
  assert.equal(
    scrubWikipedia("Wikipedia reports that the map is big."),
    "Records show the map is big.",
  );
  assert.equal(scrubWikipedia("As Wikipedia notes, it is big."), "It is big.");
  assert.equal(
    scrubWikipedia(`Marks never reach the voice.${refMark(3)}`),
    `Marks never reach the voice.${refMark(3)}`,
  );
  const s = scrubNarration([
    { narration: "According to Wikipedia, a." },
    { narration: "b." },
  ]);
  assert.equal(s.changed, 1);
  assert.equal(s.lines[0]!.narration, "A.");
});

test("every writer's facts rules carry the credit rule, and the friend pass is told to vary credits", () => {
  assert.ok(PULSE_FACT_RULES.includes(ATTRIBUTION_RULE));
  assert.match(ATTRIBUTION_RULE, /Never say "Wikipedia"/);
  assert.match(friendPassPrompt(), /reword the later one/);
});

test("the shared sound-aloud check sends credits back in Shorts and rankings, and leaves documentaries to the pipeline", () => {
  assert.match(
    writingProblems(
      "According to Wikipedia, GTA 6 costs $80. You'll pay it.",
    ).join(" "),
    /never say Wikipedia/,
  );
  assert.match(
    writingProblems("Kotaku says it's $80. Kotaku says it's out in May.").join(
      " ",
    ),
    /comes twice within a minute/,
  );
  assert.deepEqual(
    writingProblems("According to Wikipedia, GTA 6 costs $80.", {
      long: true,
      attributions: false,
    }).filter((x) => /Wikipedia|credit/.test(x)),
    [],
  );
});

test("the friend pass may reword a repeated credit but never drop the only one, nor a rumor's label", () => {
  const before =
    "According to Kotaku, the price is $80. According to Kotaku, it ships in May.";
  assert.deepEqual(
    factDrift(
      before,
      "Kotaku says the price is $80. It ships in May, per the same report from Kotaku.",
    ).filter((x) => /attribution/.test(x)),
    [],
  );
  assert.match(
    factDrift(before, "The price is $80. It ships in May, Kotaku hears.").join(
      " ",
    ),
    /drops an attribution/,
  );
});

// ---------------------------------------------------------------- documentaries

const cited: WikiArticle = {
  title: "Grand Theft Auto VI",
  url: "https://en.wikipedia.org/wiki/Grand_Theft_Auto_VI",
  text: `The first trailer drew 90 million views in a day.${refMark(1)} Rockstar confirmed development in February 2022.${refMark(2)}\n\n[IGN] GTA 6 Trailer Breaks Records ${refMark(1)}\nThe GTA 6 trailer drew 90 million views in its first day, a record.`,
  refs: [
    {
      n: 1,
      outlet: "IGN",
      title: "GTA 6 Trailer Breaks Records",
      url: "https://www.ign.com/x",
      date: "2023-12-06",
    },
    {
      n: 2,
      outlet: "Rockstar Games",
      title: "A Message",
      url: "https://www.rockstargames.com/y",
    },
  ],
  primaries: [
    {
      n: 1,
      outlet: "IGN",
      title: "GTA 6 Trailer Breaks Records",
      url: "https://www.ign.com/x",
      chars: 70,
    },
  ],
};

test("a source card credits the originals, never Wikipedia, when the notes are cited", () => {
  assert.equal(
    sourceCredit("The first trailer drew 90 million views in a day", cited),
    "Summarised from IGN",
  );
  assert.equal(
    sourceCredit(
      "The GTA 6 trailer drew 90 million views in its first day",
      cited,
    ),
    "IGN: GTA 6 Trailer Breaks Records",
  );
  assert.equal(
    evidenceCredit(cited, "Sam Houser"),
    "Sam Houser, on the record",
  );
  assert.equal(
    evidenceCredit(
      cited,
      undefined,
      "Rockstar confirmed development in February 2022",
    ),
    "From the record: Summarised from Rockstar Games",
  );
  // Plain notes (PRIMARY_SOURCES off) keep the old credits.
  assert.equal(
    sourceCredit("a game", {
      title: "Halo 3",
      url: "",
      text: "Halo 3 is a game.",
    }),
    "Wikipedia: Halo 3",
  );
});

test("a documentary's description and source line credit the originals it read", () => {
  const d = {
    chapters: [
      { source: cited },
      {
        source: {
          title: "B",
          url: "https://en.wikipedia.org/wiki/B",
          text: "b",
        },
      },
    ],
  } as any;
  assert.deepEqual(docSources(d), [
    "https://www.ign.com/x",
    "https://www.rockstargames.com/y",
  ]);
  assert.equal(docAttribution(d), "Sources: IGN, Rockstar Games / Pulse");
  const plain = {
    chapters: [
      {
        source: {
          title: "B",
          url: "https://en.wikipedia.org/wiki/B",
          text: "b",
        },
      },
    ],
  } as any;
  assert.deepEqual(docSources(plain), ["https://en.wikipedia.org/wiki/B"]);
});

test("a mark copied into a graphic never reaches the screen, and an outlet the marks name grounds a headline", () => {
  const m = (graphic: DocMoment["graphic"]): DocMoment => ({
    show: "x",
    keywords: [],
    broll: "",
    emphasis: "",
    person: "",
    graphic,
  });
  const none = m({ kind: "none", primary: "", secondary: "", items: [] });
  const out = groundDocMoments(
    [
      none,
      m({
        kind: "stat",
        primary: `90 million${refMark(1)}`,
        secondary: "trailer views",
        items: [],
      }),
      none,
      m({
        kind: "headline",
        primary: "GTA 6 trailer breaks view records",
        secondary: "IGN, 2023",
        items: [],
      }),
    ],
    cited,
  );
  assert.equal(out.moments[1]!.graphic.primary, "90 million");
  assert.equal(out.moments[3]!.graphic.kind, "headline");
});
