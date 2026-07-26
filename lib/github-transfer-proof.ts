import type { WorkSession } from "./work-session";

export type TransferBranchProof = {
  name: string;
  headCommit: string;
};

const COMMIT_PATTERN = /^[a-f\d]{40}$/i;
const LEGACY_DELIVERY_VERSION_PATTERN = /^0\.2\./;

/**
 * Returns the branch heads that must still match GitHub before ownership moves.
 *
 * Package 0.2 final reports predate the explicit `delivery` block. They still
 * contain the ending branch and commit, so those reports can be supported
 * safely by rechecking that exact branch head against GitHub at transfer time.
 */
export function getTransferBranchProofs(
  session: WorkSession,
): TransferBranchProof[] | null {
  const report = session.report;
  if (!report) return null;

  if (report.delivery) {
    if (
      !report.delivery.repositoryComplete ||
      report.delivery.selectedBranches.length === 0 ||
      report.delivery.selectedBranches.some(
        (branch) =>
          !branch.verifiedOnRemote ||
          !branch.name.trim() ||
          !COMMIT_PATTERN.test(branch.headCommit),
      )
    ) {
      return null;
    }

    return report.delivery.selectedBranches.map((branch) => ({
      name: branch.name,
      headCommit: branch.headCommit,
    }));
  }

  if (!LEGACY_DELIVERY_VERSION_PATTERN.test(report.session.packageVersion)) {
    return null;
  }

  const branch = report.repository.branchAtEnd?.trim();
  const headCommit = report.repository.endingCommit?.trim();
  if (!branch || !headCommit || !COMMIT_PATTERN.test(headCommit)) {
    return null;
  }

  return [{ name: branch, headCommit }];
}
