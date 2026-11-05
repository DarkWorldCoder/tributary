'use strict';
// User regular expressions run outside the UI/host event loop. The parent owns
// the deadline and terminates this worker on timeout, success or failure.
const { parentPort, workerData } = require('node:worker_threads');
require('./files').searchProject(workerData.root, workerData.query, workerData.options)
  .then((result) => parentPort.postMessage({ result }))
  .catch((error) => parentPort.postMessage({ error: error.message }));
