import type { ShopApplication } from "@rationsync/shared";
import { FileText } from "lucide-react";
import { DetailList } from "@/components/page";
import { ShopStatusLabel } from "@/components/status";
import { formatBytes, formatDateTime } from "@/lib/format";

/** What the applicant submitted. Used by the applicant's status page and the reviewer's detail page. */
export function ApplicationDetails({ application }: { application: ShopApplication }) {
  return (
    <DetailList
      rows={[
        ["FPS ID", <span key="fps" className="font-mono">{application.fpsId}</span>],
        ["Shop name", application.name],
        ["Address", `${application.address}${application.pinCode ? `, ${application.pinCode}` : ""}`],
        ["Taluk, district", `${application.taluk}, ${application.district}`],
        ["Phone", application.contactPhone],
        ["Email", application.contactEmail ?? "Not given"],
        ["Supplying warehouse", `${application.warehouse.name} (${application.warehouse.code})`],
        ["Submitted", formatDateTime(application.submittedAt)],
      ]}
    />
  );
}

/**
 * Document names with optional links. Links are short-lived signed URLs created for the
 * signed-in viewer; preview mode has no stored files, so it lists names only.
 */
export function DocumentList({
  application,
  links = {},
}: {
  application: ShopApplication;
  links?: Record<string, string>;
}) {
  if (application.documents.length === 0) {
    return <p className="text-[0.9375rem] text-muted-foreground">No supporting documents were attached.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {application.documents.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
          <FileText className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {links[d.id] ? (
              <a href={links[d.id]} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
                {d.fileName}
              </a>
            ) : (
              <p className="truncate font-medium">{d.fileName}</p>
            )}
            <p className="text-[0.8125rem] text-muted-foreground">
              {formatBytes(d.sizeBytes)} · added {formatDateTime(d.uploadedAt)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DecisionHistory({ application }: { application: ShopApplication }) {
  if (application.reviews.length === 0) return <p className="text-[0.9375rem] text-muted-foreground">No decisions yet.</p>;
  return (
    <ol className="space-y-4">
      {application.reviews.map((r) => (
        <li key={r.id} className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ShopStatusLabel status={r.decision} />
            <span className="text-[0.8125rem] text-muted-foreground tabular-nums">
              {formatDateTime(r.createdAt)} · {r.reviewerName || "Warehouse administrator"}
            </span>
          </div>
          <p className="text-[0.9375rem]">{r.reason}</p>
        </li>
      ))}
    </ol>
  );
}
