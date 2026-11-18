// Companion Worker "qrpc-sync": Cron Trigger every 5 minutes.
// It checks the database first and only calls Benzing while a race is live.
import type { Env } from "../src/server/env";
import { BenzingClient } from "../src/server/benzingClient";
import { pollLive } from "../src/server/services";

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      pollLive({ db: env.DB, benzing: new BenzingClient(), now: () => new Date() }).then((r) => {
        if (r.polled.length) console.log(`live poll: races ${r.polled.join(", ")}`);
      }),
    );
  },
  // No public HTTP surface.
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
