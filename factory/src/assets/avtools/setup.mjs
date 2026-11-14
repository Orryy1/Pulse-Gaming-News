// Sets up the audio and video tools on this machine (PC or Mac mini): fetches every model from its official home,
// checks each file's SHA-256 against the pinned value (see MODELS.md for the licences), and installs the few Python
// packages the factory's existing torch environment lacks into a separate environment layered on top of it.
//   node src/assets/avtools/setup.mjs [--models <dir>] [--venv <dir>] [--base-python <python>] [--skip-pip]
// Defaults: D:/pulse-tools/models/avtools and D:/pulse-tools/avtools-venv on Windows; ~/PulseFactory/avtools/models
// and ~/PulseFactory/avtools/venv on the Mac. Nothing in the factory's own environments is changed.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WIN = process.platform === "win32";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const MODELS = arg(
  "--models",
  WIN
    ? "D:/pulse-tools/models/avtools"
    : `${os.homedir()}/PulseFactory/avtools/models`,
);
const VENV = arg(
  "--venv",
  WIN
    ? "D:/pulse-tools/avtools-venv"
    : `${os.homedir()}/PulseFactory/avtools/venv`,
);
const BASE = arg(
  "--base-python",
  WIN
    ? "D:/pulse-tools/parallax-venv/Scripts/python.exe"
    : `${os.homedir()}/PulseFactory/parallax/bin/python`,
);

const CDX =
  "https://github.com/ZFTurbo/MVSEP-CDX23-Cinematic-Sound-Demixing/releases/download/v.1.0.0";
const AST =
  "https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593/resolve/main";
export const FILES = [
  [
    "cdx23/97d170e1-dbb4db15.th",
    `${CDX}/97d170e1-dbb4db15.th`,
    "dbb4db154df7e45a5cb72d1659c48937e757f6d6b0eef8ca4199e6e38f8d8f37",
  ],
  [
    "cdx23/97d170e1-a778de4a.th",
    `${CDX}/97d170e1-a778de4a.th`,
    "a778de4a72b90482a578bfb6ea6bf41462785d9136c11802c67a864a40f29434",
  ],
  [
    "cdx23/97d170e1-e41a5468.th",
    `${CDX}/97d170e1-e41a5468.th`,
    "e41a54684d3cd6794ee2bb59183ffeb11a9a3d42db873a6a08a9829ac3ef4cfe",
  ],
  [
    "mbr-kim/MelBandRoformer.ckpt",
    "https://huggingface.co/KimberleyJSN/melbandroformer/resolve/main/MelBandRoformer.ckpt",
    "87201f4d31afb5bc79993230fc49446918425574db48c01c405e44f365c7559e",
  ],
  [
    "ast/model.safetensors",
    `${AST}/model.safetensors`,
    "ae0c1e2ad4e1381d851fa9bf298ba13ebc9c5a914cdee2dbe427a6583869924d",
  ],
  [
    "ast/config.json",
    `${AST}/config.json`,
    "a93d525511d77e8ecc933d09674b85099815bbbb417c228a4edd655e252fb9ff",
  ],
  [
    "ast/preprocessor_config.json",
    `${AST}/preprocessor_config.json`,
    "8d04ba5a9c6fca5d39d0de2b1fd05ecf79deb589fbba279728bbebac39934231",
  ],
  [
    "rife/RIFEv4.26_0921.zip",
    "https://huggingface.co/hzwer/RIFE/resolve/main/RIFEv4.26_0921.zip",
    "1fa9b9cda3d9b8c3e301359e2595960902f97bf926c08598b0e9957a3f3f760e",
  ],
  [
    "realesrgan/realesr-general-x4v3.pth",
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
    "8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292",
  ],
];
const FLOWNET_SHA =
  "45c7f74156704769dc9f85cfcaf8552e1e926f9399dcfa3a553dee88fac6f53f";

/** Pinned versions; demucs and openunmix without their dependencies (torch and torchaudio come from the base). */
const PIP = [
  [
    "demucs==4.0.1",
    "julius==0.2.8",
    "openunmix==1.3.0",
    "dora-search==0.1.13",
    "treetable==0.2.6",
    "retrying==1.4.2",
    "submitit==1.5.4",
    "cloudpickle==3.1.2",
    "omegaconf==2.3.0",
    "antlr4-python3-runtime==4.9.3",
    "BS-RoFormer==0.3.10",
    "beartype==0.23.1",
    "rotary-embedding-torch==0.9.2", "pyyaml==6.0.3",
  ],
];

const sha = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function fetchTo(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(`${dest}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${dest}.part`, dest);
}

async function models() {
  for (const [rel, url, want] of FILES) {
    const dest = path.join(MODELS, rel);
    if (fs.existsSync(dest) && sha(dest) === want) {
      console.log(`ok       ${rel}`);
      continue;
    }
    console.log(`fetching ${rel}`);
    await fetchTo(url, dest);
    const got = sha(dest);
    if (got !== want) {
      fs.rmSync(dest, { force: true });
      throw new Error(
        `${rel}: checksum ${got} is not the pinned ${want}; refused`,
      );
    }
  }
  // Only the weights come out of the RIFE archive: its Python files are never extracted or run.
  const flownet = path.join(MODELS, "rife", "RIFEv4.26_0921", "flownet.pkl");
  if (!fs.existsSync(flownet) || sha(flownet) !== FLOWNET_SHA) {
    execFileSync(
      BASE,
      [
        "-I",
        "-c",
        [
          "import sys, zipfile",
          "z = zipfile.ZipFile(sys.argv[1])",
          "open(sys.argv[2], 'wb').write(z.read('RIFEv4.26_0921/flownet.pkl'))",
        ].join("\n"),
        path.join(MODELS, "rife", "RIFEv4.26_0921.zip"),
        flownet,
      ],
      { stdio: "inherit" },
    );
    if (sha(flownet) !== FLOWNET_SHA)
      throw new Error("flownet.pkl checksum mismatch");
  }
  console.log("models verified");
}

function venv() {
  const py = WIN
    ? path.join(VENV, "Scripts", "python.exe")
    : path.join(VENV, "bin", "python");
  if (!fs.existsSync(py))
    execFileSync(BASE, ["-m", "venv", "--without-pip", VENV], {
      stdio: "inherit",
    });
  // The new environment sees the base environment's packages (torch, numpy, transformers) through a .pth file.
  const site = String(
    execFileSync(py, [
      "-I",
      "-c",
      "import sysconfig;print(sysconfig.get_paths()['purelib'])",
    ]),
  ).trim();
  const baseSites = String(
    execFileSync(BASE, [
      "-I",
      "-c",
      "import site,sys;print('\\n'.join(p for p in sys.path if p.endswith('site-packages')))",
    ]),
  ).trim();
  fs.writeFileSync(path.join(site, "zz-avtools-base.pth"), `${baseSites}\n`);
  if (!process.argv.includes("--skip-pip"))
    for (const group of PIP)
      execFileSync(
        BASE,
        [
          "-m",
          "pip",
          "install",
          "--quiet",
          "--no-deps",
          "--upgrade",
          "--target",
          site,
          ...group,
        ],
        { stdio: "inherit" },
      );
  execFileSync(
    py,
    [
      "-I",
      "-c",
      "import torch, demucs.htdemucs, bs_roformer, transformers, julius; print('environment ok, torch', torch.__version__)",
    ],
    { stdio: "inherit" },
  );
}

await models();
venv();
