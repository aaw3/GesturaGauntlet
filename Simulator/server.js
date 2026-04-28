const http = require("http")
const next = require("next")

const dev = process.env.NODE_ENV !== "production"
const hostname = process.env.HOST || "0.0.0.0"
const port = Number(process.env.PORT || 3101)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    void handle(req, res)
  })

  server.listen(port, hostname, () => {
    console.log(`[Simulator] ready on http://localhost:${port}`)
  })
})