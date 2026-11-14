// The channel's top 100 games for the vault's seed (14 Nov 2026): every game named in a Pulse episode, ranked by how
// often it appears (stories, ranking entries, fact sheets), the non-games dropped, each series completed where a
// ranking already covered it. `wiki` is the Wikipedia page to read for citations when the name is ambiguous; `steam`
// is false for a game with no Steam release.

export interface SeedGame {
  name: string;
  wiki?: string;
  steam?: string | false;
  aliases?: string[];
}

export const SEED_GAMES: SeedGame[] = [
  // Grand Theft Auto and Rockstar
  { name: "Grand Theft Auto VI", steam: false, aliases: ["GTA 6", "GTA VI"] },
  { name: "Grand Theft Auto V", aliases: ["GTA 5", "GTA V"] },
  { name: "Grand Theft Auto IV", aliases: ["GTA 4", "GTA IV"] },
  { name: "Grand Theft Auto: San Andreas", aliases: ["GTA San Andreas"] },
  { name: "Grand Theft Auto: Vice City", aliases: ["GTA Vice City"] },
  { name: "Grand Theft Auto III", aliases: ["GTA 3", "GTA III"] },
  {
    name: "Grand Theft Auto",
    wiki: "Grand Theft Auto (video game)",
    steam: false,
  },
  { name: "Grand Theft Auto 2", steam: false, aliases: ["GTA 2"] },
  { name: "Grand Theft Auto: Liberty City Stories", steam: false },
  { name: "Grand Theft Auto: Vice City Stories", steam: false },
  { name: "Grand Theft Auto: Chinatown Wars", steam: false },
  { name: "Grand Theft Auto Online", steam: false, aliases: ["GTA Online"] },
  { name: "Red Dead Redemption", wiki: "Red Dead Redemption" },
  { name: "Red Dead Redemption 2" },
  // Call of Duty: the Modern Warfare line and neighbours
  { name: "Call of Duty 4: Modern Warfare", aliases: ["CoD 4"] },
  {
    name: "Call of Duty: Modern Warfare 2",
    wiki: "Call of Duty: Modern Warfare 2",
  },
  {
    name: "Call of Duty: Modern Warfare 3",
    wiki: "Call of Duty: Modern Warfare 3",
  },
  {
    name: "Call of Duty: Modern Warfare",
    wiki: "Call of Duty: Modern Warfare (2019 video game)",
    aliases: ["Modern Warfare 2019"],
  },
  {
    name: "Call of Duty: Modern Warfare II",
    wiki: "Call of Duty: Modern Warfare II (2022 video game)",
    aliases: ["MWII"],
  },
  {
    name: "Call of Duty: Modern Warfare III",
    wiki: "Call of Duty: Modern Warfare III",
    aliases: ["MWIII"],
  },
  { name: "Call of Duty: Black Ops" },
  { name: "Call of Duty: Black Ops II" },
  { name: "Call of Duty: World at War" },
  { name: "Call of Duty: Black Ops III" },
  // Fallout: every entry the rankings cover, spin-offs included
  {
    name: "Fallout",
    wiki: "Fallout (video game)",
    steam: "Fallout: A Post Nuclear Role Playing Game",
    aliases: ["Fallout 1", "Fallout: A Post Nuclear Role Playing Game"],
  },
  { name: "Fallout 2", steam: "Fallout 2: A Post Nuclear Role Playing Game" },
  {
    name: "Fallout Tactics: Brotherhood of Steel",
    aliases: ["Fallout Tactics"],
  },
  {
    name: "Fallout: Brotherhood of Steel",
    steam: false,
    aliases: ["Brotherhood of Steel"],
  },
  { name: "Fallout 3" },
  { name: "Fallout: New Vegas", aliases: ["New Vegas"] },
  { name: "Fallout Shelter" },
  { name: "Fallout 4" },
  { name: "Fallout 76" },
  // Halo
  { name: "Halo: Combat Evolved", aliases: ["Halo CE"] },
  { name: "Halo 2" },
  { name: "Halo 3" },
  { name: "Halo 3: ODST", aliases: ["ODST"] },
  { name: "Halo: Reach" },
  { name: "Halo 4" },
  { name: "Halo 5: Guardians", steam: false, aliases: ["Halo 5"] },
  { name: "Halo Infinite" },
  { name: "Halo Wars" },
  { name: "Halo Wars 2" },
  // Doom
  {
    name: "Doom",
    wiki: "Doom (1993 video game)",
    steam: "DOOM (1993)",
    aliases: ["Doom 1993"],
  },
  { name: "Doom II", aliases: ["Doom 2"] },
  { name: "Doom 64" },
  { name: "Doom 3" },
  {
    name: "Doom (2016)",
    wiki: "Doom (2016 video game)",
    steam: "DOOM",
    aliases: ["Doom 2016"],
  },
  { name: "Doom Eternal" },
  { name: "Doom: The Dark Ages", aliases: ["DOOM The Dark Ages"] },
  { name: "Final Doom" },
  // 3D Mario
  { name: "Super Mario 64", steam: false },
  { name: "Super Mario Sunshine", steam: false },
  { name: "Super Mario Galaxy", steam: false },
  { name: "Super Mario Galaxy 2", steam: false },
  { name: "Super Mario 3D Land", steam: false },
  { name: "Super Mario 3D World", steam: false, aliases: ["Bowser's Fury"] },
  { name: "Super Mario Odyssey", steam: false },
  // Zelda
  {
    name: "The Legend of Zelda: Ocarina of Time",
    steam: false,
    aliases: ["Ocarina of Time"],
  },
  {
    name: "The Legend of Zelda: Majora's Mask",
    steam: false,
    aliases: ["Majora's Mask"],
  },
  {
    name: "The Legend of Zelda: The Wind Waker",
    steam: false,
    aliases: ["The Wind Waker", "Wind Waker"],
  },
  {
    name: "The Legend of Zelda: Twilight Princess",
    steam: false,
    aliases: ["Twilight Princess"],
  },
  {
    name: "The Legend of Zelda: Skyward Sword",
    steam: false,
    aliases: ["Skyward Sword"],
  },
  {
    name: "The Legend of Zelda: Breath of the Wild",
    steam: false,
    aliases: ["Breath of the Wild"],
  },
  {
    name: "The Legend of Zelda: Tears of the Kingdom",
    steam: false,
    aliases: ["Tears of the Kingdom"],
  },
  // Street Fighter
  { name: "Street Fighter II", steam: false },
  { name: "Street Fighter III", steam: false },
  { name: "Street Fighter IV" },
  { name: "Street Fighter V" },
  { name: "Street Fighter 6" },
  // Resident Evil
  {
    name: "Resident Evil",
    wiki: "Resident Evil (1996 video game)",
    steam: false,
    aliases: ["Resident Evil 1996"],
  },
  {
    name: "Resident Evil 4",
    wiki: "Resident Evil 4 (2023 video game)",
    aliases: ["Resident Evil 4 Remake"],
  },
  { name: "Resident Evil 5" },
  { name: "Resident Evil 6" },
  { name: "Resident Evil 7: Biohazard", aliases: ["Resident Evil 7"] },
  { name: "Resident Evil Village" },
  { name: "Resident Evil Requiem" },
  // The channel's other most-covered games
  { name: "Cyberpunk 2077" },
  {
    name: "Final Fantasy XIV",
    steam: "FINAL FANTASY XIV Online",
    aliases: ["FFXIV", "Final Fantasy XIV: A Realm Reborn"],
  },
  { name: "No Man's Sky" },
  {
    name: "The Elder Scrolls V: Skyrim",
    steam: "The Elder Scrolls V: Skyrim Special Edition",
    aliases: ["Skyrim"],
  },
  { name: "Elden Ring" },
  { name: "BioShock", steam: false },
  { name: "BioShock Infinite" },
  { name: "Mass Effect", wiki: "Mass Effect (video game)", steam: false },
  { name: "Hollow Knight: Silksong", aliases: ["Silksong"] },
  { name: "Minecraft", steam: false },
  { name: "Hogwarts Legacy" },
  { name: "Clair Obscur: Expedition 33", aliases: ["Expedition 33"] },
  { name: "Phantom Blade Zero" },
  { name: "Borderlands 2" },
  { name: "Assassin's Creed II", aliases: ["Assassin's Creed 2"] },
  { name: "Dark Souls III", aliases: ["Dark Souls 3"] },
  {
    name: "Metal Gear Solid",
    wiki: "Metal Gear Solid (1998 video game)",
    steam: false,
  },
  { name: "Silent Hill 2", wiki: "Silent Hill 2", steam: false },
  { name: "Diablo II", steam: false, aliases: ["Diablo 2"] },
  { name: "Burnout 3: Takedown", steam: false, aliases: ["Burnout 3"] },
  { name: "Battlefield 6" },
  { name: "Dragon's Dogma 2" },
  {
    name: "Pokémon Scarlet and Violet",
    steam: false,
    aliases: ["Pokemon Scarlet and Violet"],
  },
];
