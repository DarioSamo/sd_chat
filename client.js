// Required modules.
const readline = require('readline');
const http = require('http')
const dgram = require('dgram');
const net = require('net');

// Default port for NTP over TCP.
const TCP_NTP_DEFAULT_PORT = 8083;

// Global variables.
var activeMembers = []
var listenSocket = dgram.createSocket('udp4');
var sendSocket = dgram.createSocket('udp4');

const HEARTBEAT_INTERVAL_MSECS = 60000;

// Readline interface.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Send a message through UDP to all known members.
function sendMessage(from, to, message, timestamp, offset) {
  var serialized = JSON.stringify({
    from:from,
    to:to,
    message:message,
    timestamp:timestamp,
    offset:offset
  });

  for (let member of activeMembers) {
    sendSocket.send(serialized, member.port, member.ip);
  }
}

// Send a new member message through UDP to all new members to let
// everyone know there's a new chat room member. We don't have to wait
// for the next heartbeat this way.
function sendNewMemberMessage(username, ip, port) {
  var now = new Date();
  var serialized = JSON.stringify({
    username: username,
    ip: ip,
    port: port,
    timestamp: now.getTime()
  });

  for(let member of activeMembers) {
    sendSocket.send(serialized, member.port, member.ip);
  }
}

function requestRegister(host, username, ip, port) {
  console.log('Registering with HTTP server...');

  // Register on the HTTP server with the correct username, IP and port.
  const options = {
    hostname: host,
    port: 8080,
    path: `/register?username=${username}&ip=${ip}&port=${port}`,
    method: 'GET'
  };

  var req = http.request(options, res => {
    if (res.statusCode == 200) {
      var data = '';
      res.on('data', d => {
        data += d;
      });

      res.on('end', () => {
        activeMembers = JSON.parse(data);
        sendNewMemberMessage(username, ip, port);
      });
     }
     else {
       console.log(`Bad status code: ${res.statusCode}`);
     }
   });

   req.on('error', error => {
     console.error(error);
   });

   req.end();
}

// Register this client on the HTTP server.
const register = (host, username, ip, port) => {
  return new Promise((resolve, reject) => {
    listenSocket.on('error', (err) => {
      console.error(`UDP Socket error:\n${err.stack}`);
    });

    listenSocket.on('message', (msg, rinfo) => {
      parsed = JSON.parse(msg);

      // New member message.
      if ('username' in parsed) {
        // Make sure the member isn't already on the list with the same IP/Port pair.
        var notFound = true;
        for(let member of activeMembers) {
          if ((member.ip == parsed.ip) && (member.port == parsed.port)) {
            notFound = false;
            break;
          }
        }
        
        // Add the new member to the array. This array will get overwritten in the next heartbeat.
        if (notFound) {
          activeMembers.push(parsed);
        }
      }
      // Chat message.
      else if ('message' in parsed) {
        var from = parsed.from;
        var message = parsed.message;
        var timestamp = new Date(parsed.timestamp + parsed.offset);
        var datestring = timestamp.toLocaleDateString();
        var timestring = timestamp.toLocaleTimeString();
        console.log(`[${datestring} ${timestring}] ${from}: ${message}`);
      }
    });

    listenSocket.on('listening', () => {
      var chosenip = listenSocket.address().address;
      var chosenport = listenSocket.address().port;
      console.log(`Listening with UDP on port ${chosenport} at IP ${chosenip}`);
      setImmediate(requestRegister, host, username, chosenip, chosenport);
      setInterval(requestRegister, HEARTBEAT_INTERVAL_MSECS, host, username, chosenip, chosenport);
    });

    listenSocket.bind(port, ip);
    resolve();
  });
}

// Calculates the offset between this system and the NTP system. Allows for 
// synchronization across all clients.
const calculateOffsetNTP = (ip, port) => {
  return new Promise((resolve, reject) => {
    var client = new net.Socket();
    client.on('data', function(data) {
      var T4 = (new Date()).getTime();
      var times = data.toString().split(",");
      var T1 = parseInt(times[0]);
      var T2 = parseInt(times[1]);
      var T3 = parseInt(times[2]);
      var delay =  ((T2 - T1) + (T4 - T3)) / 2;
      var offset = ((T2 - T1) + (T3 - T4)) / 2;
      console.log('Delay: ' + delay + ' ms');
      console.log('Offset: ' + offset + ' ms');
      resolve(offset);
    });

    client.on('error', function(err) {
      console.log('Error when connecting to NTP server.');
      throw err;
    });

    console.log("Connecting to NTP server...");
    client.connect(port, ip, function() {
      console.log('Connected to NTP server. Sending current time...');
      var now = new Date();
      client.write(`${now.getTime()}`);
    });
  });
}

// Ask a question to the user and use a default answer if they don't type in anything.
const question = (questionText, defaultAnswerText) => {
  return new Promise((resolve, reject) => {
    rl.question(questionText, (answer) => {
      if (answer == '') {
        answer = defaultAnswerText;
      }

      resolve(answer);
    })
  });
}

// Read the next line typed in by the user.
const nextmessage = () => {
  return new Promise((resolve, reject) => {
    rl.question('', (answer) => {
      resolve(answer);
    })
  });
}

// Main function.
const main = async () => {
  var ntpHostIp = await question('Enter the NTP host address (empty for 127.0.0.1): ', 'localhost');
  var ntpHostPort = await question(`Enter the NTP host port (empty for ${TCP_NTP_DEFAULT_PORT}): `, `${TCP_NTP_DEFAULT_PORT}`);
  var offset = await calculateOffsetNTP(ntpHostIp, ntpHostPort);
  var host = await question('Enter the HTTP host address (empty for localhost): ', 'localhost');
  var username = await question('Enter your username (empty for Unknown): ', 'Unknown');
  var ip = await question('Enter your address (empty for 127.0.0.1): ', '127.0.0.1');
  var port = await question('Enter your port (empty or 0 for auto-detect): ', '0');
  await register(host, username, ip, port);

  // Chatting message loop.
  var chatting = true;
  while (chatting) {
    var message = await nextmessage();
    if (message == 'exit') {
      chatting = false;
    }
    else if (message != '') {
      var now = new Date();
      sendMessage(username, 'all', message, now.getTime(), offset);
    }
  }

  rl.close();
}

main()




