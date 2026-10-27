export default {
  documentTitle: 'Screen Share — Viewer',
  badge: 'M0 · Project foundation',
  eyebrow: 'A place to watch together',
  heading: 'Your screen. Your friends.',
  intro:
    'The foundation of a private sharing experience. The player, rooms, and invitation access will be implemented in future milestones.',
  playerLabel: 'Future player',
  playerHeading: 'The next moment starts here',
  playerUnavailable:
    'Player not implemented yet. No media, camera, or microphone connection is started.',
  mediaPending: 'Awaiting the media proof · M1',
  connectionHeading: 'Control connection',
  apiLoading: 'Connecting to the API…',
  apiReady: 'API connected · database ready',
  apiUnavailable: 'API or database unavailable',
  apiError: 'Incompatible API response',
  retry: 'Check again',
  controlNotice: 'API connectivity does not prove audio or video transport.',
  catalogHeading: 'Eight options for the future',
  catalogNotice: "Product catalog. This computer's capability has not been detected yet.",
  catalogLoading: 'Loading catalog…',
  catalogUnavailable: 'The catalog will be available when the API is ready.',
  profileLabel: '{{height}}p · {{fps}} FPS',
  footer:
    'Native capture and product authentication remain unavailable. The M1 receiver is experimental.',
  proofHeading: 'M1 · Experimental encrypted receiver',
  proofNotice:
    'Opt-in technical proof. Obtain an expiring viewer grant from the trusted operator and the media key through a separate encrypted channel. Credentials stay in memory and are cleared from the form on connection. This does not verify the Windows publisher, end-to-end encryption, or production readiness.',
  proofGrant: 'Viewer grant JSON',
  proofKey: 'Independent media key',
  proofConsent:
    'I trust the operator and this server, and explicitly want to connect to the selected proof session.',
  proofConnect: 'Connect to proof',
  proofDisconnect: 'Disconnect',
  proofVideo: 'Experimental screen-sharing video',
  proofState_idle: 'Disconnected. No media connection is started automatically.',
  proofState_connecting: 'Configuring encryption and connecting…',
  proofState_waiting:
    'Connected. Waiting for the designated publisher’s encrypted screen-share video.',
  proofState_subscribed:
    'Subscribed to encrypted video. Playback does not establish hardware or privacy verification.',
  proofState_invalidGrant: 'Invalid grant. Use a current, operator-issued viewer grant.',
  proofState_invalidKey: 'Invalid media key. Use the independently distributed 43-character key.',
  proofState_unsupported:
    'Encrypted reception requires a secure browser context with supported encoded transforms.',
  proofState_expired: 'Grant expired or outside the five-minute proof window. Request a new grant.',
  proofState_failed:
    'Reception stopped. The connection, publisher, track, or encryption requirements could not be maintained. Reconnect explicitly with a valid grant and key.',
};
