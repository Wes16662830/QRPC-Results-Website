/**
 * Members: one shared club password -> signed, httpOnly session cookie (90 days).
 *          Changing the password bumps a version number, which logs everyone out.
 * Admins:  Cloudflare Access in front of /admin* and /api/admin*. We verify the Access JWT
 *          ourselves as well, so a misconfigured Access policy cannot expose admin actions.
 */
import type { D1Database } from "./env";

const enc = new TextEncoder();
// Kept modest so a login stays inside the Workers free-plan CPU budget (10 ms).
// The shared password protects data Benzing already publishes; brute force is also rate limited.
export const PBKDF2_ITERATIONS = 20_000;
export const SESSION_COOKIE = "qrpc_session";
const SESSION_DAYS = 90;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, iter, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2-sha256" || !iter || !salt || !hash) return false;
  return timingSafeEqual(await pbkdf2(password, fromB64url(salt), Number(iter)), fromB64url(hash));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

export async function setMemberPassword(db: D1Database, password: string) {
  if (password.length < 8) throw new Error("Use at least 8 characters.");
  const version = await db.prepare("SELECT value FROM app_setting WHERE key = 'member_password_version'").first<{ value: string }>();
  const next = String(Number(version?.value ?? "0") + 1);
  await db.batch([
    db.prepare("INSERT INTO app_setting (key, value) VALUES ('member_password', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(await hashPassword(password)),
    db.prepare("INSERT INTO app_setting (key, value) VALUES ('member_password_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(next),
  ]);
}

async function passwordVersion(db: D1Database): Promise<string | null> {
  return (await db.prepare("SELECT value FROM app_setting WHERE key = 'member_password_version'").first<{ value: string }>())?.value ?? null;
}

/** Returns a Set-Cookie value on success, or null on a wrong password. */
export async function memberLogin(db: D1Database, secret: string, password: string, now: Date): Promise<string | null> {
  const stored = await db.prepare("SELECT value FROM app_setting WHERE key = 'member_password'").first<{ value: string }>();
  if (!stored || !(await verifyPassword(password, stored.value))) return null;
  const exp = Math.floor(now.getTime() / 1000) + SESSION_DAYS * 86400;
  const payload = `${await passwordVersion(db)}.${exp}`;
  const token = `${payload}.${await hmac(secret, payload)}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export const logoutCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

export async function isMember(db: D1Database, secret: string, request: Request, now: Date): Promise<boolean> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const [version, exp, sig] = token.split(".");
  if (!version || !exp || !sig) return false;
  const expected = await hmac(secret, `${version}.${exp}`);
  if (!timingSafeEqual(enc.encode(sig), enc.encode(expected))) return false;
  if (Number(exp) * 1000 < now.getTime()) return false;
  return version === (await passwordVersion(db));
}

// ---------- Cloudflare Access ----------

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let certCache: { at: number; domain: string; keys: Jwk[] } | null = null;

async function accessKeys(teamDomain: string, fetcher: typeof fetch): Promise<Jwk[]> {
  if (certCache && certCache.domain === teamDomain && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const keys = ((await res.json()) as { keys: Jwk[] }).keys;
  certCache = { at: Date.now(), domain: teamDomain, keys };
  return keys;
}

/** Verifies the Cf-Access-Jwt-Assertion header. Returns the admin's email, or null. */
export async function verifyAccessJwt(
  token: string | null,
  cfg: { teamDomain: string; aud: string },
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  let header: { kid?: string; alg?: string };
  let payload: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const jwk = (await accessKeys(cfg.teamDomain, fetcher)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(s), enc.encode(`${h}.${p}`));
  if (!ok) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const t = now.getTime() / 1000;
  if (!auds.includes(cfg.aud) || !payload.exp || payload.exp < t || (payload.nbf && payload.nbf > t + 60)) return null;
  if (payload.iss !== `https://${cfg.teamDomain}`) return null;
  return payload.email ?? null;
}
