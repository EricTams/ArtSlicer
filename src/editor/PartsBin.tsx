import { useState } from 'react'

import { CATEGORIES, PIECES, pieceUrl } from '../render/pieces'

/**
 * The pile of junk, full screen. Categories are tabs rather than one long
 * list so any piece is two taps away, and the tiles are large enough to
 * actually see what you're picking.
 */
export function PartsBin({
  onPick,
  onClose,
  full,
}: {
  onPick(pieceId: string): void
  onClose(): void
  full: boolean
}) {
  const [category, setCategory] = useState<string>(CATEGORIES[0] ?? '')
  const visible = PIECES.filter((piece) => piece.category === category)

  return (
    <div className="tool2">
      <header className="tool2__head">
        <button type="button" className="tool2__back" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2 className="tool2__title">Parts bin</h2>
        <span className="tool2__done tool2__done--ghost" aria-hidden="true" />
      </header>

      {full && (
        <p className="tool2__hint tool2__hint--warn">Your picture is full. Delete a piece first.</p>
      )}

      <div className="bin__tabs">
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

      <div className="bin__grid">
        {visible.map((piece) => (
          <button
            key={piece.id}
            type="button"
            className="bin__item"
            disabled={full}
            onClick={() => onPick(piece.id)}
            aria-label={`Add ${piece.id}`}
          >
            {/* Sprites are near-white by design, so the tile is dark for contrast. */}
            <img src={pieceUrl(piece)} alt="" draggable={false} />
            <span>{piece.id}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
