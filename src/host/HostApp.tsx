/**
 * Host entry point — runs on the laptop and is the authoritative game server.
 * M1 scaffold: proves the bundle deploys and routes. The lobby, room-code
 * claim, and QR arrive in M2.
 */
export function HostApp() {
  return (
    <div className="screen screen--center">
      <div className="stack" style={{ alignItems: 'center', maxWidth: 640 }}>
        <h1 className="brand">
          Art<em>Slicer</em>
        </h1>
        <p className="tagline">
          Grab a pile of junk. Make it look like the prompt. Let everyone judge you.
        </p>
        <p className="muted">Host screen — lobby lands in M2.</p>
      </div>
    </div>
  )
}
