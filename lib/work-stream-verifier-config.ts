export class WorkVerifierConfigurationError extends Error {
  readonly httpStatus = 503;

  constructor(message: string) {
    super(message);
    this.name = "WorkVerifierConfigurationError";
  }
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    const cause = "cause" in error ? error.cause : undefined;
    return `${error.message}\n${cause === undefined ? "" : errorText(cause)}`;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

/**
 * Legacy testnet stream contracts predate the read-only `get_verifier` method.
 * Match only the host's explicit missing-function diagnostic so RPC failures and
 * errors from newer contracts still fail closed.
 */
export function isLegacyVerifierGetterMissing(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return (
    text.includes("trying to invoke non-existent contract function") &&
    text.includes("get_verifier")
  );
}

export function isVerifierNotConfigured(error: unknown): boolean {
  return /error\s*\(\s*contract\s*,\s*#?\s*31\s*\)/i.test(errorText(error));
}

export function assertWorkVerifierMatches(
  serverVerifier: string,
  contractVerifier: unknown,
) {
  if (typeof contractVerifier !== "string" || contractVerifier.trim() === "") {
    throw new WorkVerifierConfigurationError(
      "Withdrawal service is unavailable because the stream contract has no verifier configured.",
    );
  }

  if (contractVerifier.trim().toUpperCase() !== serverVerifier.trim().toUpperCase()) {
    throw new WorkVerifierConfigurationError(
      "Withdrawal service is unavailable because the server verifier does not match the stream contract.",
    );
  }
}
