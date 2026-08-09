# ArtSlicer

A Jackbox-style party game. The host screen shows a QR code, everyone joins from
their phone, and each round you get a prompt and a pile of junk to arrange into
something that vaguely resembles it. Then everyone votes on whose attempt was
best.

The tools are physical rather than abstract: you **mix paint** by squeezing
tubes into a jar and holding a spray button, **squish** a part by swiping
through it so crusher jaws close along your swing, and **slice** it by tossing
it in the air and flicking your finger through it.

**Play:** https://erictams.github.io/ArtSlicer/

One person taps **Start a game** on whatever screen the room can see — a laptop
or TV if there is one, otherwise just their phone. Everyone else scans the QR
code. The first player to join starts the game.

There's also **Play on your own**, which drops you straight into the draw screen
with a prompt and no clock. Instead of submitting, you take a new prompt and
start again — handy for learning the tools before playing with other people.

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

### The build screen is a stack of single-purpose tools

The canvas handles only arranging — drag to move, pinch to size and turn. Tap a
piece and each transformation gets the whole screen to itself, which is what lets
each one be a physical action instead of a row of sliders. Tools render as
overlays rather than replacing the canvas, so the Konva stage and its gesture
listeners survive a trip into a tool and back.

### Slicing splits a piece in two

A flick is mapped back through the piece's full transform into its own
coordinates, then stored as a half-plane; the visible shape is the piece's
rectangle trimmed against every cut it carries. Half-plane intersections are
always convex, so a small Sutherland–Hodgman pass is exact. One piece becomes
two, taking opposite sides of the cut, which makes slicing a way to *create*
parts rather than only trim them.

### Squashing is stored as an axis, not a scale

A piece springs back upright after being crushed, so a diagonal squash cannot be
expressed as `scaleX`/`scaleY`. Each squash is `{angle, factor}` in the piece's
own frame, rendered by conjugating a scale by that angle, and successive squashes
compose by nesting. Angle 0 crushes vertically — a convention pinned down by
tests, because getting it backwards silently mirrors the deformation.

The jaws follow your finger: they appear wherever you press, turn to face the
centre, and close along the path you swipe — so aiming and squeezing are one
motion. Converting that swing into a stored angle has to account for both the
quarter-turn convention and the piece's own rotation, and a sign error there is
invisible on a symmetric piece, so `crushAngle` is isolated and tested against
the rendered deformation.

One squeeze does little on purpose — a hard swing is about 1.7× — so extreme
shapes come from hitting it repeatedly. Squeezes aimed the same way merge into a
single crush by multiplying their factors, so hammering the jaws costs no extra
nesting and only distinct axes count against the per-piece limit.

### Tinting

Colours are mixed by hand, so any spray can produce a new one. Each (sprite,
colour, strength) combination is composited once into a cached canvas — quantised
so near-identical shades share an entry, and bounded by an LRU so a long game
cannot accumulate hundreds of them. Konva's per-node filters were far too slow on
a phone. The blend is `multiply` at the sprayed strength, which preserves the
sprite's shading instead of flattening it to a silhouette.

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
  editor/   canvas gestures, parts bin, and the colour/squish/slice tools
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
