// Which old-footage hardware a game gets (src/render/components/Retro.tsx), kept free of React so the
// planner and the tests can use it.

/** Frames each device needs before the shot plays plainly (the shot must be longer than this). */
export const DEVICE_FRAMES = {
  vcr: 112,
  arcade: 84,
  monitor: 80,
  handheld: 80,
} as const;
export type Device = keyof typeof DEVICE_FRAMES;

/** Which hardware an old game opens on: its platform first, then its era. */
export function deviceFor(
  year: number,
  platforms: string,
  turn: number,
): Device | "tv" {
  const p = platforms.toLowerCase();
  if (
    /game ?boy|gba|\bds\b|nintendo ds|psp|vita|game gear|lynx|wonderswan|neo ?geo pocket|n-gage/.test(
      p,
    )
  )
    return "handheld";
  if (/arcade/.test(p)) return "arcade";
  if (/^(pc|ms-dos|dos|windows|mac|amiga|commodore)/.test(p.trim()))
    return "monitor";
  return turn % 2 ? "vcr" : "tv";
}

export const OLD_YEAR = 2006;
export const handheldGreen = (year: number) => year < 1999;
