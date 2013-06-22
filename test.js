// vim: set softtabstop=8 shiftwidth=8:

// fake the non-v0.10 world
var Stream = require('stream');
delete Stream.PassThrough;

var MP = require('./multiplexer.js');

var assert = require('assert')
var util = require('util')
var EE = require('events').EventEmitter;

var slow = util._extend(new EE, {
        id: 'slow',
        writable: true,
        writing: false,
        write: function(chunk) {
                if (this.writing)
                        throw new Error('backpressure fail!');

                this.writing = true;
                setTimeout(function() {
                        this.writing = false;
                        this.emit('drain');
                }.bind(this), 10);
                return false;
        },
        end: function() {
                setTimeout(function() {
                        this.emit('finish');
                }.bind(this), 10);
        }
});

var slowFinished = false;
slow.on('finish', function() {
        slowFinished = true;
});

var fast = util._extend(new EE, {
        id: 'fast',
        writable: true,
        writing: false,
        write: function(chunk) {
                if (this.writing)
                        throw new Error('backpressure fail!');

                this.writing = true;
                process.nextTick(function() {
                        this.writing = false;
                        // omg drain!  drain drain draindraindrain!!!!!
                        // so many drain!  i <3 drain!  can you see
                        // how drained i am?  this is so draining! can
                        // i have some more data, please, nownownow!?!
                        this.emit('drain');
                }.bind(this));
                return true;
        },
        end: function() {
                setTimeout(function() {
                        this.emit('finish');
                }.bind(this), 10);
        }
});

var fastFinished = false;
fast.on('finish', function() {
        fastFinished = true;
});

var src = util._extend(new Stream(), {
        readable: true,
        _chunks: 10,
        _paused: false,
        pause: function() {
                this._paused = true;
        },
        resume: function() {
                this._paused = false;
                this.flow();
        },
        flow: function() {
                if (this._paused)
                        return;

                // should not resume until buffer is empty
                assert.equal(mp._buffer.length, 0);
                if (--this._chunks <= 0) {
                        this.emit('end');
                } else {
                        var chunk = new Buffer(1024);
                        chunk.fill('i');
                        this.emit('data', chunk);
                        this.emit('data', chunk);

                        // should buffer up the one extra chunk
                        assert.equal(mp._buffer.length, 1);
                }
        }
});

process.on('exit', function(c) {
        assert(fastFinished);
        assert(slowFinished);
        console.log('ok');
});


var mp = new MP();

src.pipe(mp);
mp.pipe(slow);
mp.pipe(fast);
src.flow();
