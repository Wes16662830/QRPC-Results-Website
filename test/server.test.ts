import { describe, expect, it } from "vitest";
import { handleApi } from "../src/server/api";
import { setMemberPassword } from "../src/server/auth";
import type { Env } from "../src/server/env";
import { adminRaceDetail, championship, live, raceDetail } from "../src/server/queries";
import {
  addOverride, calculateResults, crossCheck, isLiveActive, pollLive, publish, recalculateRace,
  revokeOverride, sastToUtc, syncRaces, updateCompetition, createCompetition, setCompetitionRace, setCompetitionRaceParams, updateRace, type Ctx, type StoredArrival,
} from "../src/server/services";
import { testDb } from "./helpers/d1";
import { fakeBenzing } from "./helpers/fakeBenzing";

const ADMIN = "admin@example.com";
const NOW = new Date("2026-11-18T08:00:00Z");

function setup(routes: Record<string, string | number> = {}, now = NOW) {
  const db = testDb();
  const fake = fakeBenzing(routes);
  const ctx: Ctx = { db, benzing: fake.client, now: () => now };
  return { db, fake, ctx };
}

type Detail = Awaited<ReturnType<typeof adminRaceDetail>>;
const five = (d: Pick<Detail, "results">) => d.results.find((r) => r.competition.slug === "five-bird")!.published;
const draftOf = (d: Pick<Detail, "results">, slug = "five-bird") => d.results.find((r) => r.competition.slug === slug)!.draft;

async function mooiRiverId(ctx: Ctx) {
  await syncRaces(ctx, 2026, ADMIN);
  const r = await ctx.db.prepare("SELECT id FROM race WHERE benzing_race_id = 6975").first<{ id: number }>();
  return r!.id;
}

describe("sync races", () => {
  it("imports races and trainings and keeps admin choices on re-sync", async () => {
    const { db, ctx, fake } = setup();
    expect(await syncRaces(ctx, 2026, ADMIN)).toEqual({ races: 9, trainings: 4 });
    const rows = await db.prepare("SELECT kind, COUNT(*) AS n FROM race GROUP BY kind ORDER BY kind").all();
    expect(rows.results).toEqual([{ kind: "race", n: 9 }, { kind: "training", n: 4 }]);
    const mooi = await db.prepare("SELECT * FROM race WHERE benzing_race_id = 6975").first<Record<string, unknown>>();
    expect(mooi).toMatchObject({ name: "MooiRiver", race_date: "2026-07-04", liberation_time_local: "08:15:00", full_result_id: 17084, basketed_total: 372 });

    await updateRace(ctx, mooi!.id as number, { included: false, kind: "training" }, ADMIN);
    await syncRaces(ctx, 2026, ADMIN);
    expect(await db.prepare("SELECT kind, included FROM race WHERE id = ?").bind(mooi!.id).first()).toEqual({ kind: "training", included: 0 });
    expect(fake.calls.every((u) => u.startsWith("https://mypigeons.benzing.live/"))).toBe(true);
  });

  it("raises an alert and changes nothing when Benzing fails", async () => {
    const { db, ctx } = setup({ "/api/v2/za/smartclub/48/2026/races": 503 });
    await expect(syncRaces(ctx, 2026, ADMIN)).rejects.toThrow(/HTTP 503/);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM race").first<{ n: number }>())!.n).toBe(0);
    expect((await db.prepare("SELECT level, source FROM alert").first())).toEqual({ level: "error", source: "sync-races" });
  });
});

