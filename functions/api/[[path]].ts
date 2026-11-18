// Cloudflare Pages Function: every /api/* request is handled by the shared router.
import { handleApi } from "../../src/server/api";
import type { Env } from "../../src/server/env";

export const onRequest = (ctx: { request: Request; env: Env }) => handleApi(ctx.request, ctx.env);
