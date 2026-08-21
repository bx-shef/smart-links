import { createServer, type Server } from 'node:http'
import { createConnection, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { applyEdgeTimeouts } from '~~/server/utils/edgeSecurity'

// The unit fakes prove OUR logic; they cannot prove the Node contract this module leans on —
// that attaching a server-level 'timeout' listener suppresses the default destroy for EVERY
// socket timeout, keep-alive reaping included. The reference port shipped exactly that hole
// (spared marker + suppressed default = sockets pinned forever after one completed request), so
// these three scenarios run against a real http.Server with short timeouts.
const T = { socketIdleMs: 250, headersTimeoutMs: 2_000, requestTimeoutMs: 10_000 }

const servers: Server[] = []
const sockets: Socket[] = []

afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy()
  await Promise.all(servers.splice(0).map(srv => new Promise<void>((resolve) => {
    srv.close(() => resolve())
    srv.closeAllConnections?.()
  })))
})

async function listen(handler: Parameters<typeof createServer>[1]): Promise<{ port: number }> {
  const srv = createServer(handler)
  // Short keep-alive so the post-response reap is observable within the test budget: Node re-arms
  // the socket timer to keepAliveTimeout (+1s buffer) after each response, and it is THAT timer
  // whose expiry our listener must turn back into a destroy.
  srv.keepAliveTimeout = 300
  applyEdgeTimeouts(srv, T)
  servers.push(srv)
  await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve))
  const address = srv.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return { port: address.port }
}

function connect(port: number): Socket {
  const sock = createConnection(port, '127.0.0.1')
  // Keep the socket flowing: a paused net.Socket never processes the peer's FIN, so without a
  // data listener the close this suite asserts on would never be observed (test artifact, not a
  // server behavior — cost us a debugging round).
  sock.on('data', () => {})
  sockets.push(sock)
  return sock
}

/** Resolve when the peer closes the connection; reject on timeout. */
function closedWithin(sock: Socket, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    sock.on('close', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

describe('edge timeouts on a real http.Server', () => {
  it('a completed keep-alive request then silence: the socket is still reaped', async () => {
    const { port } = await listen((_req, res) => {
      res.end('ok')
    })
    const sock = connect(port)
    sock.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n')
    // After the response the marker is back to «no request»; the keep-alive timer's expiry
    // (300ms + Node's 1s buffer) must reach our listener and destroy — the reference port left
    // such sockets pinned forever.
    expect(await closedWithin(sock, 3_000)).toBe(true)
  })

  it('a drip-fed body is idle-cut at the bound', async () => {
    const { port } = await listen((req, res) => {
      // Answer only after the body is fully in — a drip never completes it, so the response
      // never starts and the receiving marker stays set.
      req.on('data', () => {})
      req.on('end', () => res.end('done'))
    })
    const sock = connect(port)
    sock.write('POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\nab')
    // 2 of 1000 bytes sent, then silence: the receiving marker is set → idle timeout destroys.
    expect(await closedWithin(sock, 3_000)).toBe(true)
  })

  it('a slow handler after a fully received body is NOT idle-cut', async () => {
    const { port } = await listen((req, res) => {
      req.on('data', () => {})
      req.on('end', () => {
        // Wait past several idle windows before answering — client silence here is legal.
        setTimeout(() => res.end('done'), T.socketIdleMs * 3)
      })
    })
    const sock = connect(port)
    sock.write('POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\n\r\nhi')
    const answered = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 3_000)
      sock.on('data', (chunk) => {
        if (chunk.toString().includes('done')) {
          clearTimeout(timer)
          resolve(true)
        }
      })
      sock.on('close', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
    expect(answered).toBe(true)
  })
})
