import "server-only";
import type { ApiErrorBody } from "@rationsync/shared";
import { publicEnv } from "@/lib/env";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${publicEnv.apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "api_unreachable", "The RationSync API could not be reached.");
  }

  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? "request_failed",
      body?.error?.message ?? `The API answered with status ${res.status}.`,
    );
  }
  return body as T;
}
