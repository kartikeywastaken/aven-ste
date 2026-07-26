import "server-only";

/**
 * Aven GitHub App service layer.
 *
 * Required GitHub App permissions:
 *   - Repository administration: write  (create, transfer repositories)
 *   - Repository contents:       read   (verify commits exist)
 *   - Repository metadata:       read   (list repos, branches, metadata)
 *   - Members:                   read   (collaborator invitations)
 *
 * Never export raw Octokit instances — all GitHub operations go through the
 * typed functions below. Installation tokens are generated on demand and
 * used immediately. Repository transfer is the sole exception because GitHub
 * requires a user access token for that endpoint; the callback passes that
 * short-lived token directly and it is never stored in Redis or logs.
 */

import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { getGithubAppEnv } from "./github-env";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GithubRepo = {
  id: number;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  private: boolean;
};

export type GithubCompare = {
  commits: Array<{
    sha: string;
    shortSha: string;
    message: string;
    authorName?: string;
    committedAt?: string;
    htmlUrl: string;
  }>;
  files: Array<{
    path: string;
    previousPath?: string;
    status: "added" | "modified" | "removed" | "renamed";
    additions: number;
    deletions: number;
    changes: number;
    blobUrl?: string;
  }>;
  totals: {
    commits: number;
    files: number;
    additions: number;
    deletions: number;
  };
};

export class GithubIntegrationError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus = 502) {
    super(message);
    this.name = "GithubIntegrationError";
    this.httpStatus = httpStatus;
  }
}

function githubStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }
  return undefined;
}

function githubMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function githubFailure(error: unknown, operation: string): GithubIntegrationError {
  if (error instanceof GithubIntegrationError) return error;

  const message = githubMessage(error);
  const status = githubStatus(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("private key") ||
    lower.includes("decoder routines") ||
    lower.includes("openssl") ||
    lower.includes("pem")
  ) {
    return new GithubIntegrationError(message, 503);
  }
  if (lower.includes("missing required environment variable") || lower.includes("placeholder")) {
    return new GithubIntegrationError(`GitHub configuration error: ${message}`, 503);
  }
  if (status === 401) {
    return new GithubIntegrationError(
      `GitHub App authentication failed while trying to ${operation}. Verify GITHUB_APP_ID and upload a newly generated private key that belongs to the same GitHub App.`,
      502,
    );
  }
  if (status === 404) {
    return new GithubIntegrationError(
      `GitHub could not find the app installation while trying to ${operation}. Verify GITHUB_APP_INSTALLATION_ID belongs to the configured App ID and that the app is still installed on GITHUB_AVEN_ORG.`,
      502,
    );
  }
  if (status === 403) {
    if (operation.includes("with user authorization")) {
      return new GithubIntegrationError(
        `GitHub denied permission to ${operation}. Confirm the linked user is an organization owner or repository administrator and that the destination has no repository or fork named the same.`,
        403,
      );
    }
    return new GithubIntegrationError(
      `GitHub denied permission to ${operation}. Verify the app installation has Repository administration: read and write, approve any pending permission update, and confirm the organization permits private repository creation and outside collaborators.`,
      502,
    );
  }
  if (status === 422) {
    return new GithubIntegrationError(
      `GitHub rejected the request to ${operation}. Check for an existing repository with the same name, organization repository policies, outside-collaborator restrictions, or invitation limits.`,
      422,
    );
  }

  return new GithubIntegrationError(
    `GitHub failed to ${operation}${status ? ` (HTTP ${status})` : ""}: ${message}`,
  );
}

async function githubOperation<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw githubFailure(error, operation);
  }
}

// ─── Installation client factory ─────────────────────────────────────────────

/**
 * Generate a short-lived GitHub App installation token and return an
 * authenticated Octokit instance.  Tokens are valid for ~1 hour and are
 * never persisted anywhere — each call generates a fresh token.
 */
async function getInstallationOctokit(): Promise<Octokit> {
  const token = await createInstallationToken();
  return new Octokit({ auth: token });
}

async function createInstallationToken(): Promise<string> {
  return githubOperation("authenticate the configured installation", async () => {
    const env = getGithubAppEnv();
    const app = new App({
      appId: env.appId,
      privateKey: env.privateKey,
    });
    const { data } = await app.octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      { installation_id: env.installationId },
    );
    return data.token;
  });
}

// ─── Exported service functions ───────────────────────────────────────────────

export async function getInstallationToken(): Promise<string> {
  return createInstallationToken();
}

export async function createRepository(options: {
  name: string;
  description: string;
}): Promise<GithubRepo> {
  const env = getGithubAppEnv();
  const octokit = await getInstallationOctokit();
  return githubOperation("create the managed organization repository", async () => {
    const { data } = await octokit.repos.createInOrg({
      org: env.avenOrg,
      name: options.name,
      description: options.description,
      private: true,
      auto_init: false,
    });
    return {
      id: data.id,
      fullName: data.full_name,
      htmlUrl: data.html_url,
      cloneUrl: data.clone_url,
      sshUrl: data.ssh_url,
      defaultBranch: data.default_branch,
      private: data.private,
    };
  });
}

