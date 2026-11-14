/**
 * errors — the typed error hierarchy (FRONTEND_WORKFLOW.md §4.1).
 * Throw these inside core/ + services; catch + translate at the composable/store seam.
 * Each carries a machine `code` and an optional plain-language `userMessage`.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly cause?: unknown,
    readonly userMessage?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {}
export class DbError extends AppError {}
export class SyncError extends AppError {}
export class NetworkError extends AppError {}
export class AuthError extends AppError {}
export class ConflictError extends AppError {}
export class BackendError extends AppError {}
