/*
  Generate branded intro/outro bumpers for Pulse Gaming videos.
  Run once — bumpers are cached and reused for every video.

  Intro (1.5s): Deep charcoal → amber flash → "PULSE GAMING" text fade in
  Outro (1.5s): "PULSE GAMING" + "FOLLOW FOR DAILY LEAKS" → fade to charcoal
*/

const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);
const brand = require('../brand');

const BUMPER_DIR = path.join(__dirname, '..', 'output', 'bumpers');
const INTRO_PATH = path.join(BUMPER_DIR, 'intro.mp4');
const OUTRO_PATH = path.join(BUMPER_DIR, 'outro.mp4');

const fontOpt = process.platform === 'win32' ? "font='Arial'" : "font='DejaVu Sans'";

async function hasAudioStream(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -select_streams a -show_entries stream=codec_type -of csv=p=0 "${filePath}"`,
      { timeout: 5000 }
    );
    return stdout.trim().length > 0;
  } catch { return false; }
}

async function generateIntroBumper() {
  if (await fs.pathExists(INTRO_PATH)) {
    // Regenerate if bumper has no audio (concat breaks without it)
    if (await hasAudioStream(INTRO_PATH)) {
      console.log('[bumpers] Intro already exists, skipping');
      return INTRO_PATH;
    }
    console.log('[bumpers] Intro missing audio track, regenerating...');
    await fs.remove(INTRO_PATH);
  }

  console.log('[bumpers] Generating intro bumper (1.5s)...');
  await fs.ensureDir(BUMPER_DIR);

  // 1.5s clip: charcoal background, amber accent line sweeps in, channel name fades in
  const filter = [
    // Solid charcoal background
    `color=c=0x0D0D0F:s=1080x1920:d=1.5:r=30,format=yuv420p`,
    // Amber accent line (horizontal, centre)
    `drawbox=x=0:y=935:w=iw:h=4:color=${brand.PRIMARY_FFM}@0.9:t=fill:enable='gte(t\\,0.3)'`,
    // Channel name — centred, fades in
    `drawtext=text='PULSE GAMING':${fontOpt}:fontcolor=${brand.TEXT_FFM}:fontsize=72:` +
      `x=(w-tw)/2:y=(h-th)/2-30:alpha='if(lt(t\\,0.4)\\,0\\,min((t-0.4)*3\\,1))'`,
    // Tagline below
    `drawtext=text='VERIFIED LEAKS. EVERY DAY.':${fontOpt}:fontcolor=${brand.PRIMARY_FFM}:fontsize=28:` +
      `x=(w-tw)/2:y=(h/2)+40:alpha='if(lt(t\\,0.6)\\,0\\,min((t-0.6)*3\\,1))'`,
  ].join(',\n');

  // Include silent audio so concat demuxer works with main video (which has audio)
  const cmd = `ffmpeg -y -f lavfi -i "${filter}" -f lavfi -i anullsrc=r=44100:cl=stereo -c:v libx264 -crf 18 -preset medium -r 30 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -t 1.5 "${INTRO_PATH}"`;

  await execAsync(cmd, { timeout: 30000 });
  console.log(`[bumpers] Intro saved: ${INTRO_PATH}`);
  return INTRO_PATH;
}

async function generateOutroBumper() {
  if (await fs.pathExists(OUTRO_PATH)) {
    if (await hasAudioStream(OUTRO_PATH)) {
      console.log('[bumpers] Outro already exists, skipping');
      return OUTRO_PATH;
    }
    console.log('[bumpers] Outro missing audio track, regenerating...');
    await fs.remove(OUTRO_PATH);
  }

  console.log('[bumpers] Generating outro bumper (1.5s)...');
  await fs.ensureDir(BUMPER_DIR);

  // 1.5s clip: channel name visible, CTA text, fades to charcoal
  const filter = [
    `color=c=0x0D0D0F:s=1080x1920:d=1.5:r=30,format=yuv420p`,
    // Amber accent line
    `drawbox=x=0:y=935:w=iw:h=4:color=${brand.PRIMARY_FFM}@0.9:t=fill`,
    // Channel name — centred, fades out at end
    `drawtext=text='PULSE GAMING':${fontOpt}:fontcolor=${brand.TEXT_FFM}:fontsize=72:` +
      `x=(w-tw)/2:y=(h-th)/2-30:alpha='if(gt(t\\,1.0)\\,max(1-(t-1.0)*3\\,0)\\,1)'`,
    // CTA below — fades out
    `drawtext=text='FOLLOW FOR DAILY LEAKS':${fontOpt}:fontcolor=${brand.PRIMARY_FFM}:fontsize=32:` +
      `x=(w-tw)/2:y=(h/2)+40:alpha='if(gt(t\\,1.0)\\,max(1-(t-1.0)*3\\,0)\\,1)'`,
  ].join(',\n');

  // Include silent audio so concat demuxer works with main video (which has audio)
  const cmd = `ffmpeg -y -f lavfi -i "${filter}" -f lavfi -i anullsrc=r=44100:cl=stereo -c:v libx264 -crf 18 -preset medium -r 30 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -t 1.5 "${OUTRO_PATH}"`;

  await execAsync(cmd, { timeout: 30000 });
  console.log(`[bumpers] Outro saved: ${OUTRO_PATH}`);
  return OUTRO_PATH;
}

async function ensureBumpers() {
  const intro = await generateIntroBumper();
  const outro = await generateOutroBumper();
  return { intro, outro };
}

module.exports = { ensureBumpers, INTRO_PATH, OUTRO_PATH };

if (require.main === module) {
  ensureBumpers()
    .then(() => console.log('[bumpers] Done'))
    .catch(err => {
      console.error(`[bumpers] ERROR: ${err.message}`);
      process.exit(1);
    });
}
