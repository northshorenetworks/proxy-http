'use strict';

var statuses = require('statuses');

var context = module.exports = {
  onerror: function (err) {
    console.error(err.stack);
    this.res.statusCode = 500;
    this.res.end(statuses[500]);
  },
  type: 'http'
};