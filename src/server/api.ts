/**
 * Single API router used by the Pages Function at functions/api/[[path]].ts.
 * Member routes need the club session cookie; /api/admin/* need a verified Cloudflare Access identity.
 */
import { csv, fmtArrival, whatsappRaceSummary, whatsappStandings } from "../core/exports";
import { checkAccessJwt, isMember, logoutCookie, memberLogin, readCookie, setMemberPassword } from "./auth";
import { BenzingClient } from "./benzingClient";
import type { Env } from "./env";
import { BUILD_ID } from "../generated/build";
import {
  adminOverview, adminRaceDetail, championship, defaultSeason, fancierDetail, home, listCompetitions, listRaces, live, raceDetail, seasons,
} from "./queries";
import { SYSTEMS } from "../core/scoring/systems";
import {
  addOverride, audit, calculateResults, createCompetition, publish, recalculateRace, recalculateSeason,
  revokeOverride, setCompetitionRace, setCompetitionRaceParams, syncRaces, updateCompetition, updateRace, UserError, type Ctx,
} from "./services";

export interface ApiDeps {
  benzing?: BenzingClient;
  now?: () => Date;
  accessFetch?: (url: string) => Promise<Response>;
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

async function adminCheck(request: Request, env: Env, now: Date, deps: ApiDeps): Promise<{ email: string | null; reason?: string }> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    // Access normally adds the header; its CF_Authorization cookie carries the same signed token.
    const token = request.headers.get("Cf-Access-Jwt-Assertion") ?? readCookie(request, "CF_Authorization");
    return checkAccessJwt(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }, now, deps.accessFetch);
  }
  // Local development only: no Access configured and the request is to localhost.
  const host = new URL(request.url).hostname;
  if (env.DEV_ADMIN_EMAIL && (host === "localhost" || host === "127.0.0.1")) return { email: env.DEV_ADMIN_EMAIL };
  return { email: null, reason: "Cloudflare Access is not configured for this site" };
}

const adminEmail = async (request: Request, env: Env, now: Date, deps: ApiDeps) => (await adminCheck(request, env, now, deps)).email;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

/** Every API response carries the build id, so a page left open across a deploy can ask to reload. */
export async function handleApi(request: Request, env: Env, deps: ApiDeps = {}): Promise<Response> {
  const res = await handleApiInner(request, env, deps);
  res.headers.set("X-QRPC-Build", BUILD_ID);
  return res;
}

