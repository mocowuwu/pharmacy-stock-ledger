/**
 * Requests to the pharmacy server's `/api/device/*` routes. Shapes come from
 * the server's own contract module, so a renamed field fails this build too.
 */
import type {
  ApiError,
  LoginRequest,
  LoginResponse,
  PingResponse,
  SnapshotRequest,
  SnapshotResponse,
  SyncRequest,
  SyncResponse,
} from "@/lib/offline/contract";

export const PING_TIMEOUT_MS = 4_000;
const REQUEST_TIMEOUT_MS = 20_000;

/** The server answered, with an error. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.error ?? `HTTP ${status}`);
  }
}

/** The server could not be reached at all. */
export class Unreachable extends Error {}

/** `https://Pharmacy-PC.ts.net/` -> `https://pharmacy-pc.ts.net`; null when it is not an http(s) address. */
export function normaliseServerUrl(input: string): string | null {
  let text = input.trim();
  if (text === "") return null;
  if (!/^https?:\/\//iu.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function request<T>(
  server: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; token?: string | null; timeoutMs?: number },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${server}${path}`, {
      method: init.method,
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      // The API authenticates with the bearer token; the website's cookie is
      // not needed and should not ride along.
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new Unreachable();
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    let body: ApiError | null = null;
    try {
      body = (await response.json()) as ApiError;
    } catch {
      body = null;
    }
    // A gateway error is Tailscale Serve saying the pharmacy server behind it
    // is not running: for the till that is "unreachable", not "refused".
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new Unreachable();
    }
    throw new ApiFailure(response.status, body);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Unreachable();
  }
}

export async function ping(server: string, timeoutMs = PING_TIMEOUT_MS): Promise<PingResponse | null> {
  try {
    const body = await request<PingResponse>(server, "/api/device/ping", {
      method: "GET",
      timeoutMs,
    });
    return body && body.ok && body.app === "pharmacy-stock-ledger" ? body : null;
  } catch {
    return null;
  }
}

export function login(server: string, body: LoginRequest, token: string | null) {
  return request<LoginResponse>(server, "/api/device/login", { method: "POST", body, token });
}

export function fetchSnapshot(server: string, body: SnapshotRequest, token: string) {
  return request<SnapshotResponse>(server, "/api/device/snapshot", {
    method: "POST",
    body,
    token,
    timeoutMs: 60_000,
  });
}

export function postSync(server: string, body: SyncRequest, token: string) {
  return request<SyncResponse>(server, "/api/device/sync", {
    method: "POST",
    body,
    token,
    timeoutMs: 60_000,
  });
}

export function handoffUrl(server: string, code: string): string {
  return `${server}/api/device/handoff?code=${encodeURIComponent(code)}`;
}
