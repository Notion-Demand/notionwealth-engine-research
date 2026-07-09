export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class EntitlementError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "EntitlementError";
  }
}

export class QuotaExceededError extends Error {
  readonly status = 429;
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export function isDomainError(
  err: unknown
): err is NotFoundError | UnauthorizedError | EntitlementError | QuotaExceededError {
  return (
    err instanceof NotFoundError ||
    err instanceof UnauthorizedError ||
    err instanceof EntitlementError ||
    err instanceof QuotaExceededError
  );
}
