const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');

const TRIVIA_QUESTIONS = [
  { q: 'What year was the original PlayStation released in Japan?', options: ['1993', '1994', '1995', '1996'], answer: 1 },
  { q: 'Which company developed the original Doom (1993)?', options: ['Epic Games', 'id Software', '3D Realms', 'Valve'], answer: 1 },
  { q: 'What is the best-selling video game console of all time?', options: ['Nintendo DS', 'PlayStation 2', 'Nintendo Switch', 'Game Boy'], answer: 1 },
  { q: 'In what year did Minecraft officially release?', options: ['2009', '2010', '2011', '2012'], answer: 2 },
  { q: 'Which game featured the first ever "loot box" system?', options: ['Team Fortress 2', 'FIFA 09', 'MapleStory', 'ZT Online'], answer: 3 },
  { q: 'What was Sega\'s final home console?', options: ['Sega Saturn', 'Sega Genesis', 'Sega Dreamcast', 'Sega Master System'], answer: 2 },
  { q: 'Who created the Mario franchise?', options: ['Satoru Iwata', 'Shigeru Miyamoto', 'Hideo Kojima', 'Gunpei Yokoi'], answer: 1 },
  { q: 'What year was the Xbox 360 released?', options: ['2004', '2005', '2006', '2007'], answer: 1 },
  { q: 'Which game holds the record for most concurrent players on Steam?', options: ['Dota 2', 'PUBG', 'Counter-Strike 2', 'Palworld'], answer: 2 },
  { q: 'What was the first commercially sold video game?', options: ['Pong', 'Computer Space', 'Spacewar!', 'Tennis for Two'], answer: 1 },
  { q: 'Which studio developed The Witcher 3: Wild Hunt?', options: ['BioWare', 'Bethesda', 'CD Projekt Red', 'Obsidian'], answer: 2 },
  { q: 'How many copies did GTA V sell in its first 24 hours?', options: ['5 million', '8 million', '11 million', '15 million'], answer: 2 },
  { q: 'What was the code name for the Nintendo 64 during development?', options: ['Project Reality', 'Ultra 64', 'Project Dolphin', 'Project Revolution'], answer: 0 },
  { q: 'Which game popularised the battle royale genre?', options: ['H1Z1', 'PUBG', 'Fortnite', 'Apex Legends'], answer: 1 },
  { q: 'What year was the first The Legend of Zelda game released?', options: ['1985', '1986', '1987', '1988'], answer: 1 },
  { q: 'Which company originally developed Halo: Combat Evolved?', options: ['343 Industries', 'Bungie', 'Epic Games', 'Rare'], answer: 1 },
  { q: 'What is the name of the main character in the Metroid series?', options: ['Samus Aran', 'Lara Croft', 'Bayonetta', 'Joanna Dark'], answer: 0 },
  { q: 'Which console launched with Wii Sports as a pack-in title?', options: ['Wii U', 'Nintendo Wii', 'Nintendo Switch', 'GameCube'], answer: 1 },
  { q: 'What year did Fortnite Battle Royale launch?', options: ['2016', '2017', '2018', '2019'], answer: 1 },
  { q: 'Who is the antagonist in the original BioShock?', options: ['Atlas', 'Andrew Ryan', 'Frank Fontaine', 'Sander Cohen'], answer: 2 },
  { q: 'What was the first game in the Final Fantasy series released outside Japan?', options: ['Final Fantasy I', 'Final Fantasy IV', 'Final Fantasy VI', 'Final Fantasy VII'], answer: 0 },
  { q: 'Which handheld console featured a stereoscopic 3D screen without glasses?', options: ['PS Vita', 'Nintendo 3DS', 'Game Boy Advance', 'Sega Game Gear'], answer: 1 },
  { q: 'What studio created Dark Souls?', options: ['FromSoftware', 'Capcom', 'Konami', 'Square Enix'], answer: 0 },
  { q: 'In what year was Valve\'s Steam platform launched?', options: ['2002', '2003', '2004', '2005'], answer: 1 },
  { q: 'What is the highest-grossing video game franchise of all time?', options: ['Mario', 'Pokemon', 'Call of Duty', 'Grand Theft Auto'], answer: 1 },
  { q: 'Which game was the first to feature a "New Game Plus" mode?', options: ['Chrono Trigger', 'Dark Souls', 'Resident Evil', 'The Legend of Zelda'], answer: 0 },
  { q: 'What year did the PlayStation 3 launch?', options: ['2005', '2006', '2007', '2008'], answer: 1 },
  { q: 'Who directed Metal Gear Solid?', options: ['Shinji Mikami', 'Hideo Kojima', 'Hidetaka Miyazaki', 'Yoko Taro'], answer: 1 },
  { q: 'What was the first 3D game in the Super Mario series?', options: ['Super Mario 64', 'Super Mario Sunshine', 'Super Mario Galaxy', 'Super Mario Land'], answer: 0 },
  { q: 'Which company published the original Tetris?', options: ['Nintendo', 'Sega', 'Atari', 'Elektronorgtechnica (Elorg)'], answer: 3 },
  { q: 'What animal is Sonic the Hedgehog\'s sidekick Tails?', options: ['Hedgehog', 'Fox', 'Echidna', 'Rabbit'], answer: 1 },
  { q: 'How many mainline Halo FPS games has 343 Industries developed?', options: ['1', '2', '3', '4'], answer: 2 },
  { q: 'Which game featured the "Konami Code" for the first time?', options: ['Contra', 'Gradius', 'Castlevania', 'Metal Gear'], answer: 1 },
  { q: 'What was Nintendo\'s first home console?', options: ['NES', 'Color TV-Game', 'Game & Watch', 'Famicom'], answer: 1 },
  { q: 'Which FromSoftware game won Game of the Year at The Game Awards 2022?', options: ['Sekiro', 'Dark Souls III', 'Elden Ring', 'Bloodborne'], answer: 2 },
  { q: 'What is the name of the protagonist in God of War (2018)?', options: ['Zeus', 'Kratos', 'Baldur', 'Atreus'], answer: 1 },
  { q: 'Which studio developed Red Dead Redemption 2?', options: ['Naughty Dog', 'Rockstar Games', 'Ubisoft', 'Insomniac'], answer: 1 },
  { q: 'What year did the Nintendo Switch launch?', options: ['2016', '2017', '2018', '2019'], answer: 1 },
  { q: 'Which game series features a character named "Master Chief"?', options: ['Gears of War', 'Halo', 'Doom', 'Destiny'], answer: 1 },
  { q: 'What was Atari\'s famous 1982 commercial failure?', options: ['Pac-Man', 'E.T. the Extra-Terrestrial', 'Pitfall!', 'Centipede'], answer: 1 },
  { q: 'Which PlayStation exclusive features a character named Aloy?', options: ['Ghost of Tsushima', 'Horizon Zero Dawn', 'Days Gone', 'Returnal'], answer: 1 },
  { q: 'What is the best-selling game on the Nintendo Switch?', options: ['Animal Crossing: New Horizons', 'Mario Kart 8 Deluxe', 'Zelda: BotW', 'Super Smash Bros. Ultimate'], answer: 1 },
  { q: 'Which company acquired Activision Blizzard in 2023?', options: ['Sony', 'Microsoft', 'Tencent', 'Amazon'], answer: 1 },
  { q: 'What year was the original Resident Evil released?', options: ['1995', '1996', '1997', '1998'], answer: 1 },
  { q: 'Which game is credited with popularising the "souls-like" genre?', options: ['Demon\'s Souls', 'Dark Souls', 'Bloodborne', 'King\'s Field'], answer: 1 },
  { q: 'What was the launch price of the PlayStation 3 (60GB model) in the US?', options: ['$399', '$499', '$599', '$699'], answer: 2 },
  { q: 'Which developer made Baldur\'s Gate 3?', options: ['BioWare', 'Obsidian', 'Larian Studios', 'inXile'], answer: 2 },
  { q: 'What is the name of Link\'s horse in Ocarina of Time?', options: ['Roach', 'Epona', 'Agro', 'Shadowfax'], answer: 1 },
  { q: 'Which game broke the record for fastest-selling entertainment product at launch in 2013?', options: ['Call of Duty: Ghosts', 'GTA V', 'The Last of Us', 'BioShock Infinite'], answer: 1 },
  { q: 'What year was Roblox released?', options: ['2004', '2006', '2008', '2010'], answer: 1 },
  { q: 'Which studio developed the Uncharted series?', options: ['Santa Monica Studio', 'Sucker Punch', 'Naughty Dog', 'Guerrilla Games'], answer: 2 },
  { q: 'What is the real name of the character "Snake" in Metal Gear Solid?', options: ['David', 'Jack', 'John', 'Adam'], answer: 0 },
  { q: 'Which game console used HD-DVD as its optical disc format?', options: ['PS3', 'Xbox 360 (add-on)', 'Wii', 'Dreamcast'], answer: 1 },
  { q: 'What year was League of Legends released?', options: ['2008', '2009', '2010', '2011'], answer: 1 },
];

