# GitHub contribution and merge policy

Repository: https://github.com/jaovito/screen-share. License: MIT. Default branch: main. The maintainer and universal code owner is @jaovito, defined in .github/CODEOWNERS.

## Main branch

Changes require a pull request. Direct pushes, force pushes, and deletion are blocked. Required CI jobs are typescript-postgres, portable-rust, windows-desktop, and compose-image. The required Code owner approval check comes from GitHub Actions. Review threads must be resolved; squash is the supported merge method.

Two rulesets separate non-bypassable PR/check requirements from native review requirements. The native code-owner rule requires one approval and dismisses stale approvals. Only @jaovito (immutable GitHub user ID 61637710) can bypass that review rule through a PR, allowing the owner to merge their own PR. They cannot bypass the separate PR/check ruleset. Administrative access can still edit repository settings; these rules are not protection against an owner deliberately changing governance.

## Author-specific approval exception

GitHub's native bypass is based on the merge actor, not the PR author. A required metadata-only check enforces the narrower policy:

- PR authored by the repository's personal owner/code owner: no approval required; PR/CI requirements remain.
- PR authored by anyone else: require the universal code owner's latest effective APPROVED review on the current head SHA.
- A new head commit, dismissal, or changes-requested review invalidates the policy approval. Ordinary comments do not erase an approval. Another reviewer's approval cannot satisfy code ownership.

The check reads the default branch's CODEOWNERS and repository owner identity, compares immutable GitHub user IDs, and queries current PR/review metadata. It does not trust a PR's proposed policy or CODEOWNERS file. This implementation intentionally supports one universal personal code owner; ownership/policy changes must update the implementation and tests together.

## Workflow isolation

CI uses pull_request and main pushes with read-only contents access and pinned action commits. It can execute contribution code but receives no production credentials or deployment permissions. Fork workflows may need maintainer execution approval.

Review events have a separate read-only signal workflow. A privileged workflow_run reconciliation also reacts to CI requests/completion and explicit workflow_dispatch. It checks out only main, never the PR ref, executes only trusted policy code, reads live metadata, and writes a narrowly scoped check to each open PR's head. It never downloads contribution artifacts/caches or executes PR code with a write token. Reconciliation is asynchronous; wait for the current head's checks before merging.

If reconciliation/API access fails, a newly started policy check remains pending/failing rather than granting approval. Rerun the policy workflow after resolving the problem; do not bypass required checks to work around it. GitHub Actions is not allowed to create approving PR reviews.

## Maintenance

The repository rules are versioned in `.github/rulesets/*.json` and configured through gh/GitHub APIs. Keep required context names aligned with CI jobs. Do not add admin bypass to the PR/check ruleset. Changing CODEOWNERS, workflows, or policy code is itself code-owned. Use .github/PULL_REQUEST_TEMPLATE.md and public issue templates; internal ticket IDs are not required.

Private vulnerability reporting is available through SECURITY.md. Normal contribution workflows need no production secrets, signing certificate, or deployment access.

Primary references: [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [check runs](https://docs.github.com/en/rest/checks/runs).
