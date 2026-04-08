/*
  Generate branded intro/outro bumpers for Pulse Gaming videos.
  Run once - bumpers are cached and reused for every video.

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
const BRAND_CARD = path.join(__dirname, '..', 'branding', 'intro_outro_card.png');

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

  let cmd;
  if (await fs.pathExists(BRAND_CARD)) {
    // Use the branded intro/outro card image with fade-in effect
    const cardPath = BRAND_CARD.replace(/\\/g, '/');
    cmd = `ffmpeg -y -loop 1 -t 1.5 -i "${cardPath}" -f lavfi -i anullsrc=r=44100:cl=stereo -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x0D0D0F,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=1.2:d=0.3[outv]" -map "[outv]" -map 1:a -c:v libx264 -crf 18 -preset medium -r 30 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -t 1.5 "${INTRO_PATH}"`;
  } else {
    // Fallback: generate with FFmpeg text
    const filter = [
      `color=c=0x0D0D0F:s=1080x1920:d=1.5:r=30,format=yuv420p`,
      `drawbox=x=0:y=935:w=iw:h=4:color=${brand.PRIMARY_FFM}@0.9:t=fill:enable='gte(t\\,0.3)'`,
      `drawtext=text='PULSE GAMING':${fontOpt}:fontcolor=${brand.TEXT_FFM}:fontsize=72:` +
        `x=(w-tw)/2:y=(h-th)/2-30:alpha='if(lt(t\\,0.4)\\,0\\,min((t-0.4)*3\\,1))'`,
      `drawtext=text='VERIFIED LEAKS. EVERY DAY.':${fontOpt}:fontcolor=${brand.PRIMARY_FFM}:fontsize=28:` +
        `x=(w-tw)/2:y=(h/2)+40:alpha='if(lt(t\\,0.6)\\,0\\,min((t-0.6)*3\\,1))'`,
    ].join(',\n');
    cmd = `ffmpeg -y -f lavfi -i "${filter}" -f lavfi -i anullsrc=r=44100:cl=stereo -c:v libx264 -crf 18 -preset medium -r 30 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -t 1.5 "${INTRO_PATH}"`;
  }

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

  let cmd;
  if (await fs.pathExists(BRAND_CARD)) {
    // Use the branded intro/outro card image with fade-out effect
    const cardPath = BRAND_CARD.replace(/\\/g, '/');
    cmd = `ffmpeg -y -loop 1 -t 1.5 -i "${cardPath}" -f lavfi -i anullsrc=r=44100:cl=stereo -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x0D0D0F,format=yuv420p,fade=t=in:st=0:d=0.2,fade=t=out:st=1.0:d=0.5[outv]" -map "[outv]" -map 1:a -c:v libx264 -crf 18 -preset medium -r 30 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -t 1.5 "${OUTRO_PATH}"`;
  } else {
    // Fallback: generate with FFmpeg text
    const filter = [
      `color=c=0x0D0D0F:s=1080x1920:d=1.5:r=30,format=yuv420p`,
      `drawbox=x=0:y=935:w=iw:h=4:color=${brand.PRIMARY_FFM}@0.9:t=fill`,
      `drawtext=text='PULSE GAMING':${fontOpt}:fontcolor=${brand.TEXT_FFM}:fontsize=72:` +
        `x=(w-tw)/2:y=(h-th)/2-30:alpha='if(gt(t\\,1.0)\\,max(1-(t-1.0)*3\\,0)\\,1)'`,
      `drawtext=text='FOLLOW FOR DAILY LEAKS':${fontOpt}:fontcolor=${brand.PRIMARY_FFM}:fontsize=32:` +
        `x=(w-tw)/2:y=(h/2)+40:alpha='if(gt(t\\,1.0)\\,max(1-(t-1.0)*3\\,0)\\,1)'`,
    ].join(',\n');
    cmd = `ffmpeg -y -f lavfi -i "${filter}" -f lavfi -i anullsrc=r=44100:cl=stereo -c:v libx264 -crf 18 -preset medium -r 30 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -t 1.5 "${OUTRO_PATH}"`;
  }

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
