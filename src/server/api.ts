/**
 * Single API router used by the Pages Function at functions/api/[[path]].ts.
 * Member routes need the club session cookie; /api/admin/* need a verified Cloudflare Access identity.
 */
import { csv, fmtArrival, whatsappRaceSummary, whatsappStandings } from "../core/exports";
import { isMember, logoutCookie, memberLogin, setMemberPassword, verifyAccessJwt } from "./auth";
import { BenzingClient } from "./benzingClient";
import type { Env } from "./env";
import {
  adminOverview, championship, defaultSeason, fancierDetail, home, listRaces, live, raceDetail, seasons,
} from "./queries";
import {
  addOverride, audit, calculateResults, currentSettings, publish, recalculateRace, recalculateSeason,
  revokeOverride, syncRaces, updateRace, updateSettings, UserError, type Ctx,
} from "./services";

export interface ApiDeps {
  benzing?: BenzingClient;
  now?: () => Date;
  accessFetch?: typeof fetch;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

const csvResponse = (body: string, filename: string) =>
  new Response(body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new UserError("Request body must be JSON.");
  }
}

/** CSRF: state-changing requests must be same-origin JSON with our custom header. */
function checkCsrf(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw new UserError("Cross-site request refused.", 403);
  if (request.headers.get("X-QRPC") !== "1") throw new UserError("Missing request header.", 403);
}

async function adminEmail(request: Request, env: Env, now: Date, deps: ApiDeps): Promise<string | null> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    return verifyAccessJwt(
      request.headers.get("Cf-Access-Jwt-Assertion"),
      { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD },
      now,
      deps.accessFetch,
    );
  }
  // Local development only: no Access configured and the request is to localhost.
  const host = new URL(request.url).hostname;
  if (env.DEV_ADMIN_EMAIL && (host === "localhost" || host === "127.0.0.1")) return env.DEV_ADMIN_EMAIL;
  return null;
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

