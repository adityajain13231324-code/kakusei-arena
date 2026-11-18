# KAKUSEI ARENA — Online netcode

Online 1v1 with room codes, peer-to-peer over WebRTC, GGPO-style rollback.

## Player flow

1. Main menu → **ONLINE** → **CREATE ROOM**. You get a 6-character code (no 0/O/1/I) and a share link
   `<origin><path>#join-ABC123`, with **COPY LINK** and **WHATSAPP** (`https://wa.me/?text=…`) buttons.
2. Your friend opens the link (the app jumps straight to the room on load or on `hashchange`) or types the code in
   **JOIN ROOM** (a pasted link works too).
3. Lobby: each player picks their own fighter (+ EASY/PRO inputs) and presses **READY**. The host picks the stage
   (Neon Rooftop / Sakura Shrine / Random) and presses **START MATCH** once both are ready.
4. VS screen → match with rollback. Ping + connection bars sit under the round timer (click them for dev stats).
   "WAITING FOR OPPONENT…" appears when the rollback window is exhausted.
5. Results: **REMATCH** (starts when both press it, same fighters/stage, new seed), **CHARACTER SELECT** (both go back
   to the lobby), **LEAVE ROOM**. If the other player leaves, closes the tab or goes silent for 10 s you get a toast
   and return to the online menu.

The host is always P1 (left), the guest P2 (right). Every local control layout (both keyboard layouts, any gamepad,
touch) drives your fighter.

## Architecture (`src/net/`)

| File | Role |
|---|---|
| `protocol.ts` | Message types, `Transport` / `TransportFactory` interfaces, room codes, share links. |
| `rollback.ts` | **RollbackSession** — the rollback core. No DOM, no transport; clock is injected. Headless-testable. |
| `netsession.ts` | **NetSession** extends the app's `MatchSession`: the app shell drives it exactly like a local match (`advance(dt)`, `state`, `prev`, `alpha`), so render/VFX/audio/HUD are untouched. |
| `online.ts` | **OnlineController** — room lifecycle, lobby sync, match start handshake, rematch, disconnects. |
| `peer.ts` | PeerJS/WebRTC transport (production). |
| `local.ts` | BroadcastChannel transport (two tabs, no server) — `?net=local`, used by the e2e test. |
| `overlay.ts` | In-match DOM overlay (ping, bars, waiting banner, desync warning). |

UI: `src/ui/screens/online.ts` (`online` and `onlinelobby` screens). App hooks: `App.startNetMatch / finishNetMatch /
leaveNetMatch`, `Mode` gained `'online'`, the ONLINE menu item is enabled.

### Transport

* `peerjs` npm package with the free PeerJS cloud signaling server. Peer id = `'kakusei-' + roomCode`; the host
  claims the id (an `unavailable-id` error regenerates the code), the guest connects to it.
