import { useState } from 'react'

import { CATEGORIES, PIECES, pieceUrl } from '../render/pieces'

interface Props {
  onAdd(pieceId: string): void
  disabled: boolean
}

/**
 * The pile of junk. Categories are tabs rather than one long list so a piece
 * is two taps away at most on a small screen.
 */
export function PieceTray({ onAdd, disabled }: Props) {
  const [category, setCategory] = useState<string>(CATEGORIES[0] ?? '')
  const visible = PIECES.filter((piece) => piece.category === category)

  return (
    <div className="tray">
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

      <div className="tray__items">
        {visible.map((piece) => (
          <button
            key={piece.id}
            type="button"
            className="tray__item"
            onClick={() => onAdd(piece.id)}
            disabled={disabled}
            aria-label={`Add ${piece.id}`}
            title={disabled ? 'That is all the junk you get' : `Add ${piece.id}`}
          >
            {/* Sprites are light on a light chip, so the chip is dark to
                give them contrast in the tray. */}
            <img src={pieceUrl(piece)} alt="" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  )
}
