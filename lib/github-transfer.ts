import "server-only";

import { getIdentity } from "./github-identity-store";
import { getRepository, type ProjectRepositoryRecord } from "./github-repository-store";
import { getBranchHead } from "./github-service";
import { getTransferBranchProofs } from "./github-transfer-proof";
import { listSessionsForStream } from "./session-store";
import type { WorkSession } from "./work-session";
import { addressesEqual, getOnchainStream } from "./work-session-server";

export type TransferEligibility =
  | {
      eligible: true;
      destination: string;
      repository: ProjectRepositoryRecord;
      session: WorkSession;
    }
  | {
      eligible: false;
      reason: string;
      status: number;
    };

const DESTINATION_PATTERN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;

/**
 * Enforces the complete repository-transfer gate. Delivery claims originate
 * on the worker's machine, so selected branch heads are rechecked with GitHub
 * before ownership can move.
 *
 * Organization destinations cannot be proven without retaining a user OAuth
 * token. Aven deliberately does not retain that token, so the safe supported
 * destination is the client's linked GitHub account.
 */
export async function checkTransferEligibility(options: {
  streamId: string;
  walletAddress: string;
  destination: string;
}): Promise<TransferEligibility> {
  const destination = options.destination.trim();
  if (!DESTINATION_PATTERN.test(destination)) {
    return { eligible: false, reason: "A valid GitHub destination is required.", status: 400 };
  }

  const stream = await getOnchainStream(options.streamId);
  if (!stream) return { eligible: false, reason: "Stream not found.", status: 404 };
  if (!addressesEqual(stream.sender, options.walletAddress)) {
    return {
      eligible: false,
      reason: "Only the stream sender can request a repository transfer.",
      status: 403,
    };
  }

  const [repository, clientIdentity, sessions] = await Promise.all([
    getRepository(options.streamId),
    getIdentity(stream.sender),
    listSessionsForStream(options.streamId),
  ]);
  if (!repository) {
    return { eligible: false, reason: "No repository found for this stream.", status: 404 };
  }
  if (repository.status !== "ACTIVE" && repository.status !== "TRANSFER_FAILED") {
    return {
      eligible: false,
      reason: `Repository status is ${repository.status}; it cannot be transferred.`,
      status: 409,
    };
  }
  if (!clientIdentity || clientIdentity.githubLogin.toLowerCase() !== destination.toLowerCase()) {
    return {
      eligible: false,
      reason: "The destination must be the stream sender's linked GitHub account.",
      status: 422,
    };
  }

  const session = sessions.find((candidate) => candidate.report?.session.projectEnded === true);
  if (!session) {
    return { eligible: false, reason: "No final project session was found.", status: 409 };
  }
  if (session.status !== "RELEASED") {
    return { eligible: false, reason: "The final project payment has not been released.", status: 409 };
  }
  if (!session.releasedTxHash) {
    return { eligible: false, reason: "The final Stellar release transaction is missing.", status: 409 };
  }

  const deliveryBranches = getTransferBranchProofs(session);
  if (!deliveryBranches) {
    return { eligible: false, reason: "The final repository delivery is incomplete.", status: 409 };
  }

  for (const branch of deliveryBranches) {
    const remoteHead = await getBranchHead(repository.fullName, branch.name);
    if (!remoteHead || remoteHead.toLowerCase() !== branch.headCommit.toLowerCase()) {
      return {
        eligible: false,
        reason: `Delivery branch '${branch.name}' no longer matches its verified head commit.`,
        status: 409,
      };
    }
  }

  return { eligible: true, destination, repository, session };
}
