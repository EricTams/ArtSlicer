import { useCallback, useState, useSyncExternalStore } from 'react'

import {
  type DiagEvent,
  type PeerRow,
  clearDiagnostics,
  clockOf,
  describeDevice,
  describeFacts,
  describePeer,
  formatReport,
  getDiagnostics,
  refreshDiagnostics,
  subscribeDiagnostics,
} from './diagnostics'

/**
 * The connection, laid open.
 *
 * Behind a button because it is for the one game in ten that goes wrong, and
 * always present because the game that goes wrong is on a guest's phone with
 * no console attached — a build flag would put it exactly where it cannot be
 * reached. Host and client both mount it: a failed join looks different from
 * each end, and the fastest way to place a fault is to read both.
 */
export function DebugPanel() {
  const [open, setOpen] = useState(false)
  const diagnostics = useSyncExternalStore(subscribeDiagnostics, getDiagnostics)
  const { facts, peers, events } = diagnostics

  const show = useCallback(() => {
    // The route is only knowable by asking the live connection, so ask now,
    // while somebody is actually looking.
    refreshDiagnostics()
    setOpen(true)
  }, [])

  const trouble = events.some((event) => event.tone === 'bad')

  if (!open) {
    return (
      <button
        type="button"
        className={`debugbtn${trouble ? ' debugbtn--trouble' : ''}`}
        onClick={show}
        aria-label="Connection details"
      >
        {trouble ? '⚠' : '🐞'}
      </button>
    )
  }

  return (
    <div className="debug" role="dialog" aria-label="Connection details">
      <div className="debug__bar">
        <strong>Connection</strong>
        <div className="debug__actions">
          <CopyButton />
          <button type="button" className="debug__act" onClick={refreshDiagnostics}>
            Refresh
          </button>
          <button type="button" className="debug__act" onClick={clearDiagnostics}>
            Clear
          </button>
          <button type="button" className="debug__act" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>

      <div className="debug__body">
        <Facts rows={describeFacts(facts)} />

        <h4 className="debug__head">
          {facts.role === 'host' ? 'Phones' : 'Host'} ({peers.length})
        </h4>
        {peers.length === 0 ? (
          <p className="debug__empty">Nothing connected yet.</p>
        ) : (
          peers.map((peer) => <Peer key={peer.id} peer={peer} />)
        )}

        <h4 className="debug__head">This device</h4>
        <Facts rows={describeDevice()} />

        <h4 className="debug__head">Log ({events.length})</h4>
        {/* Newest first: a phone that has been retrying for a minute should
            not need scrolling to show what just happened. */}
        <ol className="debug__log">
          {[...events].reverse().map((event, index) => (
            <Line key={`${event.at}-${index}`} event={event} />
          ))}
        </ol>
      </div>
    </div>
  )
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="debug__facts">
      {rows.map(([label, value]) => (
        <div className="debug__fact" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Peer({ peer }: { peer: PeerRow }) {
  return (
    <div className={`debug__peer debug__peer--${peer.channel}`}>
      <div className="debug__peerhead">
        <strong>{describePeer(peer)}</strong>
        <span>{peer.channel}</span>
      </div>
      <div className="debug__peerline">ICE {peer.ice ?? '—'}</div>
      <div className="debug__peerline">{peer.route ?? 'route —'}</div>
      <div className="debug__peerline">since {clockOf(peer.since)}</div>
    </div>
  )
}

function Line({ event }: { event: DiagEvent }) {
  return (
    <li className={`debug__line debug__line--${event.tone}`}>
      <span className="debug__time">{clockOf(event.at)}</span>
      <span>{event.text}</span>
    </li>
  )
}

/**
 * The point of the whole panel on someone else's phone: they press this and
 * send you the text, instead of reading twenty lines down a phone line.
 */
function CopyButton() {
  const [done, setDone] = useState(false)

  return (
    <button
      type="button"
      className="debug__act debug__act--go"
      onClick={async () => {
        const report = formatReport()
        try {
          await navigator.clipboard.writeText(report)
          setDone(true)
        } catch {
          // Clipboard access needs a secure context and a permission a guest's
          // browser may refuse. Falling back to a selectable window beats
          // failing silently with nothing to hand over.
          window.prompt('Copy this report', report)
        }
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}
