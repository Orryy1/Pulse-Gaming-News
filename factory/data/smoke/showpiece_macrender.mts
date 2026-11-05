// The sandbox's render on the Mac: the working tree's code in ~/PulseFactory/showcase (never the live worker folder),
// the Mac worker's own job format and heavy lock, the output fetched back. Only for previews, outside the render windows.
import fsp from "node:fs/promises";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { fetchFolder, jobFolder, sendFiles, writeJob, macHome } from "../../src/macworker.ts";
import { shortJob } from "../../src/render/macrender.ts";

const mac = { host: "pulse-mac" };
const FACTORY = path.resolve(import.meta.dirname, "..", "..");

export function syncCode(): void {
  const line = `mkdir -p ~/PulseFactory/showcase && rm -rf ~/PulseFactory/showcase/src ~/PulseFactory/showcase/.bundle && tar -xf - -C ~/PulseFactory/showcase && cd ~/PulseFactory/showcase && ln -sfn ~/PulseFactory/factory/node_modules node_modules && mkdir -p public/music && ln -sfn ~/PulseFactory/factory/public/music/es public/music/es`;
  execSync(`tar -cf - --exclude=public/music/es --exclude=*.lf src public mac package.json package-lock.json tsconfig.json | ssh ${mac.host} "${line}"`, { cwd: FACTORY, stdio: ["ignore", "inherit", "inherit"], shell: "cmd.exe" });
}

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!["trailers", "qa", ".mac_out"].includes(e.name)) out.push(...(await walk(p, base)));
    } else if (!/^(short|render_raw)\.mp4$|\.mac_list/.test(e.name)) out.push(path.relative(base, p).replace(/\\/g, "/"));
  }
  return out;
}

export async function macRender(input: any): Promise<void> {
  const job = shortJob(input, 6);
  const name = `showcase_${path.basename(input.episodeDir)}_${Date.now()}`;
  const jobDir = jobFolder(name);
  await writeJob(mac, jobDir, job);
  await sendFiles(mac, input.episodeDir, await walk(input.episodeDir), `${jobDir}/ep`);
  const home = await macHome(mac);
  const abs = jobDir.replace("$HOME", home);
  await new Promise<void>((resolve, reject) => {
    const ssh = spawn(
      "ssh",
      [mac.host, `export PATH=/opt/homebrew/bin:$PATH REMOTION_GPU_RASTER=true; cd ~/PulseFactory/showcase && node --import tsx mac/worker.mts short ${abs}`],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let last = "";
    let err = "";
    ssh.stdout.on("data", (d) => {
      const lines = String(d).trim().split("\n");
      last = lines.at(-1) ?? last;
      for (const l of lines) if (l.includes('"result"') || l.includes('"wait"')) console.log("mac:", l.slice(0, 500));
    });
    ssh.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    ssh.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`mac render ${code}: ${err}`))));
  });
  const fetched = path.join(input.episodeDir, ".mac_out", name);
  await fetchFolder(mac, `${jobDir}/out`, fetched);
  const places: Record<string, string> = {
    [job.outName]: input.outFile,
    [job.posterName]: input.posterFile,
    ...(job.thumbName ? { [job.thumbName]: input.thumbFile } : {}),
  };
  for (const [n, to] of Object.entries(places)) await fsp.rename(path.join(fetched, n), to);
  await fsp.rm(path.join(input.episodeDir, ".mac_out"), { recursive: true, force: true });
}