describe("calculate → draft → publish (Mooi River acceptance, end to end)", () => {
  it("produces the agreed scores, members see nothing until published", async () => {
    const { db, ctx } = setup();
    const raceId = await mooiRiverId(ctx);
    const res = await calculateResults(ctx, raceId, ADMIN);
    expect(res.changed).toBe(true);
    expect(res.warnings).toEqual([]);

    const before = await raceDetail(db, raceId, NOW);
    expect(five(before)).toBeNull();
    expect(before.fullResult).toHaveLength(265);
    expect(before.entries.map((e) => [e.fancierName, e.basketed, e.returned])).toContainEqual(["Glenn Mcewan", 65, 61]);

    const adminView = await adminRaceDetail(db, raceId, NOW);
    expect(draftOf(adminView)!.fanciers.map((f) => [f.fancierName, f.score])).toEqual([
      ["Glenn Mcewan", 122], ["Wesley Phillips", 115], ["Larry Elliott", 109], ["Scott King", 104],
      ["Theuns Van Schalkwyk", 47], ["Albert Venter", 16], ["Willie du Plessis", 15],
    ]);
    expect(draftOf(adminView)!.n).toBe(32);

    await publish(ctx, raceId, ADMIN, false);
    const after = await raceDetail(db, raceId, NOW);
    expect(five(after)!.fanciers[0]).toMatchObject({ rank: 1, fancierName: "Glenn Mcewan", score: 122 });
    expect(after.firstBird).toMatchObject({ fancierName: "Wesley Phillips", speed: 1279.742 });

    const champ = await championship(db, null, 2026);
    expect(champ.standings.map((s) => [s.rank, s.fancierName, s.total])).toEqual([
      [1, "Glenn Mcewan", 122], [2, "Wesley Phillips", 115], [3, "Larry Elliott", 109], [4, "Scott King", 104],
      [5, "Theuns Van Schalkwyk", 47], [6, "Albert Venter", 16], [7, "Willie du Plessis", 15],
    ]);
    // Benzing fancier ids were linked from the live feed.
    expect((await db.prepare("SELECT COUNT(*) AS n FROM fancier WHERE benzing_fancier_id IS NOT NULL").first<{ n: number }>())!.n).toBe(7);
    // Calculate switches live polling off for the race.
    expect((await db.prepare("SELECT live_mode FROM race WHERE id = ?").bind(raceId).first<{ live_mode: string }>())!.live_mode).toBe("off");
    // Audit trail.
    const actions = (await db.prepare("SELECT action FROM audit_log ORDER BY id").all<{ action: string }>()).results.map((a) => a.action);
    expect(actions).toEqual(["sync-races", "calculate-results", "draft-created", "publish"]);
  });

  it("does not create a new draft when nothing changed, and does not store a duplicate snapshot", async () => {
    const { db, ctx } = setup();
    const raceId = await mooiRiverId(ctx);
    const a = await calculateResults(ctx, raceId, ADMIN);
    const b = await calculateResults(ctx, raceId, ADMIN);
    expect(b.changed).toBe(false);
    expect(b.drafts[0]!.calcId).toBe(a.drafts[0]!.calcId);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM snapshot").first<{ n: number }>())!.n).toBe(1);
  });

  it("refuses races without a full (100 %) result", async () => {
    const { db, ctx } = setup();
    await syncRaces(ctx, 2026, ADMIN);
    const training = await db.prepare("SELECT id FROM race WHERE kind = 'training' LIMIT 1").first<{ id: number }>();
    await expect(calculateResults(ctx, training!.id, ADMIN)).rejects.toThrow(/no full \(100 %\) result/);
  });

  it("keeps the last good data and alerts when the result sheet is broken", async () => {
    const { db, ctx } = setup();
    const raceId = await mooiRiverId(ctx);
    await calculateResults(ctx, raceId, ADMIN);
    const broken = setup({ "/za/en/results/view/r-6975-t-17084-mooiriver/": "<html>maintenance</html>" });
    const ctx2: Ctx = { ...ctx, benzing: broken.fake.client };
    await expect(calculateResults(ctx2, raceId, ADMIN)).rejects.toThrow(/nothing was changed/);
    expect((await raceDetail(db, raceId, NOW)).fullResult).toHaveLength(265);
    expect(((await db.prepare("SELECT message FROM alert WHERE source = 'calculate'").first<{ message: string }>())!.message)).toMatch(/table not found/);
  });

  it("flags a sheet/live mismatch and requires acknowledgement before publishing", async () => {
    const live = JSON.parse(fakeBenzing().routes["/api/v2/za/club-races/6975/on-the-fly/arrivals?page_number=3&limit=100"] as string);
    live.arrivals[0].speed = "999.999";
    const { db, ctx } = setup({ "/api/v2/za/club-races/6975/on-the-fly/arrivals?page_number=3&limit=100": JSON.stringify(live) });
    const raceId = await mooiRiverId(ctx);
    const res = await calculateResults(ctx, raceId, ADMIN);
    expect(res.warnings[0]).toMatch(/speed .* on the sheet, 999.999 live/);
    await expect(publish(ctx, raceId, ADMIN, false)).rejects.toThrow(/warnings/);
    await publish(ctx, raceId, ADMIN, true);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM alert WHERE source = 'cross-check'").first<{ n: number }>())!.n).toBe(1);
  });
});

