'use strict';
const http = require('http');
const { loadConfig } = require('./config');
const { createApp } = require('./app');

const config = loadConfig();
const server = http.createServer(createApp(config));
server.requestTimeout = 120000;

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({
    msg: 'listening', url: `http://${config.host}:${config.port}`,
    openai: config.openai.apiKey ? 'configured' : 'missing OPENAI_API_KEY (voice falls back to the browser)',
    accessCode: config.accessCode ? 'required' : 'off',
  }));
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
