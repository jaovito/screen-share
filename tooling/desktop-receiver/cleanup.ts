export async function finalizeFixture(
  failure: unknown,
  cleanup: ReadonlyArray<() => unknown | Promise<unknown>>,
) {
  const errors: unknown[] = failure === undefined ? [] : [failure];
  for (const release of cleanup) {
    try {
      await release();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      'Desktop receiver failed; all cleanup actions were attempted',
      {
        cause: errors[0],
      },
    );
}
