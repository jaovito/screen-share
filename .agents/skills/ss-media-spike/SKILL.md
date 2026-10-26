---

name: ss-media-spike
description: "Run or prepare an authorized technical proof of WGC capture, D3D11, H.264 encoding, LiveKit/WebRTC, and two-PC E2EE according to PLAN.md M1."
---

# Conduct a media proof

Read [PLAN.md](../../../PLAN.md) sections 6–12 and 14–15, [architecture](../../../docs/architecture.md), and [security](../../../docs/security.md). Work only on the requested experiment; this skill does not turn a documentation request into M1 implementation or start capture on its own.

Define a falsifiable hypothesis and passage criterion before coding/measuring: investigated stage, controlled input, expected output, budget, and failure signals. Revalidate exact-version WGC/D3D11/Media Foundation/LiveKit Rust capabilities in primary sources. An API's existence does not prove efficient integration, a functional Windows encoder, or supported pre-encoded reception.

Prepare a minimal WGC → texture → conversion/scaling → H.264 → RTC → viewer slice with explicit ownership, bounded queues, and cancellation. Instrument the changed stage without recording content: timestamps/counters, copies, queue, and losses. Deltas use the same stream and reset baseline after reconnect; p95 requires real samples. Unmeasured fields stay unavailable.

On Windows and two real PCs, record versions/hardware, profile, synthetic scene, network, duration, and game load. Exercise source inactivity, Alt+Tab, minimization, closure, and same-source recovery as relevant. Distinguish a source that stopped rendering from stuck capture. Never capture another window/monitor/audio scope without explicit selection.

Before client-to-client publication, validate authorization and E2EE configuration; failures block publication. Healthy SFU, TLS, playback, or a configuration flag alone do not prove the server cannot read media. Record the proof method and negative cases without storing real keys, tokens, or personal images. One spatial layer does not guarantee independent per-viewer quality.

If Windows/GPU/a second PC is unavailable, provide feasible analysis, portable code, or an experiment protocol and list unexecuted steps. Never simulate metrics. Stop and release owned resources on errors/authorization loss. Do not distribute installers or expose local Compose as an implicit part of the spike.

Deliver an English report with hypothesis, change, environment, method, observed results, deviations, and advance/revise decision. Update the milestone gate only when evidence covers its criteria.
