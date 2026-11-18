import { describe, expect, it } from "vitest";
import { handleApi } from "../src/server/api";
import { checkAccessJwt } from "../src/server/auth";
import { testDb } from "./helpers/d1";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag-123";
const NOW = new Date("2026-11-18T10:00:00Z");
const b64url = (b: Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? new TextEncoder().encode(b) : b).toString("base64url");

let issuerSeq = 0;
async function issuer() {
  const kidName = `k${++issuerSeq}`;
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  const certs = { keys: [{ kid: kidName, kty: "RSA", alg: "RS256", use: "sig", n: jwk.n, e: jwk.e }], public_cert: {}, public_certs: [] };
  let certCalls = 0;
  const fetcher = async (url: string) => {
    certCalls += 1;
    expect(url).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify(certs));
  };
  const sign = async (claims: Record<string, unknown>, kid = kidName) => {
    const h = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
    const p = b64url(JSON.stringify(claims));
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`)));
    return `${h}.${p}.${b64url(sig)}`;
  };
  const t = NOW.getTime() / 1000;
  const good = { aud: [AUD], email: "admin@example.com", exp: t + 3600, iat: t, nbf: t, iss: `https://${TEAM}`, type: "app" };
  return { sign, fetcher, good, calls: () => certCalls };
}

describe("Cloudflare Access JWT", () => {
  it("accepts a valid token and explains every refusal", async () => {
    const { sign, fetcher, good } = await issuer();
    const cfg = { teamDomain: TEAM, aud: AUD };
    expect(await checkAccessJwt(await sign(good), cfg, NOW, fetcher)).toEqual({ email: "admin@example.com" });
    expect((await checkAccessJwt(null, cfg, NOW, fetcher)).reason).toMatch(/no Access token/);
    expect((await checkAccessJwt("abc", cfg, NOW, fetcher)).reason).toMatch(/not a JWT/);
    expect((await checkAccessJwt("a.b.c", cfg, NOW, fetcher)).reason).toMatch(/decoded/);
    expect((await checkAccessJwt(await sign({ ...good, aud: ["other"] }), cfg, NOW, fetcher)).reason).toMatch(/audience mismatch/);
    expect((await checkAccessJwt(await sign({ ...good, exp: good.exp - 7200 }), cfg, NOW, fetcher)).reason).toMatch(/expired/);
    expect((await checkAccessJwt(await sign({ ...good, iss: "https://evil.example" }), cfg, NOW, fetcher)).reason).toMatch(/issuer/);
    expect((await checkAccessJwt(await sign(good, "k9"), cfg, NOW, fetcher)).reason).toMatch(/unknown key/);
    const tampered = (await sign(good)).replace(/\.[^.]+\./, `.${b64url(JSON.stringify({ ...good, email: "x@evil.example" }))}.`);
    expect((await checkAccessJwt(tampered, cfg, NOW, fetcher)).reason).toMatch(/signature/);
  });

  it("admin API accepts the header or the CF_Authorization cookie and reports why it refuses", async () => {
    const { sign, fetcher, good } = await issuer();
    const db = testDb();
    const env = { DB: db, SESSION_SECRET: "s", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
    const deps = { now: () => NOW, accessFetch: fetcher };
    const token = await sign(good);
    const viaHeader = await handleApi(new Request("https://qrpc.pages.dev/api/admin/overview", { headers: { "Cf-Access-Jwt-Assertion": token } }), env, deps);
    expect(viaHeader.status).toBe(200);
    expect(((await viaHeader.json()) as { actor: string }).actor).toBe("admin@example.com");
    const viaCookie = await handleApi(new Request("https://qrpc.pages.dev/api/admin/overview", { headers: { Cookie: `other=1; CF_Authorization=${token}` } }), env, deps);
    expect(viaCookie.status).toBe(200);
    const none = await handleApi(new Request("https://qrpc.pages.dev/api/admin/overview"), env, deps);
    expect(none.status).toBe(401);
    expect(((await none.json()) as { error: string }).error).toBe("Admin sign-in failed: no Access token on the request.");
    const certsDown = await handleApi(
      new Request("https://qrpc.pages.dev/api/admin/overview", { headers: { "Cf-Access-Jwt-Assertion": await sign({ ...good, email: "y@example.com" }) } }),
      env,
      { now: () => NOW, accessFetch: async () => new Response("no", { status: 503 }) },
    );
    // Keys are cached for an hour, so a later outage doesn't lock admins out.
    expect(certsDown.status).toBe(200);
  });
});
