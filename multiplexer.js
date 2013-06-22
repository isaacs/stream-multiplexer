// vim: set softtabstop=8 shiftwidth=8:

var Stream = require('stream');

if (Stream.PassThrough)
        // v0.10
        return module.exports = Stream.PassThrough;
else
        module.exports = MultiPlexer;

var debug;
if (/\bmulti\b/i.test(process.env.NODE_DEBUG || '')) {
        var pre = 'MULTI ';
        debug = function() {
                var m = util.format.apply(util, arguments);
                m = pre + m.split('\n').join('\n' + pre);
                console.error(m);
        };
} else
        debug = function() {};

var assert = require('assert');
var util = require('util');
util.inherits(MultiPlexer, Stream);
var StringDecoder = require('string_decoder').StringDecoder;

function WriteReq(chunk, enc_, cb_) {
        debug('WriteReq', chunk && chunk.length, enc);
        var enc, cb;
        for (var i = 1; i < arguments.length; i++) {
                var t = typeof arguments[i];
                if (t === 'string' && !enc)
                        enc = arguments[i];
                else if (t === 'function' && !cb)
                        cb = arguments[i];
                else if (t === 'undefined')
                        continue;
                else
                        throw new TypeError('Bad arg ' + i + ':' + t);
        }
        this.cb = cb;
        if (typeof chunk === 'string')
                enc = enc || 'utf8';
        this.enc = enc;
        this.chunk = chunk;
}

function MultiPlexer() {
        if (!(this instanceof MultiPlexer))
                return new MultiPlexer;

        debug('ctor');
        Stream.apply(this, arguments);
        this._paused = false;
        // track the actual dests that we're waiting for.
        this._awaitingDrain = [];
        this._needDrain = false;
        this._buffer = [];
        this._dests = [];
        this._ended = false;
        this._decoder = null;
        this._encoding = '';
        this.readable = true;
        this.writable = true;
}

MultiPlexer.prototype._ondrain = function(dest) {
        debug('ondrain');
        var list = this._awaitingDrain;
        var i = list.indexOf(dest);
        if (i === -1) {
                debug('ondrain: dest not awaiting drainage');
                return;
        }
        if (list.length === 1) {
                debug('fully drained');
                list.length = 0;
                this.flush();
        } else {
                list.splice(i, 1);
                debug('still waiting for %d more', list.length);
        }
};

MultiPlexer.prototype.write = function(chunk, enc, cb) {
        if (this._ended) {
                this.emit('error', new Error('write after end'));
                return false;
        }

        debug('write');
        var req = new WriteReq(chunk, enc, cb);
        this._needDrain = false;
        var ret;
        if (this._paused || !this.flush()) {
                debug('paused, or flush returned false');
                this._buffer.push(req);
                ret = false;
        } else {
                debug('emitData');
                ret = this._emitData(req);
        }
        this._needDrain = !ret;
        return ret;
};

MultiPlexer.prototype.end = function(chunk, enc, cb) {
        if (typeof arguments[arguments.length-1] === 'function')
                this.on('finish', arguments[arguments.length-1]);

        if (chunk)
                this.write(chunk, enc, cb);

        this._ended = true;
        this.flush();
}

MultiPlexer.prototype.pause = function() {
        this._paused = true;
        this.emit('pause');
};

MultiPlexer.prototype.resume = function() {
        this._paused = false;
        this.emit('resume');
        this.flush();
};

MultiPlexer.prototype.setEncoding = function(enc) {
        if (this._decoder) {
                if (enc !== this._encoding)
                        this.emit('error', new Error('encoding change'));
        } else {
                this._decoder = new StringDecoder(enc);
                this._encoding = enc;
        }
};

MultiPlexer.prototype._emitData = function(req) {
        assert(req instanceof WriteReq);
        // try to write the req to all our listeners.
        if (!this._dests.length)
                return this._emitDataEvent(req);

        this._awaitingDrain.length = 0;
        for (var i = 0; i < this._dests.length; i++) {
                var dest = this._dests[i];
                var ret = dest.write(req.chunk, req.enc, req.cb);
                if (!ret)
                        this._awaitingDrain.push(dest);
        }

        if (this._events.data)
                this._emitDataEvent(req);

        return !this._awaitingDrain.length;
};

MultiPlexer.prototype.flush = function() {
        if (this._awaitingDrain.length || this._paused)
                return false;

        if (this._buffer.length === 0)
                return this._emitDrain();

        var ret = true;
        while (this._buffer.length && ret) {
                var req = this._buffer.shift();
                ret = this._emitData(req);
        }
        if (ret)
                this._emitDrain();
        return ret;
};

MultiPlexer.prototype._emitDrain = function() {
        debug('emitDrain', this._buffer.length, this._ended);
        if (this._buffer.length === 0 && this._ended &&
            this._awaitingDrain.length === 0) {
                debug('emit finish');
                this.emit('finish');
                this.emit('end');
        } else if (this._needDrain) {
                debug('emit drain');
                this.emit('drain');
        }
        return true;
};

MultiPlexer.prototype._emitDataEvent = function(req) {
        assert(req instanceof WriteReq);
        if (req.enc === this._encoding) {
                chunk = req.chunk;
        } else {
                if (!Buffer.isBuffer(req.chunk))
                        chunk = new Buffer(req.chunk, req.enc);
                if (this._decoder)
                        chunk = this._decoder.write(chunk);
        }
        this.emit('data', chunk);
};

MultiPlexer.prototype.pipe = function(dest, options) {
        if (this._dests.indexOf(dest) !== -1) {
                debug('already piping', dest);
                return dest;
        }

        options = options || {};
        debug('pipe', dest, options);

        var source = this;
        this._dests.push(dest);
        dest.on('drain', ondrain);
        dest.on('close', cleanup);
        dest.on('finish', cleanup);

        function ondrain() {
                source._ondrain(dest);
        }

        if (!dest._isStdio && options.end !== false)
                source.on('end', onend);

        var didOnEnd = false;
        function onend() {
                if (!didOnEnd)
                        dest.end();
                didOnEnd = true;
        }

        function cleanup() {
                dest.removeListener('drain', ondrain);
                dest.removeListener('finish', cleanup);
                dest.removeListener('close', cleanup);
                var i = source._dests.indexOf(dest);
                if (i !== -1) {
                        if (source._dests.length === 1)
                                source._dests.length = 0;
                        else
                                source._dests.splice(i, 1);
                }
        }

        return dest;
};
