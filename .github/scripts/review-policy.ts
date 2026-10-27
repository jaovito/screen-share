import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { evaluateCodeOwnerReview } from '../../tooling/github/code-owner-policy';

const identity = z.object({ id: z.number().int().positive() });
const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const repositorySchema = z.object({
  owner: identity.extend({ login: z.string(), type: z.literal('User') }),
  default_branch: z.string(),
});
const pullSchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(['open', 'closed']),
  user: identity.nullable(),
  head: z.object({ sha }),
  base: z.object({ ref: z.string() }),
});
const reviewSchema = z.object({
  id: z.number().int().positive(),
  user: identity.nullable(),
  state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']),
  commit_id: sha.nullable(),
  submitted_at: z.iso.datetime().nullable(),
});

async function main() {
  const env = z
    .object({
      GITHUB_REPOSITORY: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      GITHUB_TOKEN: z.string().min(1),
      GITHUB_API_URL: z.url().default('https://api.github.com'),
      GITHUB_SERVER_URL: z.url().default('https://github.com'),
      GITHUB_RUN_ID: z.string().regex(/^\d+$/),
    })
    .parse(process.env);
  const prefix = `/repos/${env.GITHUB_REPOSITORY}`;
  const details = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;

  async function request<T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: unknown) {
    const response = await fetch(`${env.GITHUB_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub policy API request failed (${response.status}).`);
    return schema.parse(await response.json());
  }

  async function pages<T>(path: string, schema: z.ZodType<T>) {
    const values: T[] = [];
    for (let page = 1; ; page++) {
      const batch = await request(
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
        z.array(schema),
      );
      values.push(...batch);
      if (batch.length < 100) return values;
    }
  }

  const repository = await request(prefix, repositorySchema);
  const ownership = readFileSync(new URL('../CODEOWNERS', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (
    ownership.length !== 1 ||
    ownership[0]?.toLowerCase() !== `* @${repository.owner.login}`.toLowerCase()
  )
    throw new Error(
      'This policy requires the repository personal owner as the sole universal CODEOWNER.',
    );

  const pulls = await pages(
    `${prefix}/pulls?state=open&base=${encodeURIComponent(repository.default_branch)}`,
    pullSchema,
  );
  for (const candidate of pulls) {
    const pull = await request(`${prefix}/pulls/${candidate.number}`, pullSchema);
    if (pull.state !== 'open' || pull.base.ref !== repository.default_branch) continue;
    const check = await request(`${prefix}/check-runs`, identity, 'POST', {
      name: 'Code owner approval',
      head_sha: pull.head.sha,
      status: 'in_progress',
      details_url: details,
      external_id: `pull-${pull.number}`,
      output: {
        title: 'Checking code-owner policy',
        summary: 'Reading current PR and review metadata.',
      },
    });
    try {
      const reviews = await pages(`${prefix}/pulls/${pull.number}/reviews`, reviewSchema);
      const decision = evaluateCodeOwnerReview({
        authorId: pull.user?.id ?? null,
        codeOwnerId: repository.owner.id,
        headSha: pull.head.sha,
        reviews,
      });
      await request(`${prefix}/check-runs/${check.id}`, identity, 'PATCH', {
        status: 'completed',
        conclusion: decision.approved ? 'success' : 'action_required',
        output: {
          title: decision.approved ? 'Approval policy satisfied' : 'Code-owner approval required',
          summary: `${decision.reason}\n\nCode owner: @${repository.owner.login}. Head: ${pull.head.sha}.`,
        },
      });
      console.log(
        `PR #${pull.number}: ${decision.approved ? 'approved by policy' : 'review required'}`,
      );
    } catch {
      await request(`${prefix}/check-runs/${check.id}`, identity, 'PATCH', {
        status: 'completed',
        conclusion: 'failure',
        output: {
          title: 'Policy evaluation failed',
          summary: 'No approval granted. Check workflow/API access and rerun.',
        },
      });
      throw new Error('Code-owner policy reconciliation failed.');
    }
  }
  console.log(`Reconciled ${pulls.length} open pull request(s).`);
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof z.ZodError
      ? 'Invalid GitHub policy metadata.'
      : error instanceof Error
        ? error.message
        : 'Code-owner policy failed.',
  );
  process.exitCode = 1;
});
