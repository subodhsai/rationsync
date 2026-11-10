import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame, AuthNotConfigured } from "@/components/auth-frame";
import { SignUpForm } from "@/components/auth-forms";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <AuthFrame
      title="Create an account"
      intro="Do not use a real ration-card number anywhere in this prototype."
      footer={
        isSupabaseConfigured && (
          <>
            Already registered?{" "}
            <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              Sign in
            </Link>
          </>
        )
      }
    >
      {isSupabaseConfigured ? <SignUpForm /> : <AuthNotConfigured />}
    </AuthFrame>
  );
}
