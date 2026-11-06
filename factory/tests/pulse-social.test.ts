import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatLook,
  creditLine,
  fitsPulseChat,
  fitsPulseMail,
  fitsPulseSocial,
  initialsOf,
  mailLook,
  quoteCredit,
  quoteText,
  socialLook,
} from "../src/render/components/packs/pulse/socialCredit.ts";
import { mailSubject } from "../src/render/components/packs/pulse/PulseMail.tsx";
import { STYLES } from "../src/render/components/packs/pulse/social.ts";
import { inEra } from "../src/render/components/packs/types.ts";

const Q =
  "We always wanted the city to feel alive, like it carried on without you.";
const quote = (secondary: string, primary = Q) =>
  ({ kind: "quote", primary, secondary, items: [] }) as never;
const which = (secondary: string, primary = Q) =>
  [
    fitsPulseSocial(quote(secondary, primary)) && "social",
    fitsPulseMail(quote(secondary, primary)) && "mail",
    fitsPulseChat(quote(secondary, primary)) && "chat",
  ].filter(Boolean);

test("a quote's credit gives its speaker, its medium and its year, nothing else", () => {
  assert.deepEqual(quoteCredit("Leslie Benzies, on Twitter, 2013"), {
    speaker: "Leslie Benzies",
    medium: "on Twitter",
    year: 2013,
    kind: "social",
    hint: "feed",
    floor: 2010,
  });
  const mail = quoteCredit(
    "Dan Houser, Rockstar co-founder, in an internal email, 2003",
  );
  assert.equal(mail.speaker, "Dan Houser");
  assert.equal(mail.kind, "mail");
  assert.equal(creditLine(mail), "Dan Houser, in an internal email, 2003");
  const chat = quoteCredit("a Rockstar developer, in a Slack message, 2022");
  assert.equal(chat.kind, "chat");
  assert.equal(chat.hint, "team");
  assert.equal(
    creditLine(chat),
    "a Rockstar developer, in a Slack message, 2022",
  );
  const forum = quoteCredit("Sam Houser, on the Rockstar forums, 2004");
  assert.equal(forum.kind, "social");
  assert.equal(forum.hint, "boards");
  // A year inside the medium is not shown twice; a credit with no comma is split at the preposition.
  assert.equal(
    creditLine(quoteCredit("Dan Houser, in a 2001 memo")),
    "Dan Houser, in a 2001 memo",
  );
  assert.equal(quoteCredit("Dan Houser, in a 2001 memo").year, 2001);
  const bare = quoteCredit("Leslie Benzies on Twitter");
  assert.equal(bare.speaker, "Leslie Benzies");
  assert.equal(bare.medium, "on Twitter");
});

test("each style fits only a quote whose credit names its medium", () => {
  assert.deepEqual(which("Leslie Benzies, on Twitter, 2013"), ["social"]);
  assert.deepEqual(which("Leslie Benzies, tweet, 2013"), ["social"]);
  assert.deepEqual(which("Sam Houser, on the Rockstar forums, 2004"), [
    "social",
  ]);
  assert.deepEqual(which("Aaron Garbut, posted on ResetEra, 2019"), ["social"]);
  assert.deepEqual(which("Obbe Vermeij, on his blog, 2021"), ["social"]);
  assert.deepEqual(which("a fan, in a Usenet post, 1998"), ["social"]);
  assert.deepEqual(which("Leslie Benzies, on X, 2024"), ["social"]);
  assert.deepEqual(which("Dan Houser, in an internal email, 2003"), ["mail"]);
  assert.deepEqual(which("Dan Houser, in an internal memo, 2001"), ["mail"]);
  assert.deepEqual(which("Sam Houser, in a letter to staff, 1999"), ["mail"]);
  assert.deepEqual(which("a Rockstar developer, in a Slack message, 2022"), [
    "chat",
  ]);
  assert.deepEqual(which("Imran Sarwar, in a text message, 2015"), ["chat"]);
  assert.deepEqual(which("a DMA Design programmer, on IRC, 1997"), ["chat"]);
  // The stronger medium wins: a DM on Twitter is a chat, an email posted on a forum is an email.
  assert.deepEqual(
    which("Leslie Benzies, in a direct message on Twitter, 2014"),
    ["chat"],
  );
  assert.deepEqual(which("Dan Houser, in an email posted on ResetEra, 2018"), [
    "mail",
  ]);
});

