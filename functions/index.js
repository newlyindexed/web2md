const { onRequest } = require('firebase-functions/v2/https');
const app = require('./server');

exports.api = onRequest(
  {
    timeoutSeconds: 60,
    memory: '512MiB',
    invoker: 'public'
  },
  app
);