const activeTrivia = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('Answer a random gaming trivia question for 50 XP!'),

  async execute(interaction) {
    const question = TRIVIA_QUESTIONS[Math.floor(Math.random() * TRIVIA_QUESTIONS.length)];
    const labels = ['A', 'B', 'C', 'D'];

    const embed = new EmbedBuilder()
      .setColor(config.COLOURS.AMBER)
      .setTitle('🎮 Gaming Trivia')
      .setDescription(`**${question.q}**\n\n${question.options.map((o, i) => `**${labels[i]}.** ${o}`).join('\n')}`)
      .setFooter({ text: 'You have 30 seconds to answer!' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      question.options.map((_, i) =>
        new ButtonBuilder()
          .setCustomId(`trivia_${i}`)
          .setLabel(labels[i])
          .setStyle(ButtonStyle.Secondary)
      )
    );

    const reply = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
    const answered = new Set();

    const collector = reply.createMessageComponentCollector({ time: 30_000 });

    collector.on('collect', async (btn) => {
      if (answered.has(btn.user.id)) {
        return btn.reply({ content: 'You already answered this question!', ephemeral: true });
      }
      answered.add(btn.user.id);

      const chosen = parseInt(btn.customId.split('_')[1], 10);
      if (chosen === question.answer) {
        // Award XP
        const xpManager = interaction.client.xpManager;
        if (xpManager) {
          xpManager.addXp(btn.user.id, config.XP.TRIVIA_BONUS);
        }
        await btn.reply({ content: `Correct! You earned **${config.XP.TRIVIA_BONUS} XP**! 🎉`, ephemeral: true });
      } else {
        await btn.reply({ content: `Wrong! The answer was **${labels[question.answer]}. ${question.options[question.answer]}**`, ephemeral: true });
      }
    });

    collector.on('end', async () => {
      const disabledRow = new ActionRowBuilder().addComponents(
        question.options.map((_, i) =>
          new ButtonBuilder()
            .setCustomId(`trivia_${i}`)
            .setLabel(labels[i])
            .setStyle(i === question.answer ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(true)
        )
      );

      const resultEmbed = new EmbedBuilder()
        .setColor(config.COLOURS.GREEN)
        .setTitle('🎮 Gaming Trivia - Time\'s Up!')
        .setDescription(`**${question.q}**\n\n✅ Correct answer: **${labels[question.answer]}. ${question.options[question.answer]}**\n\n${answered.size} player(s) answered.`)
        .setTimestamp();

      try {
        await reply.edit({ embeds: [resultEmbed], components: [disabledRow] });
      } catch (e) { /* message may have been deleted */ }
    });
  },
};
