/**
 * One error type for every failure. `code` is deliberately coarse (see contract 00 §12.3/§13):
 * callers can branch on it, but it never says which internal check failed, and messages
 * never contain secret values.
 */
export type CeremonyErrorCode =
  | "format_invalid"
  | "ticket_invalid"
  | "host_list_invalid"
  | "release_invalid"
  | "approval_invalid"
  | "decrypt_failed"
  | "key_invalid";

export class CeremonyError extends Error {
  readonly code: CeremonyErrorCode;
  constructor(code: CeremonyErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CeremonyError";
    this.code = code;
  }
}

export function fail(code: CeremonyErrorCode, message?: string): never {
  throw new CeremonyError(code, message);
}
