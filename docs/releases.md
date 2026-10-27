# Signed Windows release preparation

The normal Windows CI artifact remains an unsigned development build. The manually dispatched [release workflow](../.github/workflows/release.yml) prepares signed **Tauri updater** artifacts and a GitHub **draft**. It does not publish a release, deploy servers, configure DNS or certify Windows/GPU/two-PC acceptance. Tauri updater signatures are distinct from Windows Authenticode/SmartScreen signing.

## Operator-owned prerequisites

Create a GitHub environment named `signed-release` with required human reviewers and branch restrictions allowing only reviewed `main`. Configure its approval policy **before** adding signing secrets; merely naming an environment in YAML does not establish protection. Keep normal branch/PR/code-owner checks enabled. Only a trusted maintainer should manually dispatch the workflow from `main`.

Generate a persistent signing key pair outside this repository using the pinned Tauri CLI. The official [updater signing guide](https://tauri.app/plugin/updater/) describes private/public key handling. Generate once, retain an encrypted offline backup and verify recovery. Never commit the private key or show it in a chat, log or screenshot. The CLI's generation output can contain key material; run it privately. Losing the private key prevents signing future updates for already installed clients.

Configure the protected environment:

| Setting                              | Kind                 | Purpose                                                      |
| ------------------------------------ | -------------------- | ------------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | Secret               | Private key **contents**, available only to the signing step |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Secret, if encrypted | Key password                                                 |
| `SCREEN_SHARE_UPDATE_PUBLIC_KEY`     | Environment variable | Matching Tauri `.pub` file **contents**, never its path      |

No signing credentials were created/configured by this implementation. Ordinary development/CI must work with updates unavailable. The release script refuses missing signing inputs rather than creating an unsigned update channel. An operator-supplied Windows Authenticode certificate is a separate future integration; updater signatures alone do not establish a Microsoft-verified publisher.

## Reviewed version and fixed endpoint

Update/review matching versions in package/Tauri/Cargo metadata through a PR and pass required CI. Create a reviewed `vMAJOR.MINOR.PATCH` tag pointing to the exact `main` commit to build. The workflow rejects another branch; the build verifies that the existing tag points to its checked-out commit. It never creates/moves tags or changes version files automatically.

The compiled control URL (`SCREEN_SHARE_API_URL`) must be your configured public HTTPS origin from [deployment.md](deployment.md). Supply the matching public WSS SFU origin as `SCREEN_SHARE_RTC_URL`; desktop playback permits only that exact RTC origin and its HTTP counterpart. Both values are public build configuration. Native cookies remain inside the Rust client. The updater endpoint is fixed to the package's GitHub repository:

```text
https://github.com/jaovito/screen-share/releases/latest/download/latest.json
```

Forks must intentionally update repository metadata before establishing a separate signing identity/channel. Private keys never enter the Tauri JSON override. The script supplies only the public key, public HTTPS endpoint, and `createUpdaterArtifacts: true`. The pinned CLI binds updater signatures to the application version during `tauri build`. If an operator signs an artifact manually, `tauri signer sign --app-version <matching-version>` is required; an unbound signature is not an acceptable update. Tauri's official [`--config` merge](https://tauri.app/reference/cli/#build) is used by the desktop build.

For structure-only validation, set the variables privately in your environment and run:

```bash
bun --no-env-file scripts/build-release.ts --check
```

This validates formats/version/configuration, not whether the private/public key pair matches, signatures verify or Windows linking works. The actual signing/build requires Windows x64, pinned MSVC/Rust/Bun and the reviewed existing Git tag. Dependencies are installed from the frozen lockfile. Cargo/CMake parallelism is limited to two jobs.

## Dispatch and inspect the draft

From GitHub Actions, manually dispatch **Prepare signed Windows release** on `main`, providing the exact existing tag, public API origin and public WSS RTC origin. Protected-environment approval is required according to the configured policy. The first job has read-only repository permission; only the dependent draft-creation job receives `contents: write`.

The build produces fresh version-matching NSIS installers and `.sig` files, an updater `latest.json`, release notes with the exact Git revision, and `SHA256SUMS`. It refuses missing signatures/stale artifacts and exclusively stages `target/signed-release/<tag>/`. The workflow checks hashes after artifact transfer, then creates a **draft** release; an existing release causes an explicit failure rather than silently replacing its assets. No PR/push event triggers this workflow. No step publishes/promotes the draft.

Before publishing manually:

- Verify the embedded API and RTC origins, update public key/channel and version against the intended deployment.
- Test installation and update from a previous signed test version using the matching trusted public key. A mismatched signer key must fail verification. Reject tampered artifact/signature combinations.
- Complete Windows hardware/two-PC, scope preservation, audio consent, revocation/migration, restrictive-network and prolonged acceptance for the exact candidate. Review [PLAN.md](../PLAN.md) and [validation.md](validation.md).
- Review private security findings, dependency/license notices and sanitized release notes. Ensure no credentials, personal media or raw support dumps are attached.

A GitHub draft is not served by the public `releases/latest` endpoint. Publishing/promoting it updates that public channel only after the operator decides the candidate is acceptable. There is no automatic downgrade, silent unsigned fallback or changing the trusted key from server-provided data. Treat signing-key compromise as a separate incident requiring reviewed recovery/distribution decisions.
