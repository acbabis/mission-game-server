'use strict';

const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
const path = require('path');
const argv = require('yargs').argv;

const INDEX = path.join(__dirname, 'index.html');
const PORT = argv.port || 3001;
const { NODE_ENV } = process.env;

const ConnectionController = require('./ConnectionController');

const app = express();
const server = http.createServer(app);

if(NODE_ENV !== 'production') {
    app.get('/', (req, res) => res.sendFile(INDEX));
}

const io = socketIO(server);
ConnectionController.listen(io);

server.listen(PORT, () => console.log(`Listening on ${ PORT }`));