export async function handleApi(request: Request, env: Env, deps: ApiDeps = {}): Promise<Response> {
  const now = (deps.now ?? (() => new Date()))();
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const db = env.DB;
  const ctx: Ctx = { db, benzing: deps.benzing ?? new BenzingClient(), now: deps.now ?? (() => new Date()) };
  const m = (re: RegExp) => re.exec(path);
  const seasonParam = async () => Number(url.searchParams.get("season")) || (await defaultSeason(db, now));

  try {
    checkCsrf(request);

    // ----- public (no session) -----
    if (path === "/api/login" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const since = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString();
      const fails = await db.prepare("SELECT COUNT(*) AS n FROM login_failure WHERE ip = ? AND at > ?").bind(ip, since).first<{ n: number }>();
      if ((fails?.n ?? 0) >= LOGIN_MAX_FAILURES) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
      const { password } = await body<{ password?: string }>(request);
      const cookie = await memberLogin(db, env.SESSION_SECRET, String(password ?? ""), now);
      if (!cookie) {
        await db.prepare("INSERT INTO login_failure (ip, at) VALUES (?, ?)").bind(ip, now.toISOString()).run();
        return json({ error: "Wrong password." }, 401);
      }
      return json({ ok: true }, 200, { "Set-Cookie": cookie });
    }
    if (path === "/api/logout" && request.method === "POST") return json({ ok: true }, 200, { "Set-Cookie": logoutCookie });

    // ----- admin -----
    if (path.startsWith("/api/admin")) {
      const actor = await adminEmail(request, env, now, deps);
      if (!actor) return json({ error: "Admin sign-in required (Cloudflare Access)." }, 401);
      return await adminRoutes(request, path, url, ctx, actor, now, m, seasonParam);
    }

    // ----- members -----
    const member = await isMember(db, env.SESSION_SECRET, request, now);
    if (path === "/api/session") {
      const admin = await adminEmail(request, env, now, deps);
      return json({ member, admin: Boolean(admin) });
    }
    if (!member) return json({ error: "Please sign in." }, 401);
    if (request.method !== "GET") return json({ error: "Not found" }, 404);

    if (path === "/api/home") return json(await home(db, now));
    if (path === "/api/seasons") return json(await seasons(db));
    if (path === "/api/races") return json(await listRaces(db, await seasonParam(), now));
    if (path === "/api/live") return json(await live(db, now));
    if (path === "/api/rules") {
      const s = await currentSettings(db);
      return json({ scoringBirds: s.scoring_birds, racesCounted: s.races_counted, bestX: s.best_x });
    }
    if (path === "/api/championship") return json(await championship(db, await seasonParam()));
    if (path === "/api/championship/export.csv" || path === "/api/championship/whatsapp") {
      const c = await championship(db, await seasonParam());
      if (path.endsWith("whatsapp")) return json({ text: whatsappStandings(c.season, c.races.length, c.standings, url.origin) });
      return csvResponse(
        csv([
          ["Place", "Fancier", ...c.races.map((r) => r.name), "Total"],
          ...c.standings.map((s) => [s.rank, s.fancierName, ...c.races.map((r) => s.perRace[String(r.id)] ?? 0), s.total]),
        ]),
        `qrpc-${c.season}-5-bird-championship.csv`,
      );
    }
    let r = m(/^\/api\/races\/(\d+)$/);
    if (r) return json(await raceDetail(db, Number(r[1]), now, { admin: false }));
    r = m(/^\/api\/races\/(\d+)\/(full|five-bird)\.csv$/);
    if (r) {
      const d = await raceDetail(db, Number(r[1]), now, { admin: false });
      const base = `qrpc-${d.race.date}-${slugify(d.race.name)}`;
      if (r[2] === "full") {
        return csvResponse(
          csv([
            ["Position", "Fancier", "Ring", "Arrival", "Speed (m/min)", "Distance (km)", "Loft position"],
            ...d.fullResult.map((a) => [a.position, a.fancierName, a.ring, fmtArrival(a.arrivalDay, a.arrivalTime), a.speed.toFixed(3), a.distanceKm.toFixed(3), a.loft]),
          ]),
          `${base}-full-result.csv`,
        );
      }
      if (!d.fiveBird) throw new UserError("The 5-bird result for this race is not published yet.", 404);
      return csvResponse(
        csv([
          ["Scoring position", "Points", "Fancier", "Ring", "Position in full result", "Arrival", "Speed (m/min)"],
          ...d.fiveBird.lines.map((l) => [l.scoringPosition, l.points, l.fancierName, l.ring, l.benzingPosition, fmtArrival(l.arrivalDay, l.arrivalTime), l.speed.toFixed(3)]),
          [],
          ["Place", "Fancier", "Birds scored", "Race score"],
          ...d.fiveBird.fanciers.map((f) => [f.rank ?? "=", f.fancierName, f.birdsScored, f.score]),
        ]),
        `${base}-5-bird-result.csv`,
      );
    }
    r = m(/^\/api\/races\/(\d+)\/whatsapp$/);
    if (r) {
      const d = await raceDetail(db, Number(r[1]), now, { admin: false });
      if (!d.fiveBird) throw new UserError("The 5-bird result for this race is not published yet.", 404);
      const s = await currentSettings(db);
      return json({
        text: whatsappRaceSummary({
          name: d.race.name, date: d.race.date, basketed: d.race.basketed, returned: d.returned, firstBird: d.firstBird,
          fanciers: d.fiveBird.fanciers, n: d.fiveBird.n, scoringBirds: s.scoring_birds, url: `${url.origin}/races/${d.race.id}`,
        }),
      });
    }
    r = m(/^\/api\/fanciers\/(\d+)$/);
    if (r) {
      const f = await fancierDetail(db, Number(r[1]), await seasonParam());
      return f ? json(f) : json({ error: "Fancier not found" }, 404);
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, e.status);
    console.error("API error", (e as Error).message);
    return json({ error: "Something went wrong. The last good data is still shown." }, 500);
  }
}

