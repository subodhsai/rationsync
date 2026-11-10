import { shopRegistrationSchema, type WarehouseOption } from "@rationsync/shared";
import { Router } from "express";
import { z } from "zod";
import { actorOf, requireRole } from "../auth.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { loadApplication } from "../queries.js";

export const DOCUMENT_BUCKET = "shop-documents";
const MAX_DOCUMENTS = 5;

const documentInput = z.object({
  storagePath: z.string().min(3).max(300),
  fileName: z.string().trim().min(1).max(200),
});

// Applying to join RationSync. Available to shop administrators whatever their approval state.
export function registrationRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("shop_admin"));

  router.get("/", async (req, res) => {
    const { shop } = actorOf(req);
    res.json({ application: shop ? await loadApplication(db, shop.id) : null });
  });

  router.get("/warehouses", async (_req, res) => {
    const { rows } = await db.query<WarehouseOption>(
      "select id, code, name, district from public.warehouses order by district, name",
    );
    res.json({ items: rows });
  });

  router.post("/", async (req, res) => {
    const input = shopRegistrationSchema.parse(req.body);
    const { rows } = await db.query<{ id: string }>(
      "select id from public.submit_shop_registration($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [
        actorOf(req).id,
        input.fpsId,
        input.name,
        input.district,
        input.taluk,
        input.address,
        input.pinCode,
        input.contactPhone,
        input.contactEmail,
        input.warehouseId,
      ],
    );
    res.status(201).json({ application: await loadApplication(db, rows[0]!.id) });
  });

  // The browser uploads to Storage with its own session; this records the file only after
  // confirming it exists inside the caller's own folder.
  router.post("/documents", async (req, res) => {
    const actor = actorOf(req);
    const input = documentInput.parse(req.body);
    if (!actor.shop || actor.shop.status === "approved") {
      throw new HttpError(409, "documents_closed", "Documents can be added while an application is pending or rejected.");
    }
    if (!input.storagePath.startsWith(`${actor.id}/`) || input.storagePath.includes("..")) {
      throw new HttpError(403, "forbidden_path", "Upload documents into your own folder.");
    }

    const { rows: counts } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.shop_documents where shop_id = $1",
      [actor.shop.id],
    );
    if ((counts[0]?.n ?? 0) >= MAX_DOCUMENTS) {
      throw new HttpError(409, "too_many_documents", `An application can have at most ${MAX_DOCUMENTS} documents.`);
    }

    const { rows: objects } = await db.query<{ size: string | null; mimetype: string | null }>(
      `select metadata ->> 'size' as size, metadata ->> 'mimetype' as mimetype
         from storage.objects where bucket_id = $1 and name = $2`,
      [DOCUMENT_BUCKET, input.storagePath],
    );
    const object = objects[0];
    if (!object) throw new HttpError(400, "upload_missing", "The uploaded file was not found. Upload it again.");

    // Size and type come from Storage, not from the client.
    await db.query(
      `insert into public.shop_documents (shop_id, storage_path, file_name, content_type, size_bytes, uploaded_by)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (storage_path) do nothing`,
      [actor.shop.id, input.storagePath, input.fileName, object.mimetype, Number(object.size), actor.id],
    );
    res.status(201).json({ application: await loadApplication(db, actor.shop.id) });
  });

  return router;
}
