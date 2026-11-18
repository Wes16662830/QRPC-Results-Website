/** Fake Benzing server backed by the captured fixtures. Records every URL requested. */
import { readFileSync } from "node:fs";
import { BenzingClient } from "../../src/server/benzingClient";

const fx = (name: string) => readFileSync(new URL(`../../fixtures/benzing/${name}`, import.meta.url), "utf8");

export function fakeBenzing(overrides: Record<string, string | number> = {}) {
  const calls: string[] = [];
  const routes: Record<string, string | number> = {
    "/api/v2/za/smartclub/48/2026/races": fx("smartclub-48-2026-races.json"),
    "/api/v2/za/smartclub/48/2026/training-races": fx("smartclub-48-2026-training-races.json"),
    "/za/en/results/view/r-6975-t-17084-mooiriver/": fx("r-6975-t-17084-mooiriver.html"),
    "/api/v2/za/club-races/6975/on-the-fly/arrivals?page_number=1&limit=100": fx("r-6975-on-the-fly-arrivals-p1.json"),
    "/api/v2/za/club-races/6975/on-the-fly/arrivals?page_number=2&limit=100": fx("r-6975-on-the-fly-arrivals-p2.json"),
    "/api/v2/za/club-races/6975/on-the-fly/arrivals?page_number=3&limit=100": fx("r-6975-on-the-fly-arrivals-p3.json"),
    ...overrides,
  };
  const client = new BenzingClient(
    async (url, init) => {
      calls.push(url);
      if (init.method !== "GET") throw new Error("Benzing adapter must only GET");
      const path = url.replace("https://mypigeons.benzing.live", "");
      const r = routes[path];
      if (r === undefined) return new Response("not found", { status: 404 });
      if (typeof r === "number") return new Response("", { status: r });
      return new Response(r, { status: 200 });
    },
    async () => {},
  );
  return { client, calls, routes };
}
