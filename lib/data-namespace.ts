const DATA_NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/;
const STELLAR_SECRET_SEED_PATTERN = /^S[A-Z2-7]{55}$/;

export function validateDataNamespace(value: string): string {
  const namespace = value.trim();

  if (STELLAR_SECRET_SEED_PATTERN.test(namespace)) {
    throw new Error(
      "AVEN_DATA_NAMESPACE must be a non-secret label, not a Stellar secret seed.",
    );
  }
  if (!DATA_NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(
      "AVEN_DATA_NAMESPACE must be 3-64 lowercase letters, numbers, dots, underscores, or hyphens.",
    );
  }

  return namespace;
}

export function resolveDataNamespace(options: {
  configured?: string;
  streamContractId?: string;
  verifierSecret?: string;
  production: boolean;
}): string {
  const configured = options.configured?.trim();

  if (configured) {
    if (options.verifierSecret && configured === options.verifierSecret.trim()) {
      throw new Error(
        "AVEN_DATA_NAMESPACE must not contain AVEN_VERIFIER_SECRET. Use a stable label such as aven-ste-testnet-v1.",
      );
    }
    return validateDataNamespace(configured);
  }

  if (options.production) {
    throw new Error(
      "AVEN_DATA_NAMESPACE is required in production so contract updates cannot hide persisted records.",
    );
  }

  return options.streamContractId?.trim() || "local";
}
