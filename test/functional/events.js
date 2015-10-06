'use strict';

var JSONStream = require('JSONStream');
var async = require('async');
var checkClean = require('./fixtures').checkClean;
var createCount = require('callback-count');
var dockerMock = require('../../lib/index');

var Lab = require('lab');
var lab = exports.lab = Lab.script();
var after = lab.after;
var before = lab.before;
var beforeEach = lab.beforeEach;
var describe = lab.describe;
var expect = require('code').expect;
var it = lab.it;

var docker = require('dockerode')({
  host: 'http://localhost',
  port: 5354
});

describe('events', function () {
  var server;
  before(function (done) { server = dockerMock.listen(5354, done); });
  // make sure we are starting with a clean mock
  // (tests should clean-up after themselves)
  beforeEach(function (done) { checkClean(docker, done); });
  after(function (done) { server.close(done); });

  it('should return one time result when since is provided', function (done) {
    docker.getEvents(
      { since: Date.now() },
      function (err, eventStream) {
        if (err) { return done(err); }
        var count = createCount(100, done);
        eventStream.pipe(JSONStream.parse()).on('data', function (json) {
          expect(json.status).to.be.a.string();
          expect(json.id).to.be.a.string();
          expect(json.from).to.be.a.string();
          expect(json.time).to.be.a.number();
          count.next();
        });
      }
    );
  });

  it('should return one time result when until is provided', function (done) {
    docker.getEvents(
      { until: Date.now() },
      function (err, eventStream) {
        if (err) { return done(err); }
        var count = createCount(100, done);
        eventStream.pipe(JSONStream.parse()).on('data', function (json) {
          expect(json.status).to.be.a.string();
          expect(json.id).to.be.a.string();
          expect(json.from).to.be.a.string();
          expect(json.time).to.be.a.number();
          count.next();
        });
      }
    );
  });

  it('should stream emitted events', function (done) {
    process.env.DISABLE_RANDOM_EVENTS = true;
    var interval = setInterval(function () {
      var data = dockerMock.events.generateEvent();
      dockerMock.events.stream.emit('data', data);
    }, 10);
    var count = createCount(10, function (err) {
      clearInterval(interval);
      delete process.env.DISABLE_RANDOM_EVENTS;
      done(err);
    });
    docker.getEvents(function (err, eventStream) {
      if (err) { return count.next(err); }
      var i = 0;
      eventStream.on('data', function (data) {
        var json = JSON.parse(data.toString());
        expect(json.status).to.be.a.string();
        expect(json.id).to.be.a.string();
        expect(json.from).to.be.a.string();
        expect(json.time).to.be.a.number();
        if (i++ === 9) {
          // this destroys the _socket_
          eventStream.destroy();
        }
        count.next();
      });
    });
  });

  it('should emit create, start, kill, start, restart, stop real events',
    function (done) {
      process.env.DISABLE_RANDOM_EVENTS = true;
      var container;
      var expectedEvents = [
        'create',
        'start',
        'die',
        'kill',
        'start',
        'die',
        'start',
        'restart',
        'die',
        'stop',
        'destroy'
      ];
      var count = createCount(expectedEvents.length, function (err) {
        delete process.env.DISABLE_RANDOM_EVENTS;
        done(err);
      });
      docker.getEvents(function (err, eventStream) {
        if (err) { return count.next(err); }
        eventStream.on('data', function (data) {
          var json = JSON.parse(data.toString());
          var expectedEvent = expectedEvents.shift();
          expect(json.status).to.be.a.string();
          expect(json.status).to.equal(expectedEvent);
          expect(json.id).to.be.a.string();
          expect(json.from).to.be.a.string();
          expect(json.time).to.be.a.number();
          if (expectedEvents.length === 0) {
            eventStream.destroy();
          }
          count.next();
        });
      });
      docker.createContainer({}, function (err, c) {
        if (err) { return count.next(err); }
        container = c;
        async.series([
          container.start.bind(container),
          container.kill.bind(container),
          container.start.bind(container),
          container.restart.bind(container),
          container.stop.bind(container),
          container.remove.bind(container)
        ], function (seriesErr) {
          if (seriesErr) { return count.next(seriesErr); }
        });
      });
    }
  );

  it('should stream random generated events', function (done) {
    var count = createCount(5, done);
    docker.getEvents(function (err, eventStream) {
      if (err) { return done(err); }
      var i = 0;
      eventStream.on('data', function (data) {
        var json = JSON.parse(data.toString());
        expect(json.status).to.be.a.string();
        expect(json.id).to.be.a.string();
        expect(json.from).to.be.a.string();
        expect(json.time).to.be.a.number();
        if (i++ >= 5) {
          // this destroys the _socket_
          return eventStream.destroy();
        }
        count.next();
      });
    });
  });
});