async function adminRoutes(
  request: Request,
  path: string,
  url: URL,
  ctx: Ctx,
  actor: string,
  now: Date,
  m: (re: RegExp) => RegExpExecArray | null,
  seasonParam: () => Promise<number>,
): Promise<Response> {
  const db = ctx.db;
  const post = request.method === "POST";

  if (path === "/api/admin/overview") return json({ ...(await adminOverview(db, now)), actor });
  if (path === "/api/admin/races") return json(await listRaces(db, await seasonParam(), now));
  if (path === "/api/admin/sync-races" && post) {
    const { season } = await body<{ season?: number }>(request);
    return json(await syncRaces(ctx, Number(season) || (await seasonParam()), actor));
  }
  if (path === "/api/admin/recalculate-season" && post) {
    const { season } = await body<{ season?: number }>(request);
    return json(await recalculateSeason(ctx, Number(season) || (await seasonParam()), actor));
  }
  if (path === "/api/admin/settings") {
    if (post) {
      const b = await body<{ scoringBirds: number; racesCounted: "all" | "best"; bestX: number | null; season?: number }>(request);
      const drafts = await updateSettings(ctx, { scoringBirds: Number(b.scoringBirds), racesCounted: b.racesCounted, bestX: b.bestX === null ? null : Number(b.bestX) }, actor, Number(b.season) || (await seasonParam()));
      return json({ ok: true, newDrafts: drafts.filter((d) => d.changed).length });
    }
    const s = await currentSettings(db);
    return json({ scoringBirds: s.scoring_birds, racesCounted: s.races_counted, bestX: s.best_x, updatedAt: s.created_at, updatedBy: s.actor });
  }
  if (path === "/api/admin/member-password" && post) {
    const { password } = await body<{ password?: string }>(request);
    try {
      await setMemberPassword(db, String(password ?? ""));
    } catch (e) {
      throw new UserError((e as Error).message);
    }
    await audit(db, now, actor, "member-password-change");
    return json({ ok: true });
  }
  if (path === "/api/admin/audit") {
    const rows = await db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200").all();
    return json(rows.results);
  }
  let r = m(/^\/api\/admin\/alerts\/(\d+)\/resolve$/);
  if (r && post) {
    await db.prepare("UPDATE alert SET resolved_at = ? WHERE id = ?").bind(now.toISOString(), Number(r[1])).run();
    await audit(db, now, actor, "alert-resolve", "alert", r[1]);
    return json({ ok: true });
  }
  r = m(/^\/api\/admin\/races\/(\d+)$/);
  if (r) {
    if (post) {
      await updateRace(ctx, Number(r[1]), await body(request), actor);
      return json({ ok: true });
    }
    return json(await raceDetail(db, Number(r[1]), now, { admin: true }));
  }
  r = m(/^\/api\/admin\/races\/(\d+)\/(calculate|recalculate|publish|overrides)$/);
  if (r && post) {
    const raceId = Number(r[1]);
    if (r[2] === "calculate") return json(await calculateResults(ctx, raceId, actor));
    if (r[2] === "recalculate") return json(await recalculateRace(ctx, raceId, actor));
    if (r[2] === "publish") {
      const b = await body<{ calcId: number; acknowledgeWarnings?: boolean }>(request);
      await publish(ctx, raceId, Number(b.calcId), actor, Boolean(b.acknowledgeWarnings));
      return json({ ok: true });
    }
    const b = await body<{ scope: "bird" | "fancier"; target: string; reason: string }>(request);
    if (b.scope !== "bird" && b.scope !== "fancier") throw new UserError("scope must be bird or fancier");
    return json(await addOverride(ctx, raceId, b.scope, String(b.target ?? "").trim(), String(b.reason ?? ""), actor));
  }
  r = m(/^\/api\/admin\/overrides\/(\d+)\/revoke$/);
  if (r && post) return json(await revokeOverride(ctx, Number(r[1]), actor));
  void url;
  return json({ error: "Not found" }, 404);
}