describe("overrides (disqualified bird is removed, the fancier's next bird moves up)", () => {
  it("re-scores as a new draft and can be revoked", async () => {
    const { db, ctx } = setup();
    const raceId = await mooiRiverId(ctx);
    const first = await calculateResults(ctx, raceId, ADMIN);
    await publish(ctx, raceId, ADMIN, false);

    // Disqualify Glenn's first bird (5th in the full result).
    const glennFirst = (await adminRaceDetail(db, raceId, NOW)).fullResult[4]!;
    expect(glennFirst.fancierName).toBe("Glenn Mcewan");
    await expect(addOverride(ctx, raceId, "bird", glennFirst.ring, " ", ADMIN)).rejects.toThrow(/reason/);
    await expect(addOverride(ctx, raceId, "bird", "ZA-0000-XX-1", "x", ADMIN)).rejects.toThrow(/not in this race/);
    await addOverride(ctx, raceId, "bird", glennFirst.ring, "Clocking error", ADMIN);

    const view = await adminRaceDetail(db, raceId, NOW);
    expect(five(view)!.fanciers[0]!.score).toBe(122); // published result unchanged until publish
    const glenn = draftOf(view)!.fanciers.find((f) => f.fancierName === "Glenn Mcewan")!;
    expect(glenn.birdsScored).toBe(5);
    expect(glenn.benzingPositions).toEqual([8, 9, 10, 11, 12]); // 12th bird moved up
    expect(draftOf(view)!.n).toBe(32);
    expect(draftOf(view)!.excluded[0]).toMatchObject({ ring: glennFirst.ring, reason: "Clocking error" });

    const overrideId = (view.overrides[0] as { id: number }).id;
    await revokeOverride(ctx, overrideId, ADMIN);
    await expect(revokeOverride(ctx, overrideId, ADMIN)).rejects.toThrow(/Already/);
    const restored = await adminRaceDetail(db, raceId, NOW);
    expect(draftOf(restored)!.fanciers[0]).toMatchObject({ fancierName: "Glenn Mcewan", score: 122 });
  });

  it("disqualifying a fancier removes all their birds", async () => {
    const { db, ctx } = setup();
    const raceId = await mooiRiverId(ctx);
    await calculateResults(ctx, raceId, ADMIN);
    const willie = await db.prepare("SELECT id FROM fancier WHERE name = 'Willie du Plessis'").first<{ id: number }>();
    await addOverride(ctx, raceId, "fancier", String(willie!.id), "Late basketing", ADMIN);
    const draft = draftOf(await adminRaceDetail(db, raceId, NOW))!;
    expect(draft.n).toBe(27);
    expect(draft.fanciers.map((f) => f.fancierName)).not.toContain("Willie du Plessis");
  });
});

