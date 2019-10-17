// Required modules.
const readline = require('readline');
const http = require('http')
const dgram = require('dgram');
const net = require('net');

// IP and Port for NTP server.
const TCP_NTP_IP = '127.0.0.1';
const TCP_NTP_PORT = 8083;

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

  for(let member of activeMembers) {
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
      console.log(`UDP Socket error:\n${err.stack}`);
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

// Initial questions.
const question1 = () => {
  return new Promise((resolve, reject) => {
    rl.question('Enter the host address (empty for localhost): ', (answer) => {
      if (answer == '') {
        answer = 'localhost';
      }

      resolve(answer);
    })
  });
}

const question2 = () => {
  return new Promise((resolve, reject) => {
    rl.question('Enter your username (empty for Unknown): ', (answer) => {
      if (answer == '') {
        answer = 'Unknown';
      }

      resolve(answer);
    })
  });
}

const question3 = () => {
  return new Promise((resolve, reject) => {
    rl.question('Enter your IP (empty for 127.0.0.1): ', (answer) => {
      if (answer == '') {
        answer = '127.0.0.1';
      }

      resolve(answer);
    })
  });
}

const question4 = () => {
  return new Promise((resolve, reject) => {
    rl.question('Enter your port (empty or 0 for auto-detect): ', (answer) => {
      if (answer == '') {
        answer = '0';
      }

      resolve(answer);
    })
  });
}

const nextmessage = () => {
  return new Promise((resolve, reject) => {
    rl.question('', (answer) => {
      resolve(answer);
    })
  });
}

const calculateOffsetNTP = () => {
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

    client.connect(TCP_NTP_PORT, TCP_NTP_IP, function() {
      console.log('Connected to NTP server. Sending current time...');
      var now = new Date();
      client.write(`${now.getTime()}`);
    });
  });
}

// Main function.
const main = async () => {
  console.log("Retrieving reference time...");
  var offset = await calculateOffsetNTP();
  var host = await question1();
  var username = await question2();
  var ip = await question3();
  var port = await question4();
  await register(host, username, ip, port);

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




