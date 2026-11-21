// API-format ComfyUI workflows for the GPU picture tools, built in code so each call substitutes its own inputs.
// Every model here is licensed for commercial use (docs/gpu-visuals.md has the evidence):
//   FLUX.2 [klein] 4B (black-forest-labs/FLUX.2-klein-4B): Apache 2.0, with its Qwen3 4B text encoder and VAE.
//   Real-ESRGAN x4plus / general-x4v3 (xinntao/Real-ESRGAN): BSD 3-Clause.
// FLUX.1 [dev] and FLUX.1 Fill [dev] are on the same disk but are NOT used: their licence (FLUX.1 [dev]
// Non-Commercial License v1.1.1, section 1(c)) excludes "revenue-generating activity", which a monetised channel is.

import type { Workflow } from "./comfy.ts";

/**
 * A model file named by a setting, refused when it names a non-commercial model (FLUX.1 dev or Fill dev, FLUX.2 dev,
 * the klein 9B variants): the licensed default is used instead, so a setting can never put one into a video (pure).
 */
export function permittedModel(
  name: string | undefined,
  fallback: string,
): string {
  if (!name) return fallback;
  return /flux[._-]?1|flux[._-]?2[._-]?dev|9b|fill[._-]?dev/i.test(name)
    ? fallback
    : name;
}

export const KLEIN = {
  unet: permittedModel(process.env.KLEIN_UNET, "flux-2-klein-4b.safetensors"),
  clip: permittedModel(
    process.env.KLEIN_CLIP,
    "qwen3-4b-flux2-klein.safetensors",
  ),
  vae: permittedModel(process.env.KLEIN_VAE, "flux2-klein-vae.safetensors"),
  /** The distilled klein 4B samples in 4 steps at guidance 1; the base model wants about 20 at 4 to 5. */
  steps: Number(process.env.KLEIN_STEPS || 4),
  cfg: Number(process.env.KLEIN_CFG || 1),
};

export const ESRGAN_MODELS = {
  photo: process.env.ESRGAN_MODEL || "RealESRGAN_x4plus.pth",
  fast: "realesr-general-x4v3.pth",
} as const;

function kleinBase(
  prompt: string,
  seed: number,
  width: number,
  height: number,
): Workflow {
  return {
    unet: {
      class_type: "UNETLoader",
      inputs: { unet_name: KLEIN.unet, weight_dtype: "default" },
    },
    clip: {
      class_type: "CLIPLoader",
      inputs: { clip_name: KLEIN.clip, type: "flux2", device: "default" },
    },
    vae: { class_type: "VAELoader", inputs: { vae_name: KLEIN.vae } },
    pos: {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["clip", 0] },
    },
    neg: {
      class_type: "CLIPTextEncode",
      inputs: { text: "", clip: ["clip", 0] },
    },
    sched: {
      class_type: "Flux2Scheduler",
      inputs: { steps: KLEIN.steps, width, height },
    },
    sampler: {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "euler" },
    },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
  };
}

/**
 * Outpainting on klein: the canvas (the original placed on its own blurred copy) is encoded, everything outside
 * the original is masked for regeneration (white in the mask), and the whole canvas is also given as the reference
 * latent so the model sees the scene it continues. The original's own pixels are pasted back afterwards (fill.ts).
 */
export function fillWorkflow(opts: {
  canvas: string;
  mask: string;
  prompt: string;
  seed: number;
  width: number;
  height: number;
  prefix?: string;
}): Workflow {
  return {
    ...kleinBase(opts.prompt, opts.seed, opts.width, opts.height),
    img: { class_type: "LoadImage", inputs: { image: opts.canvas } },
    mask: {
      class_type: "LoadImageMask",
      inputs: { image: opts.mask, channel: "red" },
    },
    enc: {
      class_type: "VAEEncode",
      inputs: { pixels: ["img", 0], vae: ["vae", 0] },
    },
    masked: {
      class_type: "SetLatentNoiseMask",
      inputs: { samples: ["enc", 0], mask: ["mask", 0] },
    },
    refPos: {
      class_type: "ReferenceLatent",
      inputs: { conditioning: ["pos", 0], latent: ["enc", 0] },
    },
    refNeg: {
      class_type: "ReferenceLatent",
      inputs: { conditioning: ["neg", 0], latent: ["enc", 0] },
    },
    guider: {
      class_type: "CFGGuider",
      inputs: {
        model: ["unet", 0],
        positive: ["refPos", 0],
        negative: ["refNeg", 0],
        cfg: KLEIN.cfg,
      },
    },
    run: {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["noise", 0],
        guider: ["guider", 0],
        sampler: ["sampler", 0],
        sigmas: ["sched", 0],
        latent_image: ["masked", 0],
      },
    },
    dec: {
      class_type: "VAEDecode",
      inputs: { samples: ["run", 0], vae: ["vae", 0] },
    },
    save: {
      class_type: "PreviewImage",
      inputs: {
        images: ["dec", 0],
      },
    },
  };
}

/** A picture from a prompt alone on klein (light and effect plates for thumbnails; never a game scene). */
export function plateWorkflow(opts: {
  prompt: string;
  seed: number;
  width: number;
  height: number;
  prefix?: string;
}): Workflow {
  return {
    ...kleinBase(opts.prompt, opts.seed, opts.width, opts.height),
    latent: {
      class_type: "EmptyFlux2LatentImage",
      inputs: { width: opts.width, height: opts.height, batch_size: 1 },
    },
    guider: {
      class_type: "CFGGuider",
      inputs: {
        model: ["unet", 0],
        positive: ["pos", 0],
        negative: ["neg", 0],
        cfg: KLEIN.cfg,
      },
    },
    run: {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["noise", 0],
        guider: ["guider", 0],
        sampler: ["sampler", 0],
        sigmas: ["sched", 0],
        latent_image: ["latent", 0],
      },
    },
    dec: {
      class_type: "VAEDecode",
      inputs: { samples: ["run", 0], vae: ["vae", 0] },
    },
    save: {
      class_type: "PreviewImage",
      inputs: {
        images: ["dec", 0],
      },
    },
  };
}

/** Real-ESRGAN 4x, then a Lanczos resize to the exact target size. */
export function upscaleWorkflow(opts: {
  image: string;
  width: number;
  height: number;
  model?: string;
  prefix?: string;
}): Workflow {
  return {
    img: { class_type: "LoadImage", inputs: { image: opts.image } },
    model: {
      class_type: "UpscaleModelLoader",
      inputs: { model_name: opts.model ?? ESRGAN_MODELS.photo },
    },
    up: {
      class_type: "ImageUpscaleWithModel",
      inputs: { upscale_model: ["model", 0], image: ["img", 0] },
    },
    fit: {
      class_type: "ImageScale",
      inputs: {
        image: ["up", 0],
        upscale_method: "lanczos",
        width: opts.width,
        height: opts.height,
        crop: "disabled",
      },
    },
    save: {
      class_type: "PreviewImage",
      inputs: {
        images: ["fit", 0],
      },
    },
  };
}
