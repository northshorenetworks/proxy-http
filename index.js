'use strict';

let http = require('http');
let https = require('https');
let tls = require('tls');
let net = require('net');
let url = require('url');
let path = require('path');
let os = require('os');
let randomBytes = require('crypto').randomBytes;
let co = require('co');
let compose = require('koa-compose');
let SSLGenerator = require('ssl-generator');
let debug = require('debug')('proxy:http');
let context = require('./lib/context');

let app = ProxyHTTP.prototype;

exports = module.exports = ProxyHTTP;

function ProxyHTTP(config) {
  if (!(this instanceof ProxyHTTP)) return new ProxyHTTP(config);

  this.config = config || {};
  this.middleware = [];
  this.context = Object.create(context);
  this.sslGenerator = new SSLGenerator(config.ssl);
}

app.use = function (fn) {
  this.middleware.push(fn);
  return this;
};

app.listen = function(port, transparentPort) {
  let self = this;
  let server = http.createServer(this.callback());
  server.on('connect', this.onConnect());
  server.on('upgrade', this.onUpgrade());

  if (transparentPort) {
    self.transparentServer = net.createServer(function (socket) {
      socket.on('data', function (data) {
        socket.removeAllListeners('data');
        let hostname = getSNI(data);
        let callback =  self.proxyToHttps({
          httpVersion: '1.0',
          connection: {
            remoteAddress: socket.remoteAddress
          }
        }, socket, '', data);
        self.sslGenerator.selfSigned(hostname, callback);
      });
    });
    self.transparentServer.listen(transparentPort);
  }
  return server.listen(port);
};

app.callback = function (ip) {
  let self = this;
  let middleware = [respond].concat(this.middleware);
  let fn = co.wrap(compose(middleware));

  return function(req, res) {
    debug('Received request');
    req.type = (ip) ? 'https' : 'http';
    req.ip = ip || req.connection.remoteAddress;
    let ctx = self.createContext(req, res);
    fn.call(ctx).catch(ctx.onerror);
  };
};

app.onConnect = function () {
  let self = this;
  return function (req, socket, head) {
    debug('Connect event');
    let domain = req.url.split(':')[0];
    debug("Retrieving SSL cert & key for ${domain}")
    self.sslGenerator.selfSigned(domain, self.proxyToHttps(req, socket, head));
  };
};

app.onUpgrade = function () {
  return function (req, socket, head) {
    let port = (req.connection.servername) ? 443 : 80;
    let proto = (port == 80) ? net : tls;
    let path = (req.url[0] == '/') ? req.url : url.parse(req.url).pathname;
    let hostname = (req.url[0] == '/') ? req.headers.host : url.parse(req.url).hostname;

    if (req.headers.upgrade === 'websocket') {
      let client = proto.connect({
        port: port,
        hostname: hostname
      }, function () {
        client.write("GET ${path} HTTP/1.1\r\n");
        Object.keys(req.headers).map(function (key) {
          client.write("${key}: ${req.headers[key]}\r\n");
        });
        client.write('\r\n');
        socket.on('data', function (chunk) { client.write(chunk); });
      });
      client.on('data', function (chunk) {
        socket.write(chunk);
      });
      client.on('error', function (err) {
        // TODO: handle error 
        throw err;
      });
    }
  };
};

app.proxyToHttps = function (req, socket, head, initialData) {
  let self = this;
  return function createHttpsServer(err, certKey) {
    debug('Create temporary HTTPS server');
    if (err) {
      // TODO: handle error
      throw err;
    }

    let proxy = new net.Socket();
    let version = req.httpVersion;
    let server = https.createServer({
      cert: certKey.cert,
      key: certKey.key
    });
    let socketPath = path.resolve(os.tmpDir(), randomBytes(15).toString('hex'));
    server.closed = false;
    server.on('close', function() { server.closed = true; });
    server.on('request', self.callback(req.connection.remoteAddress));
    server.on('upgrade', self.onUpgrade());
    server.once('request', function (req, res) {
      debug('Proxy to HTTPS `request` event')
      res.on('finish', function () {
        if (!server.closed) {
          server.close();
        }
      });
    });
    server.listen(socketPath, function () {
      debug("temporary https server listening at ${socketPath}")
    });

    proxy.connect(server._pipeName, function () {
      if (initialData !== undefined) {
        proxy.write(initialData);
      } else {
        proxy.write(head);
        socket.write("HTTP/${version} 200 Connection established\r\n\r\n");
      }
    });
    // TODO: check if pipe works instead
    // proxy.pipe(socket);
    proxy.on('data', socket.write.bind(socket));
    proxy.on('end', function () {
      if (!server.closed) {
        server.close();
      }
      socket.end();
    });
    proxy.on('error', function () {
      // TODO: properly handle error
      if (!server.closed) {
        server.close();
      }
      socket.end();
    });

    socket.on('data', function (chunk) {
      if (!proxy.destroyed) {
        proxy.write(chunk);
      }
    });
    socket.on('end', function () {
      proxy.end();
    });
    socket.on('error', function () {
      proxy.end();
    });
  };
};

app.createContext = function(req, res) {
  let ctx = Object.create(this.context);
  ctx.app = this;
  ctx.req = req;
  ctx.res = res;
  ctx.onerror = ctx.onerror.bind(ctx);
  return ctx;
};

function *respond(next) {
  yield *next;
  let self = this;
  let req = this.req;
  let res = this.res;
  let type = this.req.type;
  let protocol = (type === 'http') ? http : https;
  let request = protocol.request({
    host: req.headers.host,
    port: (type === 'http') ? 80 : 443,
    path: self.path,
    headers: req.headers 
  }, function (response) {
    response.pipe(res);
  });

  req.pipe(request);
  request.end();
}

function getSNI (buffer) {
  if (buffer.readInt8(0) !== 22) {
    // not a TLS Handshake packet
    return null;
  }
  // Session ID Length (static position)
  var currentPos = 43;
  // Skip session IDs
  currentPos += 1 + buffer[currentPos];

  // skip Cipher Suites
  currentPos += 2 + buffer.readInt16BE(currentPos);

  // skip compression methods
  currentPos += 1 + buffer[currentPos];

  // We are now at extensions!
  currentPos += 2; // ignore extensions length
  while (currentPos < buffer.length) {
    if (buffer.readInt16BE(currentPos) === 0) {
      // we have found an SNI
      var sniLength = buffer.readInt16BE(currentPos + 2);
      currentPos += 4;
      if (buffer[currentPos] != 0) {
        // the RFC says this is a reserved host type, not DNS
        return null;
      }
      currentPos += 5;
      return buffer.toString('utf8', currentPos, currentPos + sniLength - 5);
    } else {
      currentPos += 4 + buffer.readInt16BE(currentPos + 2);
    }
  }
  return null;
};