import type { AppNotification } from "@rationsync/shared";
import { Router } from "express";
import { actorOf } from "../auth.js";
import type { Db } from "../db.js";

// In-app notifications for whoever is signed in. Written only by database functions.
export function notificationsRouter(db: Db): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const { rows } = await db.query<AppNotification>(
      `select id, kind, title, body, created_at as "createdAt", read_at as "readAt"
         from public.notifications where user_id = $1
        order by created_at desc limit 50`,
      [actorOf(req).id],
    );
    res.json({ items: rows, unread: rows.filter((n) => !n.readAt).length });
  });

  router.post("/read", async (req, res) => {
    const { rows } = await db.query<{ count: number }>("select public.mark_notifications_read($1) as count", [actorOf(req).id]);
    res.json({ marked: rows[0]!.count });
  });

  return router;
}
