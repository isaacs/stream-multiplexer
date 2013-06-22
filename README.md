# stream-multiplexer

Pipe one stream in, many streams out.  Goes as slow as the slowest writer.

## THE PROBLEM

If you are trying to pipe to a very fast stream, and also to a very
slow stream, then every time the fast stream emits `drain`, it'll try
to write another chunk.

Most of the time, you'd prefer that the reader goes no faster than the
slowest writer can accomodate.

In Node v0.10, this is how it works.  However, in Node v0.8 and
before, any `'drain'` event from any writer would cause the reader to
emit more data.

Compounding the issue, in v0.8, writable streams usually emitted
`'drain'` after any flushed `write()`, even if it was immediately
flushed, and already returned true!

In Node v0.10, this module simply exports the `stream.PassThrough`
module.  In Node v0.8 and before, it exports a streams1 style stream
that behaves properly when piped to multiple differing-speed
destinations.

If you know that your program will only be run in Node v0.10 and
above, don't bother with this module.

## USAGE

```javascript
var SM = require('stream-multiplexer');
var sm = new SM;
var myStream = fs.createReadStream('some-file');

myStream.pipe(sm);
sm.pipe(fastWriter);
sm.pipe(slowWriter);
```
