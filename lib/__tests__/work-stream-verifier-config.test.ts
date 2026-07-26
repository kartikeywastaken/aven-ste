import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWorkVerifierMatches,
  isLegacyVerifierGetterMissing,
  isVerifierNotConfigured,
  WorkVerifierConfigurationError,
} from "../work-stream-verifier-config.ts";

test("accepts the verifier configured on the contract", () => {
  assert.doesNotThrow(() => assertWorkVerifierMatches("GABCDEF", "gabcdef"));
});

test("reports a service configuration error when the verifier differs", () => {
  assert.throws(
    () => assertWorkVerifierMatches("GSERVER", "GCONTRACT"),
    (error: unknown) => {
      assert.ok(error instanceof WorkVerifierConfigurationError);
      assert.equal(error.httpStatus, 503);
      assert.match(error.message, /does not match/i);
      return true;
    },
  );
});

test("reports a service configuration error when no verifier is configured", () => {
  assert.throws(
    () => assertWorkVerifierMatches("GSERVER", undefined),
    (error: unknown) => {
      assert.ok(error instanceof WorkVerifierConfigurationError);
      assert.equal(error.httpStatus, 503);
      assert.match(error.message, /no verifier configured/i);
      return true;
    },
  );
});

test("recognizes the missing getter on legacy testnet contracts", () => {
  const error = new Error(
    'HostError: Error(WasmVm, MissingValue), data:["trying to invoke non-existent contract function", get_verifier]',
  );

  assert.equal(isLegacyVerifierGetterMissing(error), true);
});

test("does not hide unrelated contract or RPC failures", () => {
  assert.equal(
    isLegacyVerifierGetterMissing(
      new Error("HostError: Error(WasmVm, MissingValue) while calling get_verifier"),
    ),
    false,
  );
  assert.equal(
    isLegacyVerifierGetterMissing(
      new Error(
        'data:["trying to invoke non-existent contract function", get_stream]',
      ),
    ),
    false,
  );
});

test("recognizes the contract's VerifierNotConfigured error", () => {
  assert.equal(
    isVerifierNotConfigured(
      new Error("HostError: Error(Contract, #31), Event log: verify_work"),
    ),
    true,
  );
  assert.equal(
    isVerifierNotConfigured(new Error("Stream 31 was not found.")),
    false,
  );
});