describe("competitions (multiple result systems)", () => {
  it("a second competition is scored independently, published together, with its own standings and races", async () => {
    const { db, ctx } = setup();
    const raceId = await mooiRiverId(ctx);
    await calculateResults(ctx, raceId, ADMIN);
    const { slug } = await createCompetition(ctx, { name: "3-bird", system: "top-n-per-fancier", params: { scoringBirds: 3 } }, ADMIN, 2026);
    expect(slug).toBe("3-bird");
    await expect(createCompetition(ctx, { name: "3-bird", system: "top-n-per-fancier" }, ADMIN, 2026)).rejects.toThrow(/already exists/);
    await expect(createCompetition(ctx, { name: "X", system: "nope" }, ADMIN, 2026)).rejects.toThrow(/Unknown scoring system/);

    const view = await adminRaceDetail(db, raceId, NOW);
    expect(view.results.map((r) => r.competition.slug)).toEqual(["five-bird", "weighted", "3-bird"]);
    const three = draftOf(view, "3-bird")!;
    expect(three.n).toBe(20); // 6 fanciers × 3 + Albert's 2
    expect(three.fanciers.every((f) => f.birdsScored <= 3)).toBe(true);

    await publish(ctx, raceId, ADMIN, false);
    const member = await raceDetail(db, raceId, NOW);
    expect(member.results.every((r) => r.published !== null && r.draft === null)).toBe(true);
    expect((await championship(db, "3-bird", 2026)).standings[0]!.total).toBe(three.fanciers[0]!.score);
    expect((await championship(db, "five-bird", 2026)).standings[0]!.total).toBe(122);

    // Leave Mooi River out of the 3-bird competition only.
    const comp3 = (await championship(db, "3-bird", 2026)).competition.id;
    await setCompetitionRace(ctx, comp3, raceId, false, ADMIN);
    expect((await championship(db, "3-bird", 2026)).standings).toEqual([]);
    expect((await championship(db, "five-bird", 2026)).standings).toHaveLength(7);
    await setCompetitionRace(ctx, comp3, raceId, true, ADMIN);
    expect((await championship(db, "3-bird", 2026)).standings).toHaveLength(7);

    // Deactivated competitions disappear for members.
    await updateCompetition(ctx, comp3, { active: false }, ADMIN, 2026);
    expect((await raceDetail(db, raceId, NOW)).results.map((r) => r.competition.slug)).toEqual(["five-bird"]);
  });

  it("weighted competition: admin-only, skipped until a closing time is set, then scored per race", async () => {
    const { db, ctx } = setup();
    const raceId = await mooiRiverId(ctx);
    const calc = await calculateResults(ctx, raceId, ADMIN);
    const weighted = await db.prepare("SELECT id FROM competition WHERE slug = 'weighted'").first<{ id: number }>();
    const wId = weighted!.id;
    expect(calc.drafts.find((d) => d.competitionId === wId)).toMatchObject({ changed: false, skipped: expect.stringMatching(/closing day and time/) });

    await expect(setCompetitionRaceParams(ctx, wId, raceId, { closingDay: 1, closingTime: "25:00" }, ADMIN)).rejects.toThrow(/HH:MM/);
    await expect(setCompetitionRaceParams(ctx, 1, raceId, { closingDay: 1, closingTime: "16:00" }, ADMIN)).rejects.toThrow(/no per-race settings/);
    const set = await setCompetitionRaceParams(ctx, wId, raceId, { closingDay: 1, closingTime: "16:00" }, ADMIN);
    expect(set.changed).toBe(true);

    const admin = await adminRaceDetail(db, raceId, NOW);
    const w = admin.results.find((r) => r.competition.slug === "weighted")!;
    expect(w.raceParams).toEqual({ closingDay: 1, closingTime: "16:00" });
    expect(w.competition.visibility).toBe("admin");
    expect(w.draft!.n).toBe(197);
    expect(w.draft!.fanciers[0]).toMatchObject({ fancierName: "Glenn Mcewan", score: 73.51, points: 4778, basketed: 65 });

    await publish(ctx, raceId, ADMIN, false);
    // Members never see it…
    const member = await raceDetail(db, raceId, NOW);
    expect(member.results.map((r) => r.competition.slug)).toEqual(["five-bird"]);
    await expect(championship(db, "weighted", 2026)).rejects.toThrow(/not found/);
    // …admins do.
    const champ = await championship(db, "weighted", 2026, { admin: true });
    expect(champ.standings.slice(0, 2).map((s) => [s.fancierName, s.total])).toEqual([["Glenn Mcewan", 73.51], ["Scott King", 73.28]]);

    // Showing it to members is one switch.
    await updateCompetition(ctx, wId, { visibility: "members" }, ADMIN, 2026);
    expect((await raceDetail(db, raceId, NOW)).results.map((r) => r.competition.slug)).toEqual(["five-bird", "weighted"]);
    await expect(updateCompetition(ctx, wId, { visibility: "x" as never }, ADMIN, 2026)).rejects.toThrow(/Visibility/);
  });

  it("changing scoring birds creates fresh drafts; recalc without changes does nothing", async () => {
    const { db, ctx } = setup();
    const raceId = await mooiRiverId(ctx);
    const first = await calculateResults(ctx, raceId, ADMIN);
    await publish(ctx, raceId, ADMIN, false);
    expect((await recalculateRace(ctx, raceId, ADMIN)).changed).toBe(false);
    const drafts = await updateCompetition(ctx, 1, { params: { scoringBirds: 3 } }, ADMIN, 2026);
    expect(drafts).toEqual([{ raceId, changed: true }]);
    const draft = draftOf(await adminRaceDetail(db, raceId, NOW))!;
    expect(draft.fanciers.every((f) => f.birdsScored <= 3)).toBe(true);
    await expect(updateCompetition(ctx, 1, { params: { scoringBirds: 0 } }, ADMIN, 2026)).rejects.toThrow(/1 to 50/);
    await expect(updateCompetition(ctx, 1, { racesCounted: "best", bestX: null }, ADMIN, 2026)).rejects.toThrow(/Best X/);
  });
});

