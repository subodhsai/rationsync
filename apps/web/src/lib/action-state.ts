import type { ZodError } from "zod";

/** Result of a form's server action, rendered by the form. */
export type ActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> }
  | { status: "success"; message: string }
  | { status: "preview"; message: string };

export const idle: ActionState = { status: "idle" };

export function invalid(error: ZodError): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
  const count = Object.keys(fieldErrors).length;
  return {
    status: "error",
    message: count === 1 ? "Fix the highlighted field." : `Fix the ${count} highlighted fields.`,
    fieldErrors,
  };
}

/** Preview mode checks input with the same schema the API uses, then saves nothing. */
export const preview = (whatWouldHappen: string): ActionState => ({
  status: "preview",
  message: `Preview only: ${whatWouldHappen} Nothing was saved.`,
});
