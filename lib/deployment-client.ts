"use client";

import {
  ATTESTATION_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  REPUTATION_CONTRACT_ID,
  STREAM_CONTRACT_ID,
  XLM_ASSET_ID,
} from "./contracts";

type DeploymentIdentity = {
  streamContractId: string;
  attestationContractId: string;
  reputationContractId: string;
  xlmAssetId: string;
  networkPassphrase: string;
};

export async function ensureCurrentDeployment() {
  const response = await fetch("/api/deployment", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not verify the active application deployment.");
  }
  const deployment = await response.json() as DeploymentIdentity;
  const expected = [
    STREAM_CONTRACT_ID,
    ATTESTATION_CONTRACT_ID,
    REPUTATION_CONTRACT_ID,
    XLM_ASSET_ID,
    NETWORK_PASSPHRASE,
  ];
  const active = [
    deployment.streamContractId,
    deployment.attestationContractId,
    deployment.reputationContractId,
    deployment.xlmAssetId,
    deployment.networkPassphrase,
  ];
  const changed = expected.some(
    (value, index) =>
      value.trim().toUpperCase() !== (active[index] ?? "").trim().toUpperCase(),
  );
  if (changed) {
    window.location.reload();
    throw new Error("A newer Stellar deployment is active. Refreshing this page.");
  }
}