describe("live polling (every 5 minutes, only for an active race)", () => {
  const race = { kind: "race" as const, live_mode: "auto" as const, race_date: "2026-07-04", liberation_time_local: "08:15:00" };

  it("isLiveActive follows liberation time, 48 h window and admin switches", () => {
    const lib = sastToUtc("2026-07-04", "08:15:00");
    expect(lib.toISOString()).toBe("2026-07-04T06:15:00.000Z");
    expect(isLiveActive(race, new Date(lib.getTime() - 60_000))).toBe(false);
    expect(isLiveActive(race, lib)).toBe(true);
    expect(isLiveActive(race, new Date(lib.getTime() + 47 * 3600_000))).toBe(true);
    expect(isLiveActive(race, new Date(lib.getTime() + 48 * 3600_000))).toBe(false);
    expect(isLiveActive({ ...race, live_mode: "off" }, lib)).toBe(false);
    expect(isLiveActive({ ...race, kind: "training" }, lib)).toBe(false);
    expect(isLiveActive({ ...race, kind: "training", live_mode: "on" }, new Date(lib.getTime() - 3600_000))).toBe(true);
    expect(isLiveActive({ ...race, liberation_time_local: null }, sastToUtc("2026-07-04", "06:00:00"))).toBe(true);
  });

  it("makes no Benzing calls when no race is active", async () => {
    const { ctx, fake } = setup();
    await syncRaces(ctx, 2026, ADMIN);
    fake.calls.length = 0;
    expect(await pollLive(ctx)).toEqual({ polled: [] });
    expect(fake.calls).toEqual([]);
  });

  it("polls an active race, stores a snapshot only when it changes, and serves provisional standings", async () => {
    const raceDay = new Date("2026-07-04T13:00:00Z");
    const { db, ctx, fake } = setup({}, raceDay);
    await syncRaces(ctx, 2026, ADMIN);
    fake.calls.length = 0;
    expect((await pollLive(ctx)).polled).toHaveLength(1);
    expect(fake.calls).toHaveLength(3);
    await pollLive(ctx);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM snapshot WHERE source = 'live'").first<{ n: number }>())!.n).toBe(1);
    const board = await live(db, raceDay);
    expect(board.races).toHaveLength(1);
    expect(board.races[0]!.provisional[0]!.result.fanciers.map((f) => f.score)).toEqual([122, 115, 109, 104, 47, 16, 15]);
    expect(board.races[0]!.provisional[0]!.result.fanciers[0]!.fancierName).toBe("Glenn Mcewan");
  });

  it("alerts and keeps last good data when the live feed fails", async () => {
    const raceDay = new Date("2026-07-04T13:00:00Z");
    const { db, ctx } = setup({ "/api/v2/za/club-races/6975/on-the-fly/arrivals?page_number=1&limit=100": 500 }, raceDay);
    await syncRaces(ctx, 2026, ADMIN);
    expect(await pollLive(ctx)).toEqual({ polled: [] });
    await pollLive(ctx);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM alert WHERE source = 'live'").first<{ n: number }>())!.n).toBe(1);
  });
});

