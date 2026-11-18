/** Fetch helpers. Same-origin only; POSTs carry the CSRF header the API requires. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

import { BUILD_ID } from "../generated/build";

/** Fired once when the server runs a newer build than this page. */
export const STALE_EVENT = "qrpc:stale";
let staleSent = false;
function checkBuild(res: Response) {
  const server = res.headers.get("X-QRPC-Build");
  if (!staleSent && server && BUILD_ID !== "dev" && server !== BUILD_ID) {
    staleSent = true;
    window.dispatchEvent(new Event(STALE_EVENT));
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
