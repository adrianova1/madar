// Production Node.js entry point for cPanel "Setup Node.js App" (Phusion Passenger) & VPS
// Usage: NODE_ENV=production node cpanel-deploy/server.js
const http = require('http');
const path = require('path');
const next = require('next');

const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOSTNAME || '0.0.0.0';
const dir = path.resolve(__dirname, '..');

const app = next({ dev: false, dir, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
      handle(req, res);
    });

    server.listen(port, hostname, () => {
      console.log(`[MADAR] Production server listening on http://${hostname}:${port}`);
    });
  })
  .catch((err) => {
    console.error('[MADAR] Failed to start Next.js server:', err);
    process.exit(1);
  });
