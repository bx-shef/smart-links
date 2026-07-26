// Pure builder for the frame-auth headers sent to our own /api routes (unit-tested).
// The server verifies these (see server/utils/frameVerify), so the client just forwards the
// frame's access token + portal domain.

export interface FrameHeaderAuth {
  accessToken: string
  domain: string
}

/** Build the Authorization + X-B24-Domain headers, or null when there is no frame auth. */
export function buildFrameHeaders(auth: FrameHeaderAuth | null | undefined): Record<string, string> | null {
  if (!auth || !auth.accessToken || !auth.domain) {
    return null
  }
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    'X-B24-Domain': auth.domain
  }
}
