export type Review = {
  id: number;
  user: { id: number } | null;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  commit_id: string | null;
  submitted_at: string | null;
};

export function evaluateCodeOwnerReview(input: {
  authorId: number | null;
  codeOwnerId: number;
  headSha: string;
  reviews: readonly Review[];
}) {
  const { authorId, codeOwnerId, headSha, reviews } = input;
  if (
    !Number.isSafeInteger(codeOwnerId) ||
    codeOwnerId <= 0 ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(headSha)
  )
    return { approved: false, reason: 'Invalid policy identity or head commit.' };
  if (authorId === codeOwnerId)
    return { approved: true, reason: 'The code owner authored this PR; no review is required.' };

  const latest = reviews
    .filter(
      (review) =>
        review.user?.id === codeOwnerId &&
        review.submitted_at !== null &&
        ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state),
    )
    .sort(
      (a, b) => Date.parse(b.submitted_at ?? '') - Date.parse(a.submitted_at ?? '') || b.id - a.id,
    )[0];

  if (latest?.state === 'APPROVED' && latest.commit_id === headSha)
    return { approved: true, reason: 'The code owner approved the current head commit.' };
  return {
    approved: false,
    reason: 'The current head commit needs an approving code-owner review.',
  };
}
