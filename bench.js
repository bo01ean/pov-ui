
// MBP 2.5 GHz i7, 16GB 1600 MHz DDR3,
//  Yosemite 10.10.3 nodejs v0.12.2
//  test Buffer.compare.BUFFERTOOLS#test x 8,186 ops/sec ±1.58% (80 runs sampled) +0ms buffertools.equals
//  test Buffer.compare.EXTENDED#test x 1,677 ops/sec ±1.83% (83 runs sampled) +12s Buffer.monekypatch
//  test Buffer.compare.SIMPLE#test x 313,023 ops/sec ±1.59% (86 runs sampled) +12s ===
//  test Fastest is Buffer.compare.SIMPLE#test +6ms

// AWS t1.micro (Intel(R) Xeon(R) CPU E5-2650 0 @ 2.00GHz)
//  Ubuntu 14.04.2 LTS nodejs v0.10.33
//  test Buffer.compare.BUFFERTOOLS#test x 4,577 ops/sec ±7.08% (82 runs sampled) +0ms
//  test Buffer.compare.EXTENDED#test x 759 ops/sec ±4.85% (85 runs sampled) +11s
//  test Buffer.compare.SIMPLE#test x 170,790 ops/sec ±6.60% (85 runs sampled) +11s
//  test Fastest is Buffer.compare.SIMPLE#test +12ms

// AWS m3.large (2 x Intel(R) Xeon(R) CPU E5-2670 v2 @ 2.50GHz)
//  Ubuntu 14.04.2 LTS nodejs v0.10.33
//  test Buffer.compare.BUFFERTOOLS#test x 8,045 ops/sec ±5.31% (90 runs sampled) +0ms
//  test Buffer.compare.EXTENDED#test x 1,309 ops/sec ±6.57% (84 runs sampled) +11s
//  test Buffer.compare.SIMPLE#test x 298,343 ops/sec ±4.84% (90 runs sampled) +11s
//  test Fastest is Buffer.compare.SIMPLE#test +6ms

// RENDERBEAST (2xE3-2680 @2.6 GHZ ) w/64GB RAM
//  Ubuntu 14.10 nodejs v0.10.25
//  test Buffer.compare.BUFFERTOOLS#test x 4,052 ops/sec ±0.54% (95 runs sampled) +0ms
//  test Buffer.compare.EXTENDED#test x 704 ops/sec ±1.29% (90 runs sampled) +11s
//  test Buffer.compare.SIMPLE#test x 158,575 ops/sec ±0.27% (86 runs sampled) +11s
//  test Fastest is Buffer.compare.SIMPLE#test +9ms

// RENDERBEAST (2xE3-2680 @2.6 GHZ ) w/64GB RAM
//  Ubuntu 14.10 nodejs v0.10.25
//  nodejs v0.10.39
//  test Buffer.compare.BUFFERTOOLS#test x 9,584 ops/sec ±1.06% (95 runs sampled) +0ms
//  test Buffer.compare.EXTENDED#test x 1,645 ops/sec ±1.01% (95 runs sampled) +6s
//  test Buffer.compare.SIMPLE#test x 376,125 ops/sec ±0.22% (97 runs sampled) +6s
//  test Fastest is Buffer.compare.SIMPLE#test +5ms

var benchmark = require('benchmark');
var buffertools = require('buffertools');
var debug = require('debug')('test');
var suite = new benchmark.Suite;

var extendStatic = function() {
  Buffer.toArr = function (buffer, base) {
    //console.log(buffer.toString('hex'));
    base = base || 16;
    return buffer.toString('hex').match(/[0-9a-f]{2}/g).map(function(x) { return parseInt(x, base); });
  }
  Buffer.compare = function (a, b, base) {
    base = base || 16;
    var aArr = Buffer.toArr(a, base), bArr = Buffer.toArr(b, base);
    if (aArr.length == bArr.length && aArr.every(function(u, i) { return u === bArr[i];})) {
      return true;
    } else {
      return false;
    }
  }

}

extendStatic();

var makeBuffer = function(size){
  return new Buffer(size);
}

var tests = [
  ['/x55/x43/x22/x24', '/x55/x43/x22/x25', false],
  ['/x55/x43/x22/x24','/x55/x43/x22/x24', true],
  ['slayer', 'slayed', false],
  ['slayer', 'slayer', true],
  ['0123456789', '0123456789', true],
  ['0123456789', '0123456788', false],
];

var tmpBuf;
for(var i = 0; i<63; i++) {
  tmpBuf = makeBuffer(2^2550);
  if (tmpBuf.length  > 0) {
    tests.push([tmpBuf.toString('hex'), tmpBuf.toString('hex'), true]);
  }
}

function testBt() {
  tests.forEach( function(test) {
    var a = new Buffer(test[0]), b = new Buffer(test[1]);
    (buffertools.equals(a,b) === test[2]);
  });
}

function testSimple() {
  tests.forEach( function(test) {
    ((test[0] === test[1]) === test[2]);
  });
}

function test() {
  tests.forEach( function(test) {
    var a = new Buffer(test[0]), b = new Buffer(test[1]);
    (test[2] === Buffer.compare(a, b));
  });
}

function testToString() {
  tests.forEach( function(test) {
    var a = Buffer.from(test[0]);
    var b = Buffer.from(test[1]);
    ((a.toString() === b.toString()) === test[2]);
  });
}


function testBufEquals() {
  tests.forEach( function(test) {
    var a = Buffer.from(test[0]);
    var b = Buffer.from(test[1]);
    ((a.equals(b)) === test[2]);
  });
}

suite
.add('Buffer.compare.BUFFERTOOLS#test', testBt)// uses buffertools.compare from library
//.add('Buffer.compare.EXTENDED#test', test) // uses static method monkey patched into buffer type
//.add('Buffer.compare.SIMPLE#test', testSimple) // uses === LOL
.add('Buffer.compare.TOSTRING#test', testToString) // uses === LOL
.add('Buffer.equals.#test', testBufEquals) // uses === LOL

.on('cycle', function(event){ debug(String(event.target)); })
.on('complete', function() {
  debug('Fastest is ' + this.filter('fastest').map('name'));
})
.run({ 'async': true });
