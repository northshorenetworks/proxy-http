'use strict';

var statuses = require('statuses');
var url = require('url');

var context = module.exports = {
  onerror: function (err) {
    console.error(err.stack);
    this.res.statusCode = 500;
    this.res.end(statuses[500]);
  },
  type: 'http',
  get path() {
    if (this.req.url[0] === '/') {
      return this.req.url;
    } else {
      return url.parse(this.req.url).pathname;
    }
  }
};