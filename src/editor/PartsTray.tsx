import { useEffect, useRef, useState } from 'react'

import { CATEGORIES, PIECES, pieceUrl } from '../render/pieces'

/**
 * The pile of junk as a drawer over the bottom buttons, rather than a screen of
 * its own. Pulling a piece out is a drag straight onto the picture, and the
 * drawer stays open afterwards, so filling a canvas is one continuous motion
 * instead of a round trip per piece.
 *
 * It is positioned over the layout rather than inside it: taking space would
 * shrink the canvas underneath, which is the one thing the build screen must
 * never do while you are working on it.
 */

interface Carry {
  pieceId: string
  pointerId: number
  clientX: number
  clientY: number
  /** A press only becomes a drag once it has travelled; below that it's a tap. */
  dragging: boolean
}

const DRAG_THRESHOLD = 4

export function PartsTray({
  full,
  onClose,
  onAdd,
  onDrop,
  canDropAt,
}: {
  full: boolean
  onClose(): void
  /** Tapped rather than dragged: the piece lands wherever the scene defaults to. */
  onAdd(pieceId: string): void
  /** Dropped over the picture, in client pixels. */
  onDrop(pieceId: string, clientX: number, clientY: number): void
  canDropAt(clientX: number, clientY: number): boolean
}) {
  const [category, setCategory] = useState<string>(CATEGORIES[0] ?? '')
  const [carry, setCarry] = useState<Carry | null>(null)
  const visible = PIECES.filter((piece) => piece.category === category)

  // Held in a ref so the window listeners, bound once per drag, always read the
  // current carry without rebinding on every pointer move.
  const carryRef = useRef(carry)
  carryRef.current = carry

  useEffect(() => {
    if (!carry) return

    const move = (event: PointerEvent): void => {
      const held = carryRef.current
      if (!held || event.pointerId !== held.pointerId) return
      const travel = Math.hypot(event.clientX - held.clientX, event.clientY - held.clientY)
      setCarry({
        ...held,
        clientX: event.clientX,
        clientY: event.clientY,
        dragging: held.dragging || travel > DRAG_THRESHOLD,
      })
    }

    const up = (event: PointerEvent): void => {
      const held = carryRef.current
      if (!held || event.pointerId !== held.pointerId) return
      setCarry(null)

      if (!held.dragging) {
        onAdd(held.pieceId)
        return
      }
      if (canDropAt(event.clientX, event.clientY)) {
        onDrop(held.pieceId, event.clientX, event.clientY)
      }
    }

    const cancel = (): void => setCarry(null)

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
    // Only the presence of a drag matters here; the position lives in the ref.
  }, [carry !== null, onAdd, onDrop, canDropAt])

  const carried = carry && PIECES.find((piece) => piece.id === carry.pieceId)

  return (
    <>
      <div className="tray" role="group" aria-label="Parts bin">
        <div className="tray__head">
          <span className="tray__title">{full ? 'Picture full — bin something' : 'Parts bin'}</span>
          <button type="button" className="tray__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Only worth showing when there is more than one pile to choose from. */}
        {CATEGORIES.length > 1 && (
          <div className="tray__tabs">
            {CATEGORIES.map((name) => (
              <button
                key={name}
                type="button"
                className={`tray__tab${name === category ? ' tray__tab--on' : ''}`}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <div className="tray__strip">
          {visible.map((piece) => (
            <button
              key={piece.id}
              type="button"
              className="tray__item"
              disabled={full}
              aria-label={`Add ${piece.id}`}
              onPointerDown={(event) => {
                if (full) return
                setCarry({
                  pieceId: piece.id,
                  pointerId: event.pointerId,
                  clientX: event.clientX,
                  clientY: event.clientY,
                  dragging: false,
                })
              }}
            >
              <img src={pieceUrl(piece)} alt="" draggable={false} />
            </button>
          ))}
        </div>
      </div>

      {/* Follows the finger so it is obvious something is being carried, and
          sits outside the drawer so it can be seen over the picture. */}
      {carried && carry?.dragging && (
        <img
          className="tray__ghost"
          src={pieceUrl(carried)}
          alt=""
          draggable={false}
          style={{ left: `${carry.clientX}px`, top: `${carry.clientY}px` }}
        />
      )}
    </>
  )
}
