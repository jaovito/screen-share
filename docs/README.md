# Documentation

Start with the [project README](../README.md) to install/run locally and [CONTRIBUTING.md](../CONTRIBUTING.md) to submit changes.

| Document                        | Use                                                      |
| ------------------------------- | -------------------------------------------------------- |
| [Development](development.md)   | Windows prerequisites, local modes, migrations, binaries |
| [Architecture](architecture.md) | Implemented modules, contracts, dependency boundaries    |
| [Frontend](frontend.md)         | Feature organization, aliases, Tailwind, localization    |
| [Testing](testing.md)           | Check selection, disposable resources, per-file coverage |
| [Security](security.md)         | Implemented controls and future product requirements     |
| [Deployment](deployment.md)     | Explicit HTTPS/TURN production setup; private database   |
| [Signed releases](releases.md)  | Operator signing, fixed update feed and draft artifacts  |
| [GitHub governance](github.md)  | CI, code ownership, merge/approval policy                |
| [Roadmap](../PLAN.md)           | Milestones and evidence required to advance              |
| [Architecture decisions](adr)   | Historical decisions and superseding choices             |
| [Validation log](validation.md) | Dated evidence and unexecuted platform/CI gates          |
| [Agent workflows](agents.md)    | Repository-local coding assistant instructions           |

Historical benchmark results and setup prompts describe earlier stages; current setup instructions are in the root/app READMEs. Versioned configuration and passing checks do not imply implemented media, E2EE, or native Windows validation.

- [M1 experiment](media-proof.md): offline grants, opt-in receiver, disposable transport regression, Windows acquisition boundary and pending hardware gate.

- [Native M1 utility](../apps/media-proof-native/README.md): explicit Windows publisher, private key export and hardware gate.

- [M1 hardware runbook](m1-hardware-runbook.md): Windows/two-PC procedure and unexecuted advancement gates.
