import type { AppRole, Language, Me, ShopStatus } from "@rationsync/shared";
import type { Request, RequestHandler } from "express";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";

declare module "express-serve-static-core" {
  interface Request {
    actor?: Me;
  }
}

export type VerifyToken = (token: string) => Promise<{ sub: string }>;

/**
 * Verifies Supabase access tokens. Asymmetric signing keys come from the project's JWKS
 * endpoint; HS256 is accepted only when the legacy secret is configured, so a token can
 * never choose a weaker algorithm than the server expects.
 */
export function createTokenVerifier(supabaseUrl: string, jwtSecret?: string): VerifyToken {
  const issuer = `${supabaseUrl}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const secret = jwtSecret ? new TextEncoder().encode(jwtSecret) : null;
  const options = { issuer, audience: "authenticated" };

  return async (token) => {
    const { alg } = decodeProtectedHeader(token);
    const { payload } =
      alg === "HS256" && secret
        ? await jwtVerify(token, secret, { ...options, algorithms: ["HS256"] })
        : await jwtVerify(token, jwks, { ...options, algorithms: ["ES256", "RS256"] });
    if (!payload.sub) throw new Error("token has no subject");
    return { sub: payload.sub };
  };
}

interface ActorRow {
  id: string;
  role: AppRole;
  full_name: string;
  preferred_language: Language;
  shop_id: string | null;
  fps_id: string | null;
  shop_name: string | null;
  shop_status: ShopStatus | null;
  review_reason: string | null;
  warehouse_ids: string[];
}

// Roles and memberships always come from the database, never from token metadata.
export async function loadActor(db: Db, userId: string): Promise<Me | null> {
  const { rows } = await db.query<ActorRow>(
    `select p.id, p.role, p.full_name, p.preferred_language,
            s.id as shop_id, s.fps_id, s.name as shop_name, s.status as shop_status, s.review_reason,
            coalesce(array_agg(wa.warehouse_id) filter (where wa.warehouse_id is not null), '{}') as warehouse_ids
       from public.profiles p
       left join public.shops s on s.owner_id = p.id
       left join public.warehouse_admins wa on wa.user_id = p.id
      where p.id = $1
      group by p.id, s.id`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    fullName: row.full_name,
    preferredLanguage: row.preferred_language,
    shop:
      row.shop_id && row.fps_id && row.shop_name && row.shop_status
        ? {
            id: row.shop_id,
            fpsId: row.fps_id,
            name: row.shop_name,
            status: row.shop_status,
            reviewReason: row.review_reason,
          }
        : null,
    warehouseIds: row.role === "warehouse_admin" ? row.warehouse_ids : [],
  };
}

export function authenticate(verify: VerifyToken, db: Db): RequestHandler {
  return async (req, _res, next) => {
    const match = /^Bearer (.+)$/i.exec(req.get("authorization") ?? "");
    if (!match?.[1]) throw new HttpError(401, "missing_token", "Sign in to continue.");

    let sub: string;
    try {
      ({ sub } = await verify(match[1]));
    } catch {
      throw new HttpError(401, "invalid_token", "Your session is invalid or has expired. Sign in again.");
    }

    const actor = await loadActor(db, sub);
    if (!actor) throw new HttpError(403, "profile_missing", "No RationSync profile exists for this account.");
    req.actor = actor;
    next();
  };
}

export function actorOf(req: Request): Me {
  if (!req.actor) throw new HttpError(401, "missing_token", "Sign in to continue.");
  return req.actor;
}

export function requireRole(...roles: AppRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!roles.includes(actorOf(req).role)) {
      throw new HttpError(403, "forbidden", "Your account does not have access to this area.");
    }
    next();
  };
}

// Shop admin permissions exist only once a warehouse administrator has approved the shop.
export const requireApprovedShop: RequestHandler = (req, _res, next) => {
  const actor = actorOf(req);
  if (actor.role !== "shop_admin") {
    throw new HttpError(403, "forbidden", "Your account does not have access to this area.");
  }
  if (actor.shop?.status !== "approved") {
    throw new HttpError(
      403,
      "shop_not_approved",
      "Shop tools unlock after a warehouse administrator approves your registration.",
    );
  }
  next();
};
