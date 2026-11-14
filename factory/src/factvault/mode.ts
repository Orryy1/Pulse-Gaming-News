// FACT_VAULT: how far the Pulse Fact Vault reaches into the factory.
//   off      nothing reads or writes the vault (the default)
//   read     writers and fact checkers are given the vault's verified facts, quotes and rejected claims
//   write    read, and the vault grows from every story, research step and fact check
//   enforce  write, and a fact check's blocker that the vault settles is passed (vault supports it) or fixed
//            with the vault's value (vault contradicts it) instead of failing the episode

export type FactVaultMode = "off" | "read" | "write" | "enforce";

const ORDER: Record<FactVaultMode, number> = {
  off: 0,
  read: 1,
  write: 2,
  enforce: 3,
};

/** FACT_VAULT as a mode (pure): anything unrecognised is off, so a typo never turns enforcement on. */
export function factVaultMode(raw: string | undefined): FactVaultMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "read" || v === "write" || v === "enforce") return v;
  if (v === "on") return "read";
  return "off";
}

export const vaultReads = (m: FactVaultMode) => ORDER[m] >= ORDER.read;
export const vaultWrites = (m: FactVaultMode) => ORDER[m] >= ORDER.write;
export const vaultEnforces = (m: FactVaultMode) => m === "enforce";