export async function getRepository(fullName: string): Promise<GithubRepo | null> {
  const octokit = await getInstallationOctokit();
  try {
    const [owner, repo] = fullName.split("/");
    const { data } = await octokit.repos.get({ owner, repo });
    return {
      id: data.id,
      fullName: data.full_name,
      htmlUrl: data.html_url,
      cloneUrl: data.clone_url,
      sshUrl: data.ssh_url,
      defaultBranch: data.default_branch,
      private: data.private,
    };
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw githubFailure(err, "read the managed repository");
  }
}

export async function addCollaborator(
  fullName: string,
  username: string,
  permission: "pull" | "push",
): Promise<void> {
  const octokit = await getInstallationOctokit();
  const [owner, repo] = fullName.split("/");
  await githubOperation(`invite @${username} to the managed repository`, () =>
    octokit.repos.addCollaborator({ owner, repo, username, permission }),
  );
}

export async function removeCollaborator(
  fullName: string,
  username: string,
): Promise<void> {
  const octokit = await getInstallationOctokit();
  const [owner, repo] = fullName.split("/");
  await githubOperation(`remove @${username} from the managed repository`, () =>
    octokit.repos.removeCollaborator({ owner, repo, username }),
  );
}

export async function listBranches(fullName: string): Promise<string[]> {
  const octokit = await getInstallationOctokit();
  const [owner, repo] = fullName.split("/");
  const { data } = await githubOperation("list repository branches", () =>
    octokit.repos.listBranches({ owner, repo, per_page: 100 }),
  );
  return data.map((b) => b.name);
}

export async function commitExists(fullName: string, sha: string): Promise<boolean> {
  const octokit = await getInstallationOctokit();
  const [owner, repo] = fullName.split("/");
  try {
    await octokit.repos.getCommit({ owner, repo, ref: sha });
    return true;
  } catch (err: any) {
    if (err?.status === 404 || err?.status === 422) return false;
    throw githubFailure(err, "verify a repository commit");
  }
}

export async function branchExists(fullName: string, branch: string): Promise<boolean> {
  const octokit = await getInstallationOctokit();
  const [owner, repo] = fullName.split("/");
  try {
    await octokit.repos.getBranch({ owner, repo, branch });
    return true;
  } catch (err: any) {
    if (err?.status === 404) return false;
    throw githubFailure(err, "verify a repository branch");
  }
}

export async function getBranchHead(fullName: string, branch: string): Promise<string | null> {
  const octokit = await getInstallationOctokit();
  const [owner, repo] = fullName.split("/");
  try {
    const { data } = await octokit.repos.getBranch({ owner, repo, branch });
    return data.commit.sha;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw githubFailure(err, "read a repository branch");
  }
}

export async function compareCommits(
  fullName: string,
  base: string,
  head: string,
): Promise<GithubCompare> {
  const octokit = await getInstallationOctokit();
  const [owner, repo] = fullName.split("/");
  const { data } = await githubOperation("compare repository commits", () =>
    octokit.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${base}...${head}`,
    }),
  );

  const commits = (data.commits ?? []).map((c) => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0] ?? "",
    authorName: c.commit.author?.name ?? c.author?.login,
    committedAt: c.commit.committer?.date,
    htmlUrl: c.html_url,
  }));

  const fileStatusMap: Record<string, GithubCompare["files"][number]["status"]> = {
    added: "added",
    modified: "modified",
    removed: "removed",
    renamed: "renamed",
  };

  const files = (data.files ?? []).map((f) => ({
    path: f.filename,
    previousPath: f.previous_filename,
    status: fileStatusMap[f.status] ?? "modified",
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    blobUrl: f.blob_url,
  }));

  const totals = {
    commits: commits.length,
    files: files.length,
    additions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
  };

  return { commits, files, totals };
}

export async function transferRepository(
  fullName: string,
  newOwner: string,
): Promise<void> {
  const octokit = await getInstallationOctokit();
  const [owner, repo] = fullName.split("/");
  await githubOperation(`transfer the repository to ${newOwner}`, () =>
    octokit.repos.transfer({ owner, repo, new_owner: newOwner }),
  );
}

export async function transferRepositoryAsUser(
  fullName: string,
  newOwner: string,
  accessToken: string,
): Promise<void> {
  const octokit = new Octokit({ auth: accessToken });
  const [owner, repo] = fullName.split("/");
  await githubOperation(`transfer the repository to ${newOwner} with user authorization`, () =>
    octokit.repos.transfer({ owner, repo, new_owner: newOwner }),
  );
}

export async function getRepositoryOwner(repoId: number): Promise<string> {
  const octokit = await getInstallationOctokit();
  // Use the /repositories/{id} endpoint which survives transfers.
  const { data } = await githubOperation("check repository ownership", () =>
    octokit.request("GET /repositories/{repository_id}", {
      repository_id: repoId,
    }),
  );
  return data.owner.login as string;
}

export function repositoryHtmlUrl(fullName: string): string {
  return `https://github.com/${fullName}`;
}

export function compareHtmlUrl(fullName: string, base: string, head: string): string {
  return `https://github.com/${fullName}/compare/${base}...${head}`;
}