* Two data channels on one RTCPeerConnection:
  * `ctl` — PeerJS DataConnection, reliable + ordered, JSON: lobby, start/loaded, rematch, state hashes, resync.
  * `game` — raw *negotiated* RTCDataChannel (id 7) with `{ ordered:false, maxRetransmits:0 }` (truly unreliable;
    PeerJS's own `reliable:false` is only unordered). Inputs and pings. If it can't be created, everything goes over `ctl`.
* ICE: Google public STUN (`stun{,1,2,3}.l.google.com:19302`) plus an optional TURN server (below).
* To swap signaling (e.g. a custom WebSocket server), implement `TransportFactory { host(code, onOpen), join(code) }`
  returning a `Transport { send, onMessage, onClose, close }` and return it from `pickFactory()` in `online.ts`.

### Rollback core (`RollbackSession`)

* Fixed 60 Hz. `tick(localInput)` once per 1/60 s; `receive(msg)` for every packet.
* **Input delay**: local input sampled on a tick is scheduled for `curFrame + delay`. Auto delay 1–3 frames from
  RTT (<50 ms → 1, <130 ms → 2, else 3), starts at 2, changes by at most 1 per second.
* **Prediction**: unknown remote input = last confirmed remote input. Out-of-order received inputs are used as soon
  as they arrive.
* **Snapshots**: `cloneState` before every simulated frame into a 16-slot ring.
* **Rollback**: when a received remote input differs from what frame *f* was simulated with, restore the snapshot of
  *f* and resimulate to the current frame (max depth = 8).
* **Prediction window**: never simulate more than 8 frames past the last contiguously confirmed remote frame —
  stall instead (overlay shows "waiting").
* **Packets**: every tick, all un-acked local inputs (from the peer's ack + 1, ≤ 64) + our ack + current frame +
  frame-advantage estimate. This redundancy covers packet loss without retransmission.
* **Time sync**: each side estimates how many frames it is ahead (`curFrame − (remoteFrame + RTT/2 + age)`) and sends
  it; if `(mine − theirs) / 2 ≥ 1` (smoothed) the leading peer idles one tick (at most once every 12 ticks).
* **Desync detection**: every 30 confirmed frames both peers exchange `hashState` of the confirmed state. On mismatch
  the overlay shows a dev warning and the **host** sends the serialized confirmed state (epoch-tagged); the guest
  replaces its state at that frame and resimulates to its current frame. Hashes from before a resync are ignored.
* **Match boundaries**: input/hash/sync packets carry the match number; stale packets from a previous match are dropped.

### Events during rollback

Only `RollbackSession` talks to VFX/audio/HUD (via `onEvents`), once per tick, in frame order:

* a newly simulated frame forwards all its events and records them (multiset keyed by
  `type|player|target|moveId|tag`) as *presented* for that frame;
* a **resimulated** frame forwards only events that exceed what was already presented for that frame — nothing is
  ever re-forwarded on resim, and a hit that only exists in the corrected timeline still gets its spark/sound.

An event shown from a mispredicted timeline is not retracted (typical rollback behaviour; at ≤ 8 frames it is rare and
brief). The headless test checks no event of the final timeline is missing and that duplication stays < 25 %
(measured ≈ 1–3 % at 80–150 ms).

### Online differences

* **`state.slowmo` does not slow the sim online.** Locally the session doubles the tick duration during slow motion;
  online both peers must tick at the same rate, so NetSession always runs 60 Hz (slow-mo remains a render/VFX hint).
* Pause only opens the menu; the match keeps running and you send neutral input. Window blur does not auto-pause.
* Training-only features (reset, dummy) are unavailable.
* If `requestAnimationFrame` is throttled (background tab, occluded window), a 16 ms interval keeps the sim and input
  stream running (browsers may still throttle timers to 1 Hz in background tabs; the other player then sees
  "waiting").

## Testing

```bash
npm run test:net        # headless: two RollbackSessions over a fake network (≈2 s)
npm test                # sim tests (unchanged)
```

`tests/net.ts` scenarios, each 3000 frames of random inputs: 0 ms; 30 ms ±5 / 1 % loss; 80 ms ±20 / 3 % loss /
+0.3 % clock skew; 150 ms ±30 / 10 % loss / −0.5 % skew (one-way latency). Checks: all ~100 exchanged confirmed-state
hashes equal; offline replay of the agreed input streams gives the same hash; rollbacks happen; depth ≤ 8; peers stay in
time sync; events complete without re-forwarding. Plus: forced guest corruption → desync detected → host resync →
hashes equal again; a 1.5 s blackout → stall → recovery with no desync; room-code parsing.

**Two-browser e2e** (`tests/e2e_online.py`, Playwright + Chrome): two pages in one browser context play through the real
UI with the BroadcastChannel transport — create room, open the `#join-` link, pick fighters, ready, start, play a full
match with simulated 40 ms ±15 / 3 % loss, compare hashes across browsers, results, rematch, leave.

```bash
npx vite --port 5186 --strictPort &
python3 tests/e2e_online.py http://localhost:5186/ "lag=40&jitter=15&loss=0.03&rounds=1"
```

WebGL is disabled by default in that script (software-rendering two 3D pages runs ≈1 fps in the sandbox); set
`E2E_WEBGL=1` to keep it. `rounds=1` (honoured only with `net=local`) shortens the match.

Manual two-tab test without internet: open `http://localhost:5173/?net=local` in two tabs; add
`&lag=80&jitter=20&loss=0.05` to simulate a bad connection.

**Not tested here:** the real PeerJS cloud / WebRTC path — `0.peerjs.com` is blocked by this sandbox's network
allowlist. Test it on the deployed build with two devices (ideally one on mobile data).

## TURN server (for strict NATs)

STUN works for most home networks, but symmetric NAT / CGNAT (some mobile carriers, office and school Wi-Fi) needs a
TURN relay. Set these at build time (Vercel → Project → Settings → Environment Variables, then redeploy):

```
VITE_TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
VITE_TURN_USERNAME=kakusei
VITE_TURN_CREDENTIAL=secret
```

Options: a hosted service (Metered.ca, Twilio, Cloudflare Calls TURN — free tiers exist) or your own
[coturn](https://github.com/coturn/coturn) on a small VPS (`listening-port=3478`, `tls-listening-port=5349`,
`lt-cred-mech`, `user=kakusei:secret`, `realm=…`, open UDP 49152–65535). Static credentials end up in the client
bundle; for anything public prefer short-lived credentials from a tiny serverless endpoint.

Own PeerJS signaling server (instead of the shared free cloud): run `npx peerjs --port 9000 --key kakusei` (or deploy
`peerjs-server`) and set `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE`, `VITE_PEER_KEY`.

## Known limits

* Depends on the free PeerJS cloud server for signaling (no SLA; room ids are public, codes are 32^6 ≈ 10^9).
* No TURN by default → some network pairs cannot connect (the join times out after 20 s with an explanation).
* 1v1 only, no spectators, no reconnection to a running match (a drop ends the match).
* Beyond ~130 ms one-way (≈ 260 ms RTT) the 8-frame window + 3-frame delay is exceeded and play stutters (stalls).
* Background tabs: browsers throttle timers; the backgrounded player effectively freezes the match until they return
  (10 s of silence ends it).
* Desync recovery copies the host's state; it is a safety net (the sim is deterministic and tested), not a feature.
* Each peer runs the same JS sim; mixing deployments/versions is detected only by the `hello` version check (toast).