test("an interview, an outlet or a company is never drawn as a post, an email or a chat", () => {
  for (const credit of [
    "Dan Houser, producer, GameSpot, 2002",
    "Dan Houser, Rockstar co-founder",
    "Dan Houser, in an interview with IGN, 2004",
    "Leslie Benzies, The Washington Post, 2013",
    "Dan Houser, the Daily Mail, 2008",
    "Mark Zuckerberg, Facebook CEO, 2016",
    "Jack Dorsey, Twitter co-founder",
    "Sam Houser, at the Develop forum, 2005",
    "Dan Houser, in a chat with Edge, 2008",
    "Lazlow, on his radio show, 2004",
    "Leslie Benzies, in a video posted to YouTube, 2016",
    "Dan Houser, in a letter to Edge magazine, 2007",
    "Rockstar Games, in a statement, 2018",
    "Imran Sarwar, in the patch notes, 2015",
    "Dan Houser, fireside chat, 2012",
    "Strauss Zelnick, earnings call, 2019",
    "Dan Houser, in a message to fans, 2011",
    "2013",
    "",
  ])
    assert.deepEqual(which(credit), [], credit);
  // Only quotes: a headline credited to Twitter is not a post.
  assert.equal(
    fitsPulseSocial({
      kind: "headline",
      primary: Q,
      secondary: "Leslie Benzies, on Twitter, 2013",
      items: [],
    } as never),
    false,
  );
});

test("each look takes only a quote of a length it can hold", () => {
  const words = (n: number) =>
    Array.from({ length: n }, (_, i) => `word${i % 9}`).join(" ");
  assert.equal(
    fitsPulseSocial(quote("Leslie Benzies, on Twitter, 2013", "Too short")),
    false,
  );
  assert.equal(
    fitsPulseSocial(quote("Leslie Benzies, on Twitter, 2013", words(55))),
    true,
  );
  assert.equal(
    fitsPulseSocial(quote("Leslie Benzies, on Twitter, 2013", words(61))),
    false,
  );
  assert.equal(
    fitsPulseMail(quote("Dan Houser, in an email, 2003", words(70))),
    true,
  );
  assert.equal(
    fitsPulseMail(quote("Dan Houser, in an email, 2003", words(71))),
    false,
  );
  assert.equal(
    fitsPulseChat(quote("a developer, in a Slack message, 2022", "Ship it")),
    true,
  );
  assert.equal(
    fitsPulseChat(quote("a developer, in a Slack message, 2022", words(35))),
    true,
  );
  assert.equal(
    fitsPulseChat(quote("a developer, in a Slack message, 2022", words(41))),
    false,
  );
  // A speaker's name too long for the name line is refused.
  assert.equal(
    fitsPulseChat(
      quote(
        "The head of the technical art group at the Edinburgh studio, in a Slack message, 2022",
      ),
    ),
    false,
  );
  assert.equal(quoteText('"Ship it."'), "Ship it.");
});

test("each style draws the look of the story's year, or the one its medium names", () => {
  const plain = {};
  assert.deepEqual(
    [1996, 2004, 2013].map((y) => socialLook(y, plain)),
    ["groups", "boards", "feed"],
  );
  // A newsgroup is always the reader, a forum always the board, a tweet always the feed.
  assert.equal(
    socialLook(2006, quoteCredit("a fan, on Usenet, 2006")),
    "groups",
  );
  assert.equal(
    socialLook(2019, quoteCredit("Aaron Garbut, on ResetEra, 2019")),
    "boards",
  );
  assert.equal(
    socialLook(2008, quoteCredit("Leslie Benzies, on Twitter")),
    "feed",
  );
  // A blog of 1998 cannot be a newsgroup.
  assert.equal(
    socialLook(1998, quoteCredit("Obbe Vermeij, on his blog")),
    "boards",
  );
  assert.deepEqual([1999, 2004, 2005, 2020].map(mailLook), [
    "desktop",
    "desktop",
    "webmail",
    "webmail",
  ]);
  const c = (s: string) => quoteCredit(s);
  assert.equal(chatLook(1996, c("a developer, in a chat log, 1996")), "relay");
  assert.equal(
    chatLook(2004, c("a developer, in an instant message, 2004")),
    "messenger",
  );
  assert.equal(
    chatLook(2004, c("a DMA Design programmer, on IRC, 2004")),
    "relay",
  );
  assert.equal(
    chatLook(2022, c("a developer, in a Slack message, 2022")),
    "team",
  );
  assert.equal(
    chatLook(2015, c("Imran Sarwar, in a text message, 2015")),
    "phone",
  );
  assert.equal(chatLook(2012, c("a developer, on Discord")), "team");
  assert.equal(chatLook(2016, c("a developer, in a group chat"), 0), "team");
  assert.equal(chatLook(2016, c("a developer, in a group chat"), 1), "phone");
});

test("the email shows no invented subject, and avatars use the speaker's initials", () => {
  assert.equal(
    mailSubject(quoteCredit("Dan Houser, in an internal email, 2003")),
    "(internal)",
  );
  assert.equal(mailSubject(quoteCredit("Dan Houser, in an email, 2003")), "");
  assert.equal(initialsOf("Leslie Benzies"), "LB");
  assert.equal(initialsOf("a Rockstar developer"), "RD");
});

test("the social area's styles are quotes inside their eras", () => {
  assert.deepEqual(Object.keys(STYLES), [
    "PulseSocial",
    "PulseMail",
    "PulseChat",
  ]);
  for (const s of Object.values(STYLES)) {
    assert.equal(s.kind, "quote");
    assert.equal(inEra(s, 1980), false);
    assert.equal(inEra(s, 1998), true);
    assert.equal(inEra(s, 2024), true);
  }
});