async function handleApiInner(request: Request, env: Env, deps: ApiDeps = {}): Promise<Response> {
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
      const check = await adminCheck(request, env, now, deps);
      if (!check.email) {
        console.warn("admin refused:", check.reason);
        return json({ error: `Admin sign-in failed: ${check.reason}.` }, 401);
      }
      const actor = check.email;
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
    const compParam = url.searchParams.get("competition");
    if (path === "/api/competitions") return json(await listCompetitions(db));
    if (path === "/api/championship") return json(await championship(db, compParam, await seasonParam()));
    if (path === "/api/championship/export.csv" || path === "/api/championship/whatsapp") {
      const c = await championship(db, compParam, await seasonParam());
      const bird = c.competition.entity === "bird";
      const label = (s: (typeof c.standings)[number]) => ("ring" in s && s.ring ? `${s.ring} (${s.fancierName})` : s.fancierName);
      if (path.endsWith("whatsapp")) {
        return json({
          text: whatsappStandings(c.season, c.competition.name, c.races.length, c.standings.slice(0, bird ? 10 : undefined).map((s) => ({ ...s, fancierName: label(s) })), url.origin, c.competition.unit),
        });
      }
      return csvResponse(
        csv([
          [...["Place"], ...(bird ? ["Ring", "Fancier"] : ["Fancier"]), ...c.races.map((r) => r.name), `Total (${c.competition.unit})`],
          ...c.standings.map((s) => [
            s.rank,
            ...(bird ? [("ring" in s && s.ring) || "", s.fancierName] : [s.fancierName]),
            ...c.races.map((r) => s.perRace[String(r.id)] ?? 0),
            s.total,
          ]),
        ]),
        `qrpc-${c.season}-${c.competition.slug}.csv`,
      );
    }
    let r = m(/^\/api\/races\/(\d+)$/);
    if (r) return json(await raceDetail(db, Number(r[1]), now));
    r = m(/^\/api\/races\/(\d+)\/(full|result)\.csv$/);
    if (r) {
      const d = await raceDetail(db, Number(r[1]), now);
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
      const res = pickResult(d.results, compParam);
      return csvResponse(
        csv([
          ["Scoring position", "Points", "Fancier", "Ring", "Position in full result", "Arrival", "Speed (m/min)"],
          ...res.published.lines.map((l) => [l.scoringPosition, l.points, l.fancierName, l.ring, l.benzingPosition, fmtArrival(l.arrivalDay, l.arrivalTime), l.speed.toFixed(3)]),
          [],
          ["Place", "Fancier", "Birds scored", "Race score"],
          ...res.published.fanciers.map((f) => [f.rank ?? "=", f.fancierName, f.birdsScored, f.score]),
        ]),
        `${base}-${res.competition.slug}.csv`,
      );
    }
    r = m(/^\/api\/races\/(\d+)\/whatsapp$/);
    if (r) {
      const d = await raceDetail(db, Number(r[1]), now);
      const res = pickResult(d.results, compParam);
      // Bird competitions list the top 10 birds instead of fanciers.
      const rows =
        res.competition.entity === "bird"
          ? res.published.lines.slice(0, 10).map((l, i) => ({ rank: i + 1, fancierName: `${l.ring} (${l.fancierName})`, score: l.points, birdsScored: 1 }))
          : res.published.fanciers;
      return json({
        text: whatsappRaceSummary({
          name: d.race.name, date: d.race.date, basketed: d.race.basketed, returned: d.returned, firstBird: d.firstBird,
          fanciers: rows, n: res.published.n, competitionName: res.competition.name, url: `${url.origin}/races/${d.race.id}`, unit: res.competition.unit,
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
    const message = e instanceof Error ? e.message : String(e);
    console.error("API error", path, message);
    if (path.startsWith("/api/admin")) {
      // Admins see the real cause, and it is kept as an alert for later diagnosis.
      try {
        await db.prepare("INSERT INTO alert (at, level, source, message) VALUES (?, 'error', 'api', ?)").bind(now.toISOString(), `${request.method} ${path}: ${message}`).run();
      } catch {
        /* the database itself may be what failed */
      }
      return json({ error: `Unexpected error: ${message}` }, 500);
    }
    return json({ error: "Something went wrong. The last good data is still shown." }, 500);
  }
}

type RaceResults = Awaited<ReturnType<typeof raceDetail>>["results"];
function pickResult(results: RaceResults, slug: string | null) {
  const res = slug ? results.find((x) => x.competition.slug === slug) : results[0];
  if (!res) throw new UserError("Competition not found.", 404);
  if (!res.published) throw new UserError(`The ${res.competition.name} result for this race is not published yet.`, 404);
  return { competition: res.competition, published: res.published };
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
  if (path === "/api/admin/competitions") {
    if (post) {
      const b = await body<{ name: string; system: string; params?: unknown; racesCounted?: "all" | "best"; bestX?: number | null; visibility?: "members" | "admin"; raceSelection?: "all" | "picked"; season?: number }>(request);
      return json(await createCompetition(ctx, b, actor, Number(b.season) || (await seasonParam())));
    }
    const comps = await listCompetitions(db, { activeOnly: false });
    const exclusions = await db.prepare("SELECT competition_id, race_id FROM competition_exclusion").all<{ competition_id: number; race_id: number }>();
    const inclusions = await db.prepare("SELECT competition_id, race_id FROM competition_inclusion").all<{ competition_id: number; race_id: number }>();
    const of = (rows: { competition_id: number; race_id: number }[], id: number) => rows.filter((e) => e.competition_id === id).map((e) => e.race_id);
    return json({
      competitions: comps.map((c) => ({ ...c, excludedRaceIds: of(exclusions.results, c.id), pickedRaceIds: of(inclusions.results, c.id) })),
      systems: Object.values(SYSTEMS).map((s) => ({ id: s.id, name: s.name, fields: s.fields, defaults: s.defaults, raceFields: s.raceFields ?? [], entity: s.entity, season: s.season })),
    });
  }
  let c = m(/^\/api\/admin\/competitions\/(\d+)$/);
  if (c && post) {
    const b = await body<{ name?: string; params?: unknown; racesCounted?: "all" | "best"; bestX?: number | null; active?: boolean; displayOrder?: number; visibility?: "members" | "admin"; raceSelection?: "all" | "picked"; season?: number }>(request);
    const res = await updateCompetition(ctx, Number(c[1]), b, actor, Number(b.season) || (await seasonParam()));
    return json({ ok: true, ...res });
  }
  c = m(/^\/api\/admin\/competitions\/(\d+)\/races\/(\d+)\/params$/);
  if (c && post) return json(await setCompetitionRaceParams(ctx, Number(c[1]), Number(c[2]), await body(request), actor));
  if (path === "/api/admin/championship") {
    return json(await championship(db, url.searchParams.get("competition"), await seasonParam(), { admin: true }));
  }
  c = m(/^\/api\/admin\/competitions\/(\d+)\/races\/(\d+)$/);
  if (c && post) {
    const b = await body<{ included: boolean }>(request);
    return json(await setCompetitionRace(ctx, Number(c[1]), Number(c[2]), Boolean(b.included), actor));
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
    return json(await adminRaceDetail(db, Number(r[1]), now));
  }
  r = m(/^\/api\/admin\/races\/(\d+)\/(calculate|recalculate|publish|overrides)$/);
  if (r && post) {
    const raceId = Number(r[1]);
    if (r[2] === "calculate") return json(await calculateResults(ctx, raceId, actor));
    if (r[2] === "recalculate") {
      const b = await body<{ competitionId?: number }>(request);
      return json(await recalculateRace(ctx, raceId, actor, b.competitionId ? Number(b.competitionId) : undefined));
    }
    if (r[2] === "publish") {
      const b = await body<{ acknowledgeWarnings?: boolean }>(request);
      await publish(ctx, raceId, actor, Boolean(b.acknowledgeWarnings));
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
