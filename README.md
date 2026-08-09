# ArtSlicer

A Jackbox-style party game. The host screen shows a QR code, everyone joins from
their phone, and each round you get a prompt and a pile of junk — scale it, slice
it, colourize it, and arrange it into something that vaguely resembles the
prompt. Then everyone votes on whose attempt was best.

**Play:** https://erictams.github.io/ArtSlicer/

One person taps **Start a game** on whatever screen the room can see — a laptop
or TV if there is one, otherwise just their phone. Everyone else scans the QR
code. The first player to join starts the game.

---

## How it works

GitHub Pages serves static files and nothing else — there is no server to run
game logic or hold a WebSocket. So the **host device is the server**: phones
connect straight to it over WebRTC, and it owns all game state and every
deadline. That device can be a laptop acting as a shared screen, or simply the
phone of the player who started the game.

```
       GitHub Pages (host and client are the SAME bundle)
                            │
      ┌─────────────────────┴──────────────────────┐
      │                                            │
 Host device /#/host   QR code ──────────►   Phone  /#/join/XYZ4
 • owns all game state                       • renders its slice of state
 • owns all timers                           • sends intents only
 • validates every message                   • never trusts itself
 • may also be playing                             │
      │                                            │
      └────── WebRTC DataChannel (star topology) ──┘
                            │
                  PeerJS Cloud broker
             (signalling only — no game data)
```

Clients connect only to the host, never to each other.

### The host can play too

When hosting from a phone there is no spare device to act as a screen, so that
player joins their own game through an **in-process loopback** that runs the
identical message path a remote phone uses — same validation, same ballot
filtering, same everything. There is no privileged local path that could drift
out of sync with the real one.

The host page adapts to its screen: a wide one shows the room-wide gallery and
reveal, a narrow one hands the display over to that player's own game. Either
default can be overridden. Every player also sees the full reveal on their own
phone, so a game with no big screen loses nothing but the shared "ohhh".

### The room code is the peer ID

The host claims `artslicer-XYZ4` on the PeerJS broker, where `XYZ4` is the room
code. Phones derive the peer ID from the code in their URL, so there is no
lookup service, no database, and no backend of any kind. If the code is already
taken, the host re-rolls and tries again.

### Why a signalling broker is unavoidable

A QR code can carry the host's WebRTC offer, but the handshake is bidirectional —
the phone must send its *answer* back, and a QR is a one-way channel. Offers are
also 1:1, so one static code cannot serve eight players. A shared mailbox for
~2 KB of handshake text is therefore required. That is all the broker is: it
sees the handshake, never any game data, and drops out once peers are connected.

### Artwork travels as a recipe, not pixels

A submitted drawing is a JSON list of piece placements in a fixed 1000×1000
space — a busy composition is a couple hundred bytes rather than a screenshot.
Because the host runs the same bundle, it already has every sprite and re-renders
the scene at full laptop resolution instead of upscaling a phone-sized image.

### Slicing is convex clipping

Each cut is a half-plane stored in the piece's local space, and the visible shape
is the piece's rectangle trimmed against all of them. Because half-plane
intersections are always convex, a small Sutherland–Hodgman pass is exact.
Storing cuts locally means they follow the piece when it is later moved, scaled,
or rotated.

### Tinting

Konva's per-node filters are too slow on a phone, so each (sprite, colour) pair
is composited once into a cached canvas and shared by every instance. The blend
is `multiply`, which preserves the sprite's shading instead of flattening it to a
silhouette.

> **This constrains the art.** Multiply can only darken, so source PNGs must be
> drawn **light** — near-white with soft grey shading. See below.

---

## Development

```bash
npm install
npm run dev          # http://localhost:5173/ArtSlicer/ (also exposed on the LAN)
npm test
npm run build
```

These query parameters make local playtesting possible without a pile of devices:

| Parameter | Effect |
|---|---|
| `?as=alice` | Namespaces the stored identity, so several tabs on one laptop act as distinct players |
| `?debug=3` | Turns on PeerJS logging, for diagnosing connection failures |
| `?screen=small` / `?screen=big` | Forces the host layout, so both can be checked without resizing |

There is also a standalone editor at `#/editor` for iterating on the build tools
without starting a lobby.

A typical local game: open `/ArtSlicer/#/host`, note the room code, then open
`/ArtSlicer/?as=alice#/join/CODE` and `?as=bob#/join/CODE` in two more tabs.

### Art pipeline

Pieces live in `public/pieces/<category>/<id>.png` — the directory names the
category. After adding or changing art:

```bash
npm run pieces              # rebuild src/assets/pieces.json from the PNGs
npm run pieces:placeholder  # regenerate the placeholder art, then the manifest
```

The current art is placeholder, generated from signed distance fields by
`scripts/make-placeholder-pieces.mjs`. Real art is a drop-in replacement as long
as it follows the light-toned spec above.

---

## Layout

```
src/
  shared/   protocol, scene format, game state — used by BOTH sides
  game/     reducer, scoring, prompts, persistence — pure, no React or PeerJS
  net/      WebRTC transport behind an interface
  render/   SceneView (the single renderer), tint cache, clip geometry
  editor/   canvas, piece tray, toolbar, slice gesture
  host/     host device: lobby, shared-screen views, loopback for the local player
  client/   the player UI, used by remote phones and by the host when it plays
```

Two rules keep this maintainable:

- **`src/game/reducer.ts` is a pure function.** It imports neither React nor
  PeerJS, so the entire game is testable without a browser or a network.
- **`src/render/SceneView.tsx` is the only renderer.** The phone editor wraps it
  with gestures; the host renders it read-only and larger. One implementation
  means a player's preview cannot drift from what the room sees.

---

## Known limits

- **No TURN server.** WebRTC needs a relay when both peers sit behind restrictive
  NATs. STUN alone covers same-Wi-Fi play and most home networks, which is the
  normal case for a party game, but guest Wi-Fi with client isolation or a phone
  on cellular can fail to connect. The app detects this and says so rather than
  hanging. Adding TURN is the only part of this design that would cost money.
- **The PeerJS cloud broker is shared and unmetered.** If it becomes unreliable,
  `src/net/` is behind an interface: self-hosting `peerjs-server` is a few lines,
  or [Trystero](https://trystero.dev/) can be swapped in.
- **A host that switches apps stalls the room.** iOS suspends a backgrounded
  tab's JavaScript outright, and Android freezes it after a while; `RTCPeerConnection`
  is a window-only API, so the hosting cannot be moved to a Worker or Service
  Worker that would survive. A Screen Wake Lock stops the host's phone locking
  itself, and a suspension is absorbed rather than counted as elapsed play time,
  so a brief absence costs a few seconds of reconnecting — but a host who wanders
  off stops the game. Hosting from a laptop avoids this entirely.
- Late players cannot join a game already in progress.
