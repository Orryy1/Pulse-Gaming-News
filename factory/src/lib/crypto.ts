import crypto from "node:crypto";

function key(secret: string): Buffer {
  if (!secret || secret.length < 16) throw new Error("APP_SECRET must be set (at least 16 characters)");
  return crypto.createHash("sha256").update(`pulse-enc:${secret}`).digest();
}

/** AES-256-GCM; output is iv.tag.ciphertext in base64url. */
export function encrypt(plain: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(secret), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(blob: string, secret: string): string {
  const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !enc) throw new Error("malformed ciphertext");
  const d = crypto.createDecipheriv("aes-256-gcm", key(secret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/** Signed, expiring capability token for links (approve, reject, preview). */
export function signToken(payload: string, secret: string, ttlSeconds: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const body = `${payload}.${exp}`;
  const mac = crypto.createHmac("sha256", `pulse-link:${secret}`).update(body).digest("base64url");
  return `${exp}.${mac}`;
}

export function verifyToken(payload: string, token: string, secret: string, now = Date.now()): boolean {
  const [expStr, mac] = token.split(".");
  if (!expStr || !mac) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(now / 1000)) return false;
  const want = crypto.createHmac("sha256", `pulse-link:${secret}`).update(`${payload}.${exp}`).digest();
  const got = Buffer.from(mac, "base64url");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
