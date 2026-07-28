/**
 * Raised when a page needs the Bitrix24 frame but there is none — the app was opened outside a
 * portal, or the handshake failed.
 *
 * It has its own type because it is not a fault to report like the others: the user is not looking
 * at a broken app, they are looking at the app in the wrong place. The error screen therefore shows
 * a plain instruction and a way OUT (the landing) rather than a status code and a retry that would
 * just land on the same frameless page again.
 */
export class FrameUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrameUnavailableError'
  }
}
