import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gameplayTitleFits,
  isoSeconds,
  gameplayCredit,
} from "../src/assets/gameplay.ts";
import { footageCredits } from "../src/pipeline.ts";
import { goodScript } from "./helpers.ts";

test("gameplay titles: the game itself, gameplay not commentary videos", () => {
  assert.equal(
    gameplayTitleFits(
      "Call of Duty 4: Modern Warfare Campaign - Act I - Night Vision Mission",
      "Call of Duty 4: Modern Warfare",
      "Call of Duty",
    ),
    true,
  );
  assert.equal(
    gameplayTitleFits(
      "Call of Duty Black Ops 6 Review",
      "Call of Duty: Black Ops 6",
      "Call of Duty",
    ),
    false,
  );
  assert.equal(
    gameplayTitleFits(
      "Grand Theft Auto Vice City #02 [GamePlay Only]",
      "Grand Theft Auto: Vice City",
      "Grand Theft Auto",
    ),
    true,
  );
  assert.equal(
    gameplayTitleFits(
      "GTA Vice City trailer",
      "Grand Theft Auto: Vice City",
      "Grand Theft Auto",
    ),
    false,
  );
  assert.equal(
    gameplayTitleFits(
      "Grand Theft Auto 2 gameplay",
      "Grand Theft Auto",
      "Grand Theft Auto",
    ),
    false,
  );
});

test("durations and credits", () => {
  assert.equal(isoSeconds("PT1H2M3S"), 3723);
  assert.equal(isoSeconds("PT9M"), 540);
  assert.equal(
    gameplayCredit({ channelTitle: "UnseeableNinja", kind: "cc" }),
    "GAMEPLAY: UNSEEABLENINJA / CC BY",
  );
  const desc = footageCredits(
    goodScript({
      entries: [
        {
          rank: 1,
          game_title: "Call of Duty 4",
          steam_search_term: "",
          year: 2007,
          platforms: "PC",
        },
      ],
    }),
    [
      {
        provenance:
          'Gameplay "Night Vision" by UnseeableNinja, Creative Commons Attribution licence (CC BY) (https://www.youtube.com/watch?v=abc), 4.8s at 12.0s of the downloaded section, muted',
      },
    ],
    undefined,
    undefined,
    "x",
  );
  assert.match(
    desc,
    /Gameplay: UnseeableNinja, licensed CC BY \(https:\/\/www\.youtube\.com\/watch\?v=abc\)\./,
  );
});

import { scopeOf } from "../src/pipeline.ts";
import { NOT_CAMPAIGN } from "../src/assets/clipscore.ts";

test("a campaign ranking keeps multiplayer out of every pick", () => {
  assert.equal(scopeOf(goodScript({ headline: "Call of Duty Campaigns Ranked", criterion: "strength of the single-player story" })), "campaign");
  assert.equal(scopeOf(goodScript({ headline: "GTA 6 delayed" })), undefined);
  assert.ok(NOT_CAMPAIGN.test("Multiplayer Reveal Trailer"));
  assert.ok(NOT_CAMPAIGN.test("Season 1 Battle Pass"));
  assert.ok(NOT_CAMPAIGN.test("Zombies Gameplay Trailer"));
  assert.ok(!NOT_CAMPAIGN.test("Campaign Launch Trailer"));
});

import { namedThings } from "../src/assets/gameplay.ts";

test("named missions are found in the shot list, missions first, the game's own name never", () => {
  const t = (key: string, text: string, keywords: string[]) => ({ key, text, want: "gameplay" as const, energy: "medium" as const, keywords });
  const named = namedThings([
    t("beat:9#m2", "Price leads the squad (show: Captain Price briefing)", ["Captain Price", "briefing"]),
    t("beat:9#m1", "The crawl through Pripyat (show: All Ghillied Up mission in ghillie suits)", ["All Ghillied Up", "ghillie suit", "Modern Warfare"]),
  ], "Call of Duty 4: Modern Warfare", "Call of Duty");
  assert.deepEqual(named.map((n) => n.name), ["All Ghillied Up", "Captain Price"]);
  assert.deepEqual(named[0]!.keys, ["beat:9#m1"]);
});