describe("crossCheck", () => {
  const a = (ring: string, speed: number): StoredArrival => ({
    listOrder: 1, position: 1, fancierName: "F", benzingFancierId: 1, ring, sex: null, nomination: null, arrivalDay: 1,
    arrivalTime: "10:00:00", speedMilli: speed, distanceM: 1, loftOrder: 1, loftBasketed: 1,
  });
  const l = (ring: string, speed: number) => ({ arrivalId: 1, fancierId: 1, fancierName: "F", ring, rank: 1, nomination: null, arrivalDay: 1, arrivalTime: "10:00:00", speedMilli: speed, distanceM: 1, loftOrder: 1, loftBasketed: 1 });
  it("reports missing and extra birds, and truncates long lists", () => {
    expect(crossCheck([a("A", 1)], [l("B", 1)])).toEqual([
      "A (F) is on the result sheet but not in the live feed.",
      "B (F) is in the live feed but not on the result sheet.",
    ]);
    const many = Array.from({ length: 12 }, (_, i) => a(`R${i}`, 1));
    const out = crossCheck(many, []);
    expect(out).toHaveLength(11);
    expect(out.at(-1)).toMatch(/and 3 more/);
  });
});

// ---------------- HTTP API ----------------

function env(db: ReturnType<typeof testDb>, extra: Partial<Env> = {}): Env {
  return { DB: db, SESSION_SECRET: "test-secret", ...extra };
}
const req = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.method === "POST") {
    headers.set("Content-Type", "application/json");
    if (!headers.has("X-QRPC")) headers.set("X-QRPC", "1");
  }
  return new Request(`http://localhost${path}`, { ...init, headers });
};

