/** Fetch helpers. Same-origin only; POSTs carry the CSRF header the API requires. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

import { BUILD_ID } from "../generated/build";

/** Fired once when the server runs a different build than this page; event.detail = the server's build id. */
export const STALE_EVENT = "qrpc:stale";
const RELOADED_KEY = "qrpc.reloadedFor";
let staleSent = false;

function reloadedFor(): string | null {
  try {
    return sessionStorage.getItem(RELOADED_KEY);
  } catch {
    return null;
  }
}

function checkBuild(res: Response) {
  const server = res.headers.get("X-QRPC-Build");
  // Never nag twice for the same update: if a fresh reload for this build still didn't help, stay quiet.
  if (!staleSent && server && BUILD_ID !== "dev" && server !== BUILD_ID && reloadedFor() !== server) {
    staleSent = true;
    window.dispatchEvent(new CustomEvent(STALE_EVENT, { detail: server }));
  }
}

/** Reload bypassing any cached copy: the new build id in the address is a URL no cache has stored. */
export function reloadFresh(serverBuild: string) {
  try {
    sessionStorage.setItem(RELOADED_KEY, serverBuild);
  } catch {
    /* private mode */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_v", serverBuild);
  window.location.replace(url.toString());
}

/** Remove the cache-busting parameter from the address bar after a fresh reload. */
export function tidyReloadParam() {
  const url = new URL(window.location.href);
  if (url.searchParams.has("_v")) {
    url.searchParams.delete("_v");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
}

async function handle<T>(res: Response): Promise<T> {
  checkBuild(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Error ${res.status}`, res.status);
  return data as T;
}

export const get = <T,>(path: string) => fetch(path, { credentials: "same-origin" }).then((r) => handle<T>(r));

export const post = <T,>(path: string, body: unknown = {}) =>
  fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-QRPC": "1" },
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r));
