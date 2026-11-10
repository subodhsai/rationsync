"use client";

import { signInSchema, signUpSchema, type AccountType } from "@rationsync/shared";
import { Loader2, MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Errors = Partial<Record<string, string>>;

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  const errors: Errors = {};
  for (const issue of issues) errors[String(issue.path[0])] ??= issue.message;
  return errors;
}

export function SignInForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = signInSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});

    setPending(true);
    const { error } = await createSupabaseBrowserClient().auth.signInWithPassword(parsed.data);
    if (error) {
      setPending(false);
      setFormError(
        error.code === "email_not_confirmed"
          ? "Confirm your email address first. Check your inbox for the link."
          : "Email or password is incorrect.",
      );
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <Field id="email" label="Email" type="email" autoComplete="email" required error={errors.email} />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        error={errors.password}
      />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {pending ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}

const accountTypes: Array<{ value: AccountType; title: string; detail: string }> = [
  { value: "beneficiary", title: "Household", detail: "Check shop stock and book collection times" },
  { value: "shop_admin", title: "Ration shop administrator", detail: "Register a Fair Price Shop for approval" },
];

export function SignUpForm() {
  const router = useRouter();
  const [accountType, setAccountType] = useState<AccountType>("beneficiary");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = signUpSchema.safeParse({ ...Object.fromEntries(new FormData(event.currentTarget)), accountType });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});

    setPending(true);
    const { fullName, email, password } = parsed.data;
    const { data, error } = await createSupabaseBrowserClient().auth.signUp({
      email,
      password,
      options: {
        // Read once by the database trigger; it can only ever produce beneficiary or shop_admin.
        data: { full_name: fullName, account_type: accountType },
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
      },
    });
    setPending(false);
    if (error) {
      setFormError(error.code === "weak_password" ? "Choose a stronger password." : error.message);
      return;
    }
    if (data.session) {
      router.replace("/dashboard");
      router.refresh();
    } else {
      setSentTo(email);
    }
  }

  if (sentTo) {
    return (
      <div role="status" className="space-y-3 rounded-lg border border-border bg-card p-5">
        <MailCheck className="size-6 text-primary" aria-hidden="true" />
        <p className="font-medium">Check your email</p>
        <p className="text-[0.9375rem] text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{sentTo}</span>. Open it to finish
          creating your account.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-[0.9375rem] font-medium">Account type</legend>
        {accountTypes.map((type) => (
          <label
            key={type.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 transition-colors duration-150",
              accountType === type.value ? "border-primary bg-primary-tint/60" : "border-border hover:bg-muted/60",
            )}
          >
            <input
              type="radio"
              name="accountType"
              value={type.value}
              checked={accountType === type.value}
              onChange={() => setAccountType(type.value)}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              <span className="block font-medium">{type.title}</span>
              <span className="block text-[0.875rem] text-muted-foreground">{type.detail}</span>
            </span>
          </label>
        ))}
        <p className="text-[0.875rem] text-muted-foreground">
          Warehouse administrator accounts are set up by the RationSync operators, not through this form.
        </p>
      </fieldset>
      <Field id="fullName" label="Full name" autoComplete="name" required error={errors.fullName} />
      <Field id="email" label="Email" type="email" autoComplete="email" required error={errors.email} />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 8 characters."
        error={errors.password}
      />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {pending ? "Creating account" : "Create account"}
      </Button>
    </form>
  );
}
