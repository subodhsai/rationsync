"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";
import { recordDocument } from "@/lib/shop-actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Uploads straight to the private Storage bucket with the person's own session, into a folder
 * named after their user id (enforced by a Storage policy), then asks the API to record it.
 */
export function DocumentUploader({ userId, remaining }: { userId: string; remaining: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ActionState>({ status: "idle" });
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      return setState({ status: "error", message: "Choose a PDF, JPEG or PNG file." });
    }
    if (file.size > MAX_BYTES) return setState({ status: "error", message: "Files can be at most 5 MB." });

    setBusy(true);
    const safeName = file.name.replace(/[^\w.-]+/g, "-").slice(-80);
    const storagePath = `${userId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await createSupabaseBrowserClient()
      .storage.from("shop-documents")
      .upload(storagePath, file, { contentType: file.type, upsert: false });
    setState(
      error
        ? { status: "error", message: "The upload failed. Check your connection and try again." }
        : await recordDocument({ storagePath, fileName: file.name }),
    );
    setBusy(false);
    if (input.current) input.current.value = "";
  }

  if (remaining <= 0) {
    return <p className="text-[0.875rem] text-muted-foreground">This application already has the maximum of 5 documents.</p>;
  }

  return (
    <div className="space-y-3">
      <FormStatus state={state} />
      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(",")}
        className="sr-only"
        id="document-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
        {busy ? "Uploading" : "Add a document"}
      </Button>
      <p className="text-[0.875rem] text-muted-foreground">PDF, JPEG or PNG, up to 5 MB. For example, a copy of your FPS licence.</p>
    </div>
  );
}
