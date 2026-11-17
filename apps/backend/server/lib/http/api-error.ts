/** An answer the API gives on purpose, written for the person reading it; the status says how to take it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NotAuthenticatedError extends ApiError {
  constructor(message = "Sign in to continue") {
    super(message, 401);
    this.name = "NotAuthenticatedError";
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "You do not have access to this") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends ApiError {
  constructor(what: string) {
    super(`${what} not found`, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ApiError {
  constructor() {
    super("This page was changed somewhere else since you opened it", 409);
    this.name = "ConflictError";
  }
}
