// Required modules.
const dgram = require('dgram');
const fs = require('fs');
const net = require('net');
const url = require('url');
const http = require('http');

// Port for HTTP server.
const HTTP_PORT = 8080;

// IP and Port for bridge between WebSocket and UDP connections.
const UDP_BRIDGE_IP = '0.0.0.0';
const UDP_BRIDGE_PORT = 8082;

// IP and Port for NTP server.
const TCP_NTP_IP = '0.0.0.0';
const TCP_NTP_PORT = 8083;

// Maximum time allowed after a client has registered before 
// being removed from the active list.
const CLIENT_TIMEOUT_MSECS = 90000;

// Interval for checking if any clients have timed out.
const CLIENT_CHECK_INTERVAL_MSECS = 5000;

// Global variables.
var chatHtml = String(fs.readFileSync('index.html'));
var listenSocket = dgram.createSocket('udp4');
var sendSocket = dgram.createSocket('udp4');
var clients = [];
var sockets = [];

// Functions.
function startNTPServer() {
  net.createServer(function(sock) {
    sock.on('data', function(data) {
      var T2 = (new Date()).getTime();
      var T1 = parseInt(String(data));
      var T3 = (new Date()).getTime();
      sock.write(`${T1},${T2},${T3}`);
    });
  }).listen(TCP_NTP_PORT, TCP_NTP_IP);
}

function startUDPBridge() {
  listenSocket.on('error', (err) => {
    console.log(`UDP Socket error:\n${err.stack}`);
  });

  listenSocket.on('message', (msg, rinfo) => {
    parsed = JSON.parse(String(msg));

    // Only redirect chat messages to WebSockets.
    if ('message' in parsed) {
      for (let socket of sockets) {
        socket.emit('message', String(msg));
      }
    }
  });

  listenSocket.on('listening', () => {
    console.log(`Listening with UDP on port ${UDP_BRIDGE_PORT} at IP ${UDP_BRIDGE_IP}`);

    // Add a fake client to the server for listening to the messages
    // for the WebSockets/UDP bridge. Since it has a null timestamp, 
    // it will never be deleted.
    clients.push({
      username: 'server',
      ip: UDP_BRIDGE_IP,
      port: UDP_BRIDGE_PORT,
      timestamp: null
    });
  });

  listenSocket.bind(UDP_BRIDGE_PORT, UDP_BRIDGE_IP);
}

const startHTTPServer = async () => {
  var server = http.createServer(async function (req, res) {
    var T2 = (new Date()).getTime();
    var urlres = url.parse(req.url, true);
    var path = urlres.pathname;
    var query = urlres.query;

    // Register method.
    if (path == '/register') {
      // Client structure with the current timestamp.
      var now = new Date();
      var client = {
        username: query.username,
        ip: query.ip,
        port: query.port,
        timestamp: now.getTime()
      }
          
      // Check if the client already exists.
      var clientIndex = -1;
      for (var i = 0; (i < clients.length) && (clientIndex < 0); i++) {
        if ((clients[i].ip == client.ip) && (clients[i].port == client.port)) {
          clientIndex = i;
        }
      }
          
      // If client already exists, remove it from the array.
      if (clientIndex >= 0) {
        clients.splice(clientIndex, 1);
      }

      // Return a version of the array without the client and push
      // it into the array again.
      var currentClients = JSON.stringify(clients);
      console.log('Registering client: ' + JSON.stringify(client));
      clients.push(client);

      res.write(currentClients);
    }
    // List members webpage.
    else if (path == '/list') {
      res.writeHead(200, {'Content-Type': 'text/html'});
      var html = '<html><body><h1>Active chat members</h1>';
      for (let client of clients) {
        var date = new Date(client.timestamp);
        var datestring = date.toLocaleDateString();
        var timestring = date.toLocaleTimeString();
        html += `<p>
                <strong>User:</strong> ${client.username} 
                <strong>IP:</strong> ${client.ip} 
                <strong>Port:</strong> ${client.port} 
                <strong>Registered:</strong> ${datestring} ${timestring} 
                </p>`;
      }

      html += '</body></html>';

      res.write(html);
    }
    else if (path == '/chat') {
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.write(chatHtml);
    }
    // Unknown path.
    else {
      res.statusCode = 404;
      res.write('404 Not found');
    }

    res.end();
  }).listen(HTTP_PORT);

  // Interval for checking if any clients have timed out.
  setInterval(function () {
    var now = new Date();
    for (var i = 0; i < clients.length; i++) {
      if (clients[i].timestamp != null) {
        if ((now.getTime() - clients[i].timestamp) > CLIENT_TIMEOUT_MSECS) {
          console.log('Removing client: ' + JSON.stringify(clients[i]));
          clients.splice(i, 1);
          i--;
        }
      }
    }
  }, CLIENT_CHECK_INTERVAL_MSECS);

  var io = require('socket.io')(server);
  io.on('connection', function(socket) {
    socket.on('message', (message) => {
      // Redirect message to UDP clients.
      for (let client of clients) {
        sendSocket.send(message, client.port, client.ip);
      }
    });

    socket.on('ntp', (message) => {
      // NTP functionality for HTML clients.
      var T2 = (new Date()).getTime();
      var T1 = parseInt(String(message));
      var T3 = (new Date()).getTime();
      socket.emit('ntp', `${T1},${T2},${T3}`);
    });

    socket.on('disconnect', (reason) => {
      // Remove socket from list.
      var index = sockets.indexOf(socket);
      if (index >= 0) {
        sockets.splice(index, 1);
      }
    });

    sockets.push(socket);
    socket.emit('welcome');
  });
}

const init = async () => {
  startNTPServer();
  startUDPBridge();
  startHTTPServer();
};

process.on('unhandledRejection', (err) => {
    console.log(err);
    process.exit(1);
});

init();