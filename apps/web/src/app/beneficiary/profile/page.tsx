import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink, PageHeader, PageSkeleton, Panel } from "@/components/page";
import { ProfileForm } from "@/components/visit-forms";
import { requireRole } from "@/lib/session";
import { getProfile } from "@/lib/visit-data";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Profile />
    </Suspense>
  );
}

async function Profile() {
  const session = await requireRole("beneficiary");
  const profile = await getProfile(session);
  return (
    <>
      <div className="space-y-2">
        <BackLink href="/beneficiary">Home</BackLink>
        <PageHeader title="Your profile" />
      </div>
      <Panel title="Details">
        <ProfileForm fullName={profile.fullName} preferredLanguage={profile.preferredLanguage} />
      </Panel>
    </>
  );
}
