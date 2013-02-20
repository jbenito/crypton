'use strict';
/*jslint expr: true*/

var should = require('should');
var Q = require('q');

var phantom = require('node-phantom');
var phantomOptions = { phantomPath: require('phantomjs').path };
var http = require('http');
var path = require('path');
var express = require('express');

var config = {
  baseUrl: 'http://localhost:2013'
};
config.port = parseInt(config.baseUrl.split(':', 3).pop(), 10);

var app = require('../../server/app');

app.get('/test/config.js', function (req, res) {
  res.setHeader('Content-type', 'application/javascript');
  res.end('var config = (' + JSON.stringify(config) + ');');
});

app.use('/test', express.static(
  path.resolve(__dirname, '..', 'static')));


function qTest(func) {
  return function (done) {
    func.call(this).done(done);
  };
}

function openPage(ph, url) {
  return Q.nfcall(ph.createPage)
  .then(function (page) {
    page.onConsoleMessage = function (msg) {
      console.log('page console:');
      console.log(msg);
    };
    page.onError = function (err) {
      console.log('page error:');
      console.log(err);
    };
    page.callbackPromise = function () {
      if (page.onCallback) { throw new Error('already has a callback'); }
      var d = Q.defer();
      page.onCallback = function () {
        delete page.onCallback;
        return d.resolve.apply(this, arguments);
      };
      return d.promise;
    };
    return Q.nfcall(page.open, config.baseUrl + url)
    .then(function (status) {
      return { page: page, status: status };
    });
  });
}

function evaluateCallback(page, func) {
  var evalArgs = [func, undefined].concat(
    Array.prototype.slice.call(arguments, 2));
  var p = page.callbackPromise();
  page.evaluate.apply(undefined, evalArgs);
  return p;
}


describe('crypton', function () {
  before(function (done) {
    this.timeout(10000);
    var self = this;
    self.server = http.createServer(app).listen(config.port);
    phantom.create(function (err, ph) {
      if (err) { return done(err); }
      self.phantom = ph;
      done();
    }, phantomOptions);
  });

  after(function (done) {
    var phExit = Q.defer(), sClose = Q.defer();
    this.phantom.exit(phExit.resolve);
    this.server.close(sClose.resolve);
    Q.all([phExit.promise, sClose.promise])
    .done(function () { done(); }, function (err) { done(err); });
  });

  describe('functional test', function () {
    it('can load a page', qTest(function () {
      return openPage(this.phantom, '/test/noop.html')
      .then(function (result) {
        result.status.should.equal('success');
        return Q.nfcall(result.page.evaluate, function () {
          return {
            title: document.title,
            body: document.body.innerHTML
          };
        }).then(function (result) {
          result.title.should.equal('noop');
          result.body.should.equal('ok\n');
        });
      });
    }));

    it('can get callbacks from page', qTest(function () {
      return openPage(this.phantom, '/test/noop.html')
      .then(function (result) {
        result.status.should.equal('success');
        return evaluateCallback(result.page, function () {
          setTimeout(window.callPhantom, 0, 'hello world');
        })
        .then(function (data) {
          data.should.equal('hello world');
        });
      });
    }));
  });

  describe('generateAccount', function () {
    var username = 'testuser';
    var password = 'testpassword';

    it('returns session token', qTest(function () {
      this.timeout(100000);
      return openPage(this.phantom, '/test/crypton.html')
      .then(function (result) {
        result.status.should.equal('success');
        return evaluateCallback(result.page, function (username, password) {
          var step = 0;
          crypton.generateAccount(username, password, function () {
            console.log('step ' + step++);
          }, function (err, account) {
            window.callPhantom({ error: err, account: account });
          }, {
            keypairBits: 512
          });
        }, username, password)
        .then(function (result) {
          should.not.exist(result.error);
          should.exist(result.account);
          result.sessionIdentifier.should.be.ok;
        });
      });
    }));

    it('fails when username is taken');
  });
});
