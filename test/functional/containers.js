'use strict'

var chai = require('chai')
var assert = chai.assert

var async = require('async')
var checkClean = require('./fixtures').checkClean
var createCount = require('callback-count')
var dockerMock = require('../../lib/index')
var noop = require('101/noop')

var docker = require('dockerode')({
  host: 'http://localhost',
  port: 5354
})

describe('containers', function () {
  var server
  before(function (done) { server = dockerMock.listen(5354, done) })
  // make sure we are starting with a clean mock
  // (tests should clean-up after themselves)
  beforeEach(function (done) { checkClean(docker, done) })
  after(function (done) { server.close(done) })

  it('should create and delete a container', function (done) {
    async.waterfall([
      docker.createContainer.bind(docker, {}),
      function (container, cb) {
        var count = createCount(cb)
        // eventsStream.on('data', expectStatus('destroy', count.inc().next))
        container.remove(count.inc().next)
      }
    ], done)
  })
  it('should create a container with env in the body', function (done) {
    var createData = {
      name: 'hello',
      Env: ['MY_AWESOME_ENV_VARIABLE=inconceivable']
    }
    async.waterfall([
      docker.createContainer.bind(docker, createData),
      function (container, cb) {
        async.parallel([
          container.inspect.bind(container),
          docker.listContainers.bind(docker)
        ], function (err, results) {
          cb(err, results)
        })
      }
    ], function (err, results) {
      if (err) { return done(err) }
      var containerData = results[0]
      var containers = results[1]
      // this should be capitalized and used
      assert.propertyVal(containerData, 'Name', '/' + createData.name)
      assert.isArray(containerData.Env)
      assert.lengthOf(containerData.Env, 1)
      assert.equal(containerData.Env[0], createData.Env[0])
      assert.lengthOf(containers, 1)
      assert.deepEqual(containers[0].Names, ['/hello'])
      docker.getContainer(createData.name).remove(done)
    })
  })
  it('should fail to create a named container if name is already in use', function (done) {
    var createData = {
      name: 'CoolContainer'
    }
    async.series([
      docker.createContainer.bind(docker, createData),
      docker.createContainer.bind(docker, createData)
    ], function (err, results) {
      assert.ok(results[0].id)
      assert.equal(err.statusCode, 409)
      docker.getContainer(results[0].id).remove(done)
    })
  })
  it('should list all the containers when there are none', function (done) {
    docker.listContainers(function (err, containers) {
      if (err) { return done(err) }
      assert.lengthOf(containers, 0)
      done()
    })
  })

  describe('labels', function () {
    var container
    var otherContainer
    var Labels = {
      type: 'user-container',
      ultimateQuestion: 'batmanvssuperman',
      obviousAnswer: 'superman',
      secret: 'batman=superman'
    }
    beforeEach(function (done) {
      async.parallel({
        c1: function (cb) { docker.createContainer({ Labels: Labels }, cb) },
        c2: function (cb) { docker.createContainer({ Labels: ['foobar'] }, cb) }
      }, function (err, data) {
        if (err) { return done(err) }
        container = data.c1
        otherContainer = data.c2
        done()
      })
    })
    afterEach(function (done) {
      async.parallel([
        function (cb) { container.remove(cb) },
        function (cb) { otherContainer.remove(cb) }
      ], done)
    })

    it('should save Labels on create and respond with Labels on inspect', function (done) {
      container.inspect(function (err, data) {
        if (err) { return done(err) }
        Object.keys(Labels).forEach(function (l) {
          assert.equal(data.Config.Labels[l], Labels[l])
        })
        done()
      })
    })

    it('should filter on Labels', function (done) {
      var opts = {
        filters: JSON.stringify({
          label: ['foobar']
        })
      }
      docker.listContainers(opts, function (err, containers) {
        if (err) { return done(err) }
        assert.lengthOf(containers, 1)
        // dockerode uses .id, not .Id
        assert.equal(containers[0].Id, otherContainer.id)
        done()
      })
    })

    it('should filter on Labels with values', function (done) {
      var opts = {
        filters: JSON.stringify({
          label: ['obviousAnswer=superman']
        })
      }
      docker.listContainers(opts, function (err, containers) {
        if (err) { return done(err) }
        assert.lengthOf(containers, 1)
        // dockerode uses .id, not .Id
        assert.equal(containers[0].Id, container.id)
        done()
      })
    })

    it('should filter on Labels with complex values', function (done) {
      var opts = {
        filters: JSON.stringify({
          label: ['secret="batman=superman"']
        })
      }
      docker.listContainers(opts, function (err, containers) {
        if (err) { return done(err) }
        assert.lengthOf(containers, 1)
        // dockerode uses .id, not .Id
        assert.equal(containers[0].Id, container.id)
        done()
      })
    })
  })

  describe('interactions', function () {
    var container
    beforeEach(function (done) {
      docker.createContainer({}, function (err, c) {
        if (err) { return done(err) }
        container = c
        done()
      })
    })
    afterEach(function (done) {
      container.remove(done)
    })

    it('should list all the containers', function (done) {
      docker.listContainers(function (err, containers) {
        if (err) { return done(err) }
        assert.lengthOf(containers, 1)
        assert.equal(containers[0].Id, container.id)
        done()
      })
    })
    it('should give us information about it', function (done) {
      container.inspect(function (err, data) {
        if (err) { return done(err) }
        assert.equal(data.Id, container.id)
        done()
      })
    })
    it('should attach to the container', function (done) {
      container.attach({}, function (err, stream) {
        if (err) { return done(err) }
        stream.on('data', noop)
        stream.on('end', function () { done() })
      })
    })
    it('should error on an unknown container', function (done) {
      docker.getContainer('nope').inspect(function (err) {
        // FIXME(bryan): not checking for 404
        if (err) {
          done()
        } else {
          done('should have return a 404')
        }
      })
    })
    it('should be able to commit a container to an image', function (done) {
      async.waterfall([
        function (cb) {
          container.commit({
            repo: 'committedContainer'
          }, cb)
        },
        function (imageData, cb) {
          var image = docker.getImage('committedContainer')
          image.inspect(function (err, data) {
            if (err) { return cb(err) }
            assert.include(data.Id, imageData.Id)
            cb(null, image)
          })
        },
        function (image, cb) {
          image.remove(cb)
        }
      ], done)
    })
    it('should be able to start it', function (done) {
      var count = createCount(2, done)
      dockerMock.events.stream.on('data', function (data) {
        dockerMock.events.stream.removeAllListeners('data')
        data = JSON.parse(data)
        assert.equal(data.status, 'start')
        assert.equal(data.id, container.id)
        count.next()
      })
      async.series([
        container.start.bind(container),
        container.inspect.bind(container)
      ], function (err, data) {
        if (err) { return count.next(err) }
        data = data[1] // get the inspect data
        assert.equal(data.State.Running, true)
        assert.isNumber(data.State.Pid)
        count.next()
      })
    })
    it('should be able to get the logs', function (done) {
      async.series([
        container.start.bind(container),
        container.logs.bind(container, {})
      ], function (err, data) {
        if (err) { return done(err) }
        var logs = data[1]
        assert.equal(logs, 'Just a bunch of text')
        done()
      })
    })
    it('should should not start twice', function (done) {
      var originalInspect
      async.series([
        container.start.bind(container),
        function (cb) {
          container.inspect(function (err, data) {
            originalInspect = data
            cb(err)
          })
        },
        container.start.bind(container)
      ], function (seriesErr) {
        if (!seriesErr) { return done('should not have started second time') }
        container.inspect(function (err, data) {
          if (err) { return done(err) }
          assert.deepEqual(data, originalInspect)
          done()
        })
      })
    })
    it('should be able to stop it', function (done) {
      var count = createCount(2, function (err) {
        dockerMock.events.stream.removeAllListeners('data')
        done(err)
      })
      assertEvents(
        container,
        dockerMock.events.stream,
        [ 'start', 'die', 'stop' ],
        count.next
      )
      async.series([
        container.start.bind(container),
        container.stop.bind(container),
        container.inspect.bind(container)
      ], function (err, data) {
        if (err) { return count.next(err) }
        data = data[2]
        assert.equal(data.State.Running, false)
        assert.equal(data.State.Pid, 0)
        count.next()
      })
    })
    it('should be able to stop and wait for it to stop', function (done) {
      async.series([
        container.start.bind(container),
        container.wait.bind(container),
        container.inspect.bind(container)
      ], function (err, data) {
        if (err) { return done(err) }
        data = data[2]
        assert.equal(data.State.Running, false)
        assert.equal(data.State.Pid, 0)
        done()
      })
    })
    it('should come back with an error if stopped twice', function (done) {
      async.series([
        container.start.bind(container),
        container.stop.bind(container)
      ], function (seriesErr) {
        if (seriesErr) { return done(seriesErr) }
        container.stop(function (stopErr) {
          assert.propertyVal(stopErr, 'statusCode', 304)
          container.inspect(function (err, data) {
            if (err) { return done(err) }
            assert.deepPropertyVal(data, 'State.Running', false)
            assert.deepPropertyVal(data, 'State.Pid', 0)
            done()
          })
        })
      })
    })
    it('should be able to kill it', function (done) {
      var count = createCount(2, function (err) {
        dockerMock.events.stream.removeAllListeners('data')
        done(err)
      })
      assertEvents(
        container,
        dockerMock.events.stream,
        [ 'start', 'die', 'kill' ],
        count.next
      )
      async.series([
        container.start.bind(container),
        container.kill.bind(container)
      ], function (seriesErr) {
        if (seriesErr) { return count.next(seriesErr) }
        container.inspect(function (err, data) {
          if (err) { return count.next(err) }
          assert.deepPropertyVal(data, 'State.Running', false)
          assert.deepPropertyVal(data, 'State.ExitCode', 1)
          count.next()
        })
      })
    })
    it('should be able to kill it w/ a signal', function (done) {
      var count = createCount(2, function (err) {
        dockerMock.events.stream.removeAllListeners('data')
        done(err)
      })
      assertEvents(
        container,
        dockerMock.events.stream,
        [ 'start', 'die', 'kill' ],
        count.next
      )
      async.series([
        container.start.bind(container),
        container.kill.bind(container, { signal: 'SIGINT' })
      ], function (seriesErr) {
        if (seriesErr) { return count.next(seriesErr) }
        container.inspect(function (err, data) {
          if (err) { return count.next(err) }
          assert.deepPropertyVal(data, 'State.Running', false)
          // 0 anything other than SIGKILL
          assert.deepPropertyVal(data, 'State.ExitCode', 0)
          count.next()
        })
      })
    })
    it('should be able to restart it', function (done) {
      var count = createCount(2, function (err) {
        dockerMock.events.stream.removeAllListeners('data')
        done(err)
      })
      assertEvents(
        container,
        dockerMock.events.stream,
        [ 'start', 'die', 'start', 'restart' ],
        count.next
      )
      async.series([
        container.start.bind(container),
        container.restart.bind(container)
      ], function (seriesErr) {
        if (seriesErr) { return count.next(seriesErr) }
        container.inspect(function (err, data) {
          if (err) { return count.next(err) }
          // FIXME: these test are broken. this does not return true
          assert.deepPropertyVal(data, 'State.Running', true)
          count.next()
        })
      })
    })
  })
})

function assertEvents (container, eventStream, expectedEvents, callback) {
  var count = createCount(expectedEvents.length, callback)
  eventStream.on('data', function (data) {
    data = JSON.parse(data)
    var expectedEvent = expectedEvents.shift()
    assert.propertyVal(data, 'status', expectedEvent)
    assert.propertyVal(data, 'id', container.id)
    count.next()
  })
}
