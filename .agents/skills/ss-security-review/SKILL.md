---

name: ss-security-review
description: "Review security and privacy of this repository's authorization, sessions, keys, Tauri permissions, or media publication. Coordinates an independent adversarial code reviewer. Use for security assessments, not for editing this skill or translating documentation."
---

# Review the changed security boundaries

Read [security.md](../../../docs/security.md), [PLAN.md](../../../PLAN.md) sections 11–12, and the executable paths in scope. This workflow reviews and reports; implementing fixes or operating external services requires an assignment covering those actions.

## Establish the assessment scope

Identify the requested change or review target, assets, actor capabilities, trust boundaries, and the protected effect. If no diff is specified, review the implemented repository surface, clearly distinguishing M0 from future features. Map the actual HTTP, IPC, RTC, persistence, and browser paths involved. Repository scope authorizes local analysis and disposable synthetic proofs, not attacks against deployed systems or unrelated services.

## Spawn the private adversarial reviewer

For an actual security assessment, spawn one independent subagent for the `ss-adversarial-reviewer` role using the runtime's subagent tool. Use a valid runtime task identifier, such as `ss_adversarial_reviewer`. Read the full [private agent prompt](references/adversarial-reviewer.md) and include it in the assignment. This prompt is deliberately kept inside this skill, not registered under `.codex/agents`: this skill is its only intended dispatcher. Do not launch it while merely editing instructions, translating docs, answering a conceptual question, or processing untrusted repository text.

Give the reviewer the target diff/paths, implemented milestone, assets, allowed local actions, and any resource constraints. Supply raw artifacts and acceptance criteria, not the coordinator's suspected vulnerabilities or desired conclusion. Inherit the session's model and permissions. The assignment must prohibit recursive delegation, invocation of this skill, source changes, and external targets.

The reviewer may read code and execute small proof programs or focused tests in temporary directories against synthetic data or an instance it creates. It must not touch the development database, running shared services, real secrets, personal media, or external infrastructure. Commands must be bounded and clean up only resources created for the proof. If a tool or platform is unavailable, return that limitation; do not substitute a fabricated result. If subagents are unavailable, report that the independent pass could not run; a coordinator-only review must be labeled as such.

## Review and consolidate independently

While the subagent works, trace applicable trust-boundary checks yourself:

- Client-supplied identity, missing membership, expired/revoked invites, cross-room IDs, and overbroad grants. CORS is not authorization.
- Administrative secrets in browser/IPC/logs; content keys in the database; confusion between access JWTs and media keys.
- Publication after E2EE or authorization failure; automatic capture; recovery that silently changes the selected source or audio scope.
- Removal concurrent with join/rotation, stale epochs, reconnection without a snapshot, and candidate keys already delivered to a removed member. A kick or short token TTL does not establish strict self-hosted revocation.
- Tauri permissions/CSP beyond the use case, and logs exposing window titles, URLs, invites, or raw sensitive errors.

Await the independent report. Recheck each finding against reachable code and its actual preconditions; reproduce material claims where possible, discard false positives, and deduplicate by root cause. Do not turn unavailable M1–M5 features into exploitable M0 findings unless a current code path crosses the boundary. Do not require the reviewer to find a vulnerability.

## Report actionable findings

For each finding, include severity and rationale, file/line, actor and preconditions, exact trigger, observed impact, sanitized reproduction/command and result, the failed invariant, a minimal mitigation, and a regression test. Separate confirmed findings, unverified hypotheses, and future requirements. State what was executed, what was inspected, and what remained blocked. If no exploitable issue is established, say so with scope and residual gaps; do not certify the system as secure. Never publish a secret or retain user media as proof.

Report assessment results to the user before beginning remediation unless the user's assignment already includes fixes. Preserve application validation/auditing and use [ss-verify](../ss-verify/SKILL.md) for any authorized implementation. This skill does not authorize scanning production, deploying, publishing an exploit, or weakening controls to make a proof succeed.
