// The fixed drafts the room's critic snapshot is taken on: three drafts, then one edited draft alone (the re-read).
export const ROOM_SNAPSHOT_DRAFTS: Array<
  Array<{ label: string; title: string; narration: string }>
> = [
  [
    {
      label: "A",
      title: "  Hollow Knight Silksong's price is the twist ",
      narration:
        "Team Cherry priced Silksong at $20. [pause] That's the same as the first game, eight years on.\n\nPublishers hate it. I love it.",
    },
    {
      label: "B",
      title: "Silksong costs less than you think",
      narration: "Silksong is $20.   Why? Team Cherry said it simply: \"we just want people to play it.\"",
    },
    {
      label: "C",
      title: "The $20 game that embarrassed a $70 industry",
      narration: "Every big publisher says games cost more to make. Then a three-person studio shipped Silksong at $20.",
    },
  ],
  [
    {
      label: "A",
      title: "Hollow Knight Silksong's price is the twist",
      narration: "Team Cherry priced Silksong at $20, the same as the first game. I think that's the bravest call this year.",
    },
  ],
];
