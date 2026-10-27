import { expect, it } from 'bun:test';
import { evaluateCodeOwnerReview, type Review } from './code-owner-policy';

const headSha = 'a'.repeat(40);
const base = { authorId: 2, codeOwnerId: 1, headSha };
function review(overrides: Partial<Review> = {}): Review {
  return {
    id: 1,
    user: { id: 1 },
    state: 'APPROVED',
    commit_id: headSha,
    submitted_at: '2026-10-26T12:00:00Z',
    ...overrides,
  };
}

it('exempts only PRs authored by the immutable code-owner identity', () => {
  expect(evaluateCodeOwnerReview({ ...base, authorId: 1, reviews: [] }).approved).toBe(true);
  expect(evaluateCodeOwnerReview({ ...base, reviews: [] }).approved).toBe(false);
  expect(evaluateCodeOwnerReview({ ...base, authorId: null, reviews: [] }).approved).toBe(false);
});

it('requires the code owner rather than another reviewer, and the current commit rather than an old one', () => {
  expect(evaluateCodeOwnerReview({ ...base, reviews: [review()] }).approved).toBe(true);
  for (const candidate of [
    review({ user: { id: 3 } }),
    review({ user: null }),
    review({ commit_id: 'b'.repeat(40) }),
    review({ state: 'PENDING', submitted_at: null }),
  ])
    expect(evaluateCodeOwnerReview({ ...base, reviews: [candidate] }).approved).toBe(false);
});

it('invalidates an approval after changes requested or dismissal but not a comment', () => {
  for (const state of ['CHANGES_REQUESTED', 'DISMISSED'] as const)
    expect(
      evaluateCodeOwnerReview({ ...base, reviews: [review(), review({ id: 2, state })] }).approved,
    ).toBe(false);
  expect(
    evaluateCodeOwnerReview({ ...base, reviews: [review(), review({ id: 2, state: 'COMMENTED' })] })
      .approved,
  ).toBe(true);
});

it('uses submission order rather than array order or review creation order', () => {
  const later = review({ id: 1, submitted_at: '2026-10-26T14:00:00Z' });
  const earlier = review({ id: 9, state: 'CHANGES_REQUESTED' });
  expect(evaluateCodeOwnerReview({ ...base, reviews: [later, earlier] }).approved).toBe(true);
});

it('fails closed for malformed ownership or commit metadata', () => {
  for (const codeOwnerId of [0, -1, Number.NaN])
    expect(evaluateCodeOwnerReview({ ...base, codeOwnerId, reviews: [review()] }).approved).toBe(
      false,
    );
  expect(evaluateCodeOwnerReview({ ...base, headSha: 'not-a-sha', reviews: [] }).approved).toBe(
    false,
  );
});
