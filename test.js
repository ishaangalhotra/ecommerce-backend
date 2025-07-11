const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Server is working!\n');
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Test server running on http://localhost:${PORT}`);
  console.log(`Also accessible via your local network IP on port ${PORT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});