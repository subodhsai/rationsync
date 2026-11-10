import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame, AuthNotConfigured } from "@/components/auth-frame";
import { SignInForm } from "@/components/auth-forms";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthFrame
      title="Sign in"
      footer={
        isSupabaseConfigured && (
          <>
            New to RationSync?{" "}
            <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
              Create an account
            </Link>
          </>
        )
      }
    >
      {isSupabaseConfigured ? <SignInForm /> : <AuthNotConfigured />}
    </AuthFrame>
  );
}