describe("HTTP API", () => {
  it("gates members behind the shared password, with lock-out after 10 failures", async () => {
    const { db, fake } = setup();
    const e = env(db);
    const deps = { benzing: fake.client, now: () => NOW };
    expect((await handleApi(req("/api/home"), e, deps)).status).toBe(401);
    await setMemberPassword(db, "pigeons-2026");
    expect((await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: "nope" }) }), e, deps)).status).toBe(401);
    const ok = await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: "pigeons-2026" }) }), e, deps);
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("Set-Cookie")!.split(";")[0]!;
    expect(ok.headers.get("Set-Cookie")).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    expect((await handleApi(req("/api/home", { cookie }), e, deps)).status).toBe(200);
    expect(await (await handleApi(req("/api/session", { cookie }), e, deps)).json()).toEqual({ member: true, admin: false });

    // Changing the password logs everyone out.
    await setMemberPassword(db, "new-password-1");
    expect((await handleApi(req("/api/home", { cookie }), e, deps)).status).toBe(401);
    // Tampered cookie.
    expect((await handleApi(req("/api/home", { cookie: cookie.replace(/.$/, "x") }), e, deps)).status).toBe(401);

    for (let i = 0; i < 9; i++) await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: "x" }) }), e, deps);
    expect((await handleApi(req("/api/login", { method: "POST", body: JSON.stringify({ password: "new-password-1" }) }), e, deps)).status).toBe(429);
  });

  it("refuses admin routes without Access, and CSRF without the header", async () => {
    const { db, fake } = setup();
    const deps = { benzing: fake.client, now: () => NOW };
    expect((await handleApi(req("/api/admin/overview"), env(db), deps)).status).toBe(401);
    // Dev bypass only works on localhost and only when Access isn't configured.
    expect((await handleApi(req("/api/admin/overview"), env(db, { DEV_ADMIN_EMAIL: ADMIN }), deps)).status).toBe(200);
    expect((await handleApi(new Request("https://qrpc.pages.dev/api/admin/overview"), env(db, { DEV_ADMIN_EMAIL: ADMIN }), deps)).status).toBe(401);
    expect((await handleApi(req("/api/admin/overview"), env(db, { DEV_ADMIN_EMAIL: ADMIN, ACCESS_TEAM_DOMAIN: "x.cloudflareaccess.com", ACCESS_AUD: "aud" }), deps)).status).toBe(401);
    const noHeader = await handleApi(req("/api/admin/sync-races", { method: "POST", body: "{}", headers: { "X-QRPC": "0" } }), env(db, { DEV_ADMIN_EMAIL: ADMIN }), deps);
    expect(noHeader.status).toBe(403);
    const crossSite = await handleApi(req("/api/admin/sync-races", { method: "POST", body: "{}", headers: { Origin: "https://evil.example" } }), env(db, { DEV_ADMIN_EMAIL: ADMIN }), deps);
    expect(crossSite.status).toBe(403);
  });

  it("runs the full admin flow and member exports over HTTP", async () => {
    const { db, fake } = setup();
    const e = env(db, { DEV_ADMIN_EMAIL: ADMIN });
    const deps = { benzing: fake.client, now: () => NOW };
    const call = async (path: string, init: RequestInit & { cookie?: string } = {}) => handleApi(req(path, init), e, deps);

    expect((await call("/api/admin/sync-races", { method: "POST", body: JSON.stringify({ season: 2026 }) })).status).toBe(200);
    const races = (await (await call("/api/admin/races?season=2026")).json()) as { id: number; benzingRaceId: number; state: string }[];
    const mooi = races.find((r) => r.benzingRaceId === 6975)!;
    expect(mooi.state).toBe("awaiting");
    expect(mooi).toMatchObject({ calculated: false, draftWaiting: false, hasFullResult: true });
    await call(`/api/admin/races/${mooi.id}/calculate`, { method: "POST", body: "{}" });
    const afterCalc = (await (await call("/api/admin/races?season=2026")).json()) as { benzingRaceId: number; calculated: boolean; draftWaiting: boolean }[];
    expect(afterCalc.find((r) => r.benzingRaceId === 6975)).toMatchObject({ calculated: true, draftWaiting: true });
    expect((await call(`/api/admin/races/${mooi.id}/publish`, { method: "POST", body: "{}" })).status).toBe(200);
    expect((await call("/api/admin/member-password", { method: "POST", body: JSON.stringify({ password: "short" }) })).status).toBe(400);
    expect((await call("/api/admin/member-password", { method: "POST", body: JSON.stringify({ password: "pigeons-2026" }) })).status).toBe(200);

    const login = await call("/api/login", { method: "POST", body: JSON.stringify({ password: "pigeons-2026" }) });
    const cookie = login.headers.get("Set-Cookie")!.split(";")[0]!;
    const homeData = (await (await call("/api/home", { cookie })).json()) as { latestRace: { top: { fancierName: string }[] }; championshipTop5: unknown[] };
    expect(homeData.latestRace.top[0]!.fancierName).toBe("Glenn Mcewan");
    expect(homeData.championshipTop5).toHaveLength(5);

    const full = await call(`/api/races/${mooi.id}/full.csv`, { cookie });
    expect(full.headers.get("Content-Disposition")).toContain("qrpc-2026-07-04-mooiriver-full-result.csv");
    const fullText = await full.text();
    expect(fullText.split("\r\n")[1]).toBe("1,Wesley Phillips,ZA-2025-BORD-3404,14:28:13,1279.742,477.685,1/74");
    expect(fullText).toContain("Day 12 10:40:28");
    const five = await (await call(`/api/races/${mooi.id}/result.csv?competition=five-bird`, { cookie })).text();
    expect(five).toContain("1,Glenn Mcewan,5,122");
    const wa = (await (await call(`/api/races/${mooi.id}/whatsapp`, { cookie })).json()) as { text: string };
    expect(wa.text).toContain("1. Glenn Mcewan – 122 pts");
    expect(wa.text).toContain("*5-bird championship* (32 scoring birds)");
    const champCsv = await (await call("/api/championship/export.csv?season=2026", { cookie })).text();
    expect(champCsv).toContain("1,Glenn Mcewan,122,122");

    const glennId = (await db.prepare("SELECT id FROM fancier WHERE name = 'Glenn Mcewan'").first<{ id: number }>())!.id;
    const fancier = (await (await call(`/api/fanciers/${glennId}?season=2026`, { cookie })).json()) as {
      totals: unknown;
      standings: { competition: { slug: string }; rank: number; total: number; of: number }[];
      races: { results: Record<string, { score: number }> }[];
    };
    expect(fancier.totals).toEqual({ basketed: 65, returned: 61, returnPct: 93.8 });
    expect(fancier.standings[0]).toMatchObject({ competition: { slug: "five-bird" }, rank: 1, total: 122, of: 7 });
    expect(fancier.races[0]!.results["five-bird"]!.score).toBe(122);

    // Members cannot reach admin data or write.
    expect((await call(`/api/races/${mooi.id}`, { cookie, method: "POST", body: "{}" })).status).toBe(404);
    expect((await call("/api/nope", { cookie })).status).toBe(404);
    const audit = (await (await call("/api/admin/audit")).json()) as { action: string }[];
    expect(audit.map((a) => a.action)).toContain("member-password-change");
  });
});
