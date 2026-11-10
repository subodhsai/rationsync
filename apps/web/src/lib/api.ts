import "server-only";
import type { ApiErrorBody } from "@rationsync/shared";
import { publicEnv } from "@/lib/env";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function call<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${publicEnv.apiUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "api_unreachable", "The RationSync API could not be reached. Try again in a moment.");
  }

  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? "request_failed",
      body?.error?.message ?? `The API answered with status ${res.status}.`,
      body?.error?.details,
    );
  }
  return body as T;
}

export function apiGet<T>(path: string, accessToken: string): Promise<T> {
  return call<T>(path, accessToken);
}

export function apiSend<T>(
  method: "POST" | "PATCH",
  path: string,
  accessToken: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  return call<T>(path, accessToken, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}
