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
