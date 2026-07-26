import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  resolveDataNamespace,
  validateDataNamespace,
} from "../data-namespace.ts";

describe("data namespace validation", () => {
  test("accepts a stable non-secret deployment label", () => {
    assert.equal(
      validateDataNamespace("aven-ste-testnet-v1"),
      "aven-ste-testnet-v1",
    );
  });

  test("rejects a Stellar secret seed", () => {
    assert.throws(
      () =>
        validateDataNamespace(
          "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ),
      /not a Stellar secret seed/,
    );
  });

  test("rejects the verifier secret even before format validation", () => {
    assert.throws(
      () =>
        resolveDataNamespace({
          configured: "shared-secret",
          verifierSecret: "shared-secret",
          production: true,
        }),
      /must not contain AVEN_VERIFIER_SECRET/,
    );
  });

  test("requires an explicit stable namespace in production", () => {
    assert.throws(
      () =>
        resolveDataNamespace({
          streamContractId: "CEXAMPLE",
          production: true,
        }),
      /required in production/,
    );
  });

  test("allows a contract-scoped fallback outside production", () => {
    assert.equal(
      resolveDataNamespace({
        streamContractId: "CEXAMPLE",
        production: false,
      }),
      "CEXAMPLE",
    );
  });
});
