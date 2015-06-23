/*
'use strict';

let fs = require('fs');
let ProxyHTTP = require('../');

var Store = function MemoryStore() {
  var cache  = {};
  this.get = function (domain, fn) {
    fn(null, cache[domain] || null);
  };

  this.set = function (certKeyData, fn) {
    cache[certKeyData.domain] = {
      cert: certKeyData.cert,
      key: certKeyData.key
    };
    fn();
  };
};

let sslConfig = {
  ca: {
    cert: fs.readFileSync('./test/ca.crt.pem'),
    key: fs.readFileSync('./test/ca.key.pem')
  },
  csr: {
    country: 'US',
    state: 'Texas',
    locality: 'Longview',
    organization: 'Northshore Network Solutions',
    organizationUnit: '',
    emailAddress: 'support@northshore.io'
  },
  ttl: 10000,
  store: new Store(),
};

let server = ProxyHTTP({
  ssl: sslConfig
});

server.use(function *(next) {
  console.log(this.req.url);
  yield *next;
  console.log('done')
});

// server.sslGenerator.selfSigned('google.com', function (err, certKey) {
//   console.log(err, certKey);
// });

server.listen(3128, 3129);
*/