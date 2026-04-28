import { onDeviceStateChange } from "@/lib/simulator-events"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(
            `event: ${event}\n` +
              `data: ${JSON.stringify(data)}\n\n`,
          ),
        )
      }

      // Initial handshake event so the client knows the stream is alive
      send("connected", { ok: true, ts: Date.now() })

      // Keep-alive to prevent some proxies / browsers from closing idle streams
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`))
      }, 25_000)

      const unsubscribe = onDeviceStateChange((payload) => {
        send("device-state-change", payload)
      })

      // @ts-expect-error cancel is wired below
      this._cleanup = () => {
        clearInterval(heartbeat)
        unsubscribe()
      }
    },

    cancel() {
      // @ts-expect-error cleanup attached in start
      this._cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}