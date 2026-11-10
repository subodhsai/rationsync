import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ApiErrorBody } from "@rationsync/shared";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req) => {
  throw new HttpError(404, "not_found", `No route for ${req.method} ${req.path}`);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: ApiErrorBody = {
    error: { code: "internal_error", message: "Something went wrong on our side. Try again in a moment." },
  };

  if (err instanceof HttpError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: "validation_failed",
        message: "Some fields are missing or invalid.",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  } else if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
    status = err.status ?? 400;
    body = { error: { code: "invalid_body", message: "The request body could not be read." } };
  }

  if (status === 500) req.log.error({ err }, "unhandled error");
  res.status(status).json(body);
};
