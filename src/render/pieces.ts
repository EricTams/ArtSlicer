import manifest from '../assets/pieces.json'

export interface PieceDef {
  id: string
  category: string
  /** Path relative to the app's base URL. */
  src: string
  width: number
  height: number
  /**
   * Where the art's weight sits, in sprite-local coordinates. Not the middle
   * of the box: a windsock is a cone and a lot of streamers, and the two are
   * most of its height apart.
   */
  centroid: { x: number; y: number }
  /**
   * A 16x16 grid of where there is any art at all, one bit per cell, packed
   * and base64'd. Coarse on purpose — it exists to answer whether a slice has
   * divided the art or merely passed through the gaps in it, and the pieces
   * that question matters for are the ones made mostly of gaps.
   */
  mask: string
}

export const PIECES: PieceDef[] = manifest

const byId = new Map(PIECES.map((piece) => [piece.id, piece]))

export function getPiece(id: string): PieceDef | undefined {
  return byId.get(id)
}

export function isKnownPiece(id: string): boolean {
  return byId.has(id)
}

export const CATEGORIES: string[] = [...new Set(PIECES.map((piece) => piece.category))]

/** Resolves against BASE_URL so paths work on Pages, localhost, and a LAN IP. */
export function pieceUrl(piece: PieceDef): string {
  return `${import.meta.env.BASE_URL}${piece.src}`
}

const images = new Map<string, HTMLImageElement>()

/**
 * Every sprite is preloaded before the build phase starts. Decoding an image
 * mid-round would stall the canvas at exactly the wrong moment, and the host
 * needs the same sprites to re-render what phones submit.
 */
export function loadAllPieces(): Promise<Map<string, HTMLImageElement>> {
  return Promise.all(
    PIECES.map(
      (piece) =>
        new Promise<void>((resolve) => {
          if (images.has(piece.id)) {
            resolve()
            return
          }
          const image = new Image()
          image.onload = () => {
            images.set(piece.id, image)
            resolve()
          }
          // A missing sprite must not hang the loading screen forever; the
          // renderer simply skips pieces it has no image for.
          image.onerror = () => resolve()
          image.src = pieceUrl(piece)
        }),
    ),
  ).then(() => images)
}

export function getImage(pieceId: string): HTMLImageElement | undefined {
  return images.get(pieceId)
}
