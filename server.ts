/**
 * Express wraps Next so you can add middleware/routes later.
 * In dev, Next handles Fast Refresh + HMR; nodemon only restarts this file when it changes.
 */
import express from "express";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "localhost";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port, turbopack: true });
const handle = app.getRequestHandler();

void app.prepare().then(() => {
  const server = express();
  server.use((req, res) => {
    void handle(req, res);
  });
  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}${dev ? " (dev + Turbopack)" : ""}`);
  });
});
