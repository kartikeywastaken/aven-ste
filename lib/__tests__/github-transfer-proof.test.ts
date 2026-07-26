import assert from "node:assert/strict";
import test from "node:test";
import { getTransferBranchProofs } from "../github-transfer-proof.ts";
import type { WorkSession } from "../work-session.ts";

function session(overrides?: Partial<WorkSession>): WorkSession {
  return {
    id: "session-1",
    streamId: "2",
    workerAddress: "GWORKER",
    clientAddress: "GCLIENT",
    status: "RELEASED",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    report: {
      schemaVersion: 1,
      session: {
        sessionId: "session-1",
        projectId: "project-1",
        streamId: "2",
        workerAddress: "GWORKER",
        startedAt: "2026-07-26T00:00:00.000Z",
        endedAt: "2026-07-26T00:01:00.000Z",
        totalSeconds: 60,
        activeSeconds: 60,
        idleSeconds: 0,
        packageVersion: "0.3.0",
        projectEnded: true,
      },
      repository: {
        repositoryId: "repo-1",
        branchAtStart: "main",
        branchAtEnd: "main",
        startingCommit: "1".repeat(40),
        endingCommit: "2".repeat(40),
        dirtyAtStart: false,
        dirtyAtEnd: false,
      },
      changes: {
        changedFiles: [],
        additions: 0,
        deletions: 0,
        commits: [],
        testsChanged: 0,
        documentationFilesChanged: 0,
        generatedFilesExcluded: 0,
      },
      localVerification: {
        verifierVersion: "1",
        workType: "code",
        flags: [],
        summary: "ok",
      },
      paymentRequest: {
        requestedAmount: "1",
        asset: "XLM",
      },
      privacy: {
        profile: "standard",
        excludedFileCount: 0,
        secretWarnings: 0,
        fullFilesIncluded: false,
      },
    },
    ...overrides,
  };
}

test("uses explicit verified delivery branches for current reports", () => {
  const value = session();
  value.report!.delivery = {
    selectedBranches: [{
      name: "main",
      headCommit: "3".repeat(40),
      verifiedOnRemote: true,
    }],
    includedTags: [],
    repositoryComplete: true,
  };

  assert.deepEqual(getTransferBranchProofs(value), [{
    name: "main",
    headCommit: "3".repeat(40),
  }]);
});

test("recovers package 0.2 final reports from the ending branch and commit", () => {
  const value = session();
  value.report!.session.packageVersion = "0.2.0";

  assert.deepEqual(getTransferBranchProofs(value), [{
    name: "main",
    headCommit: "2".repeat(40),
  }]);
});

test("does not bypass missing delivery proof for current reports", () => {
  assert.equal(getTransferBranchProofs(session()), null);
});

test("rejects incomplete explicit delivery metadata", () => {
  const value = session();
  value.report!.delivery = {
    selectedBranches: [{
      name: "main",
      headCommit: "3".repeat(40),
      verifiedOnRemote: false,
    }],
    includedTags: [],
    repositoryComplete: false,
  };

  assert.equal(getTransferBranchProofs(value), null);
});
