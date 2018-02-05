const SerialPort = require('serialport');
const PixelPusher = require('heroic-pixel-pusher');
const getPixels = require('get-pixels');
const fs = require('fs');
const q = require('q');
const gm = require('gm');

['files', 'debug', 'noise', 'teensy'].forEach((debugMode) => {
  if (process.env.ENVIRONMENT == 'dev') {
    console.log('Setting', debugMode);
    global[debugMode] = require('ndebug')(debugMode);
  } else {
    global[debugMode] = () => {};
  }
});

const imageFiles = [];
let currentFile = 0;
let teensyPort;

let RPM;
let SYNC;

const rpmReg = /\(smoothed\): ([0-9.]+)/ig;
const tickReg = /(TICK)/ig;
const teensyReg = /usb.+[0-9]+/i;

let teensySearchPeriod = 1000;
let imageChangePeriod = 15000;

let imageColumns = [];
let stripsArray = [];

var server = require('http').createServer();

var io = require('socket.io')(server);

server.listen(3040);

const PixelInterface = function (go) {

  var vm = this;
  vm.client = {};
  io.on('connection', function(client) {
    vm.client = client;
    go();
    vm.client.on('event', function(data){

    });
    vm.client.on('disconnect', function(){

    });
  });


  vm.PixelStrip = PixelPusher.PixelStrip;
  vm.PixelPusherInstance = new PixelPusher(); // will start listener.

  vm.UPDATE_FREQUENCY_MILLIS = 30;
  vm.PIXELS_PER_STRIP = 360;
  vm.exec = function () { return function () {} }; // NOP CLOSURE

  vm.timer = null;
  vm.controller;
  vm.isActive = false;

  vm.updateTiming = function (timing) {
    if (typeof timing == 'number') {
      debug('Setting new timing to:', timing, 'ms');
      vm.UPDATE_FREQUENCY_MILLIS = timing;
      vm.resetTimer();
    }
  };

  vm.updateExecutable = function (exec) {
    if (typeof exec == 'function') {
      debug('Updating exec');
      vm.exec = exec;
      vm.resetTimer();
    }
  }

  vm.resetTimer = function () {
    if (vm.timer !== null) {
      debug('Killing timer');
      clearTimeout(vm.timer);
      vm.timer = null;
    }
    if (vm.isActive) {
      debug('Restarting loop');
      vm.timer = setInterval(
        vm.exec,
        vm.UPDATE_FREQUENCY_MILLIS);
    }
  }

  vm.waveRider = function(strips) {
    let waveWidth = 2;
    let waveHeight = vm.PIXELS_PER_STRIP / waveWidth;
    let wavePosition = 0;
    let startIdx;
    debug('init: waveRider', waveWidth, waveHeight, wavePosition, startIdx);
    return function innerRider() {
      debug('Call:', wavePosition, vm.timer, vm.PIXELS_PER_STRIP);

      startIdx = waveHeight + wavePosition;
      console.log(vm.stripsArray);
      for (var i = startIdx, j = waveWidth; i < vm.PIXELS_PER_STRIP &&  i > waveHeight && j > 0; i--, j--) {
          vm.stripsArray.forEach(function (strip) {
            console.log(strip);
            strip.getPixel(i).setColor(255, 0, 255, (j / waveWidth) / 1.0);
          });
      }
      startIdx = waveHeight - wavePosition;
      for (var i = startIdx, j = waveWidth; i > 0 &&  i < waveHeight && j > 0; i++, j--) {
        vm.stripsArray.forEach(function (strip) {
          strip.getPixel(i).setColor(255, 0, 255, (j / waveWidth) / 1.0);
        });
      }

      vm.stripsArray.forEach(function (strip) {
        strip.getRandomPixel().setColor(0,0,255, 0.1);
      });
      //vm.controller.refresh(strips.map(function (strip) { return strip.getStripData();}));
      vm.controller.emit('data', vm.stripsArray.map(function (strip) { return strip.getStripData();}));

      vm.stripsArray.forEach(function (strip) {
        strip.clear();
      });

      wavePosition = (wavePosition + 1) % waveHeight;

      //vm.timer = setInterval(
      // innerRider();
        //vm.UPDATE_FREQUENCY_MILLIS);
    }
  }

  vm.writeImage = function (strips) {
    let columnIter = 0;
    let column = [];
    let localImageCopy = [];
    return function writeColumn () {
      localImageCopy = [].concat.apply(imageColumns); // get a detached copy
      column = localImageCopy[columnIter];

      for (var pixel = 0; pixel < vm.PIXELS_PER_STRIP; pixel++) {
        strips.forEach(function (strip, stripIndex) {
          strip.getPixel(pixel).setColor(
            column[pixel][0], // R
            column[pixel][1], // G
            column[pixel][2] // B
          );
        });
      }

      strips.forEach(function (strip) {
        strip.getRandomPixel().setColor(0, 0, 255, 0.3);
      });

      vm.controller.emit('data', strips.map(function (strip) { return strip.getStripData();}));

      strips.forEach(function (strip) {
        strip.clear();
      });

      columnIter = (columnIter >= localImageCopy.length - 1) ? 0 : columnIter + 1;
    }
  }


  vm.PixelPusherInstance.on('discover', (controller) => {
    vm.controller = controller;
    vm.isActive = true;
    vm.resetTimer();
    ['-----------------------------------',
     'Discovered PixelPusher on network: ',
     controller.params.pixelpusher,
     '-----------------------------------'].forEach(line => noise(line));

    // capture the update message sent back from the pp controller
    controller.on('update', () => {
      noise({ updatePeriod: controller.params.pixelpusher.updatePeriod, deltaSequence: controller.params.pixelpusher.deltaSequence, powerTotal: controller.params.pixelpusher.powerTotal });
    }).on('timeout', () => {
      debug('TIMEOUT : PixelPusher at address [' + controller.params.ipAddress + '] with MAC (' + controller.params.macAddress + ') has timed out. Awaiting re-discovery....');
      if (vm.timer !== null) {
        clearInterval(vm.timer);
      }
      vm.isActive = false;
      vm.controller = null;
    });

    vm.stripsArray = [];
    for (var i = 0; i < 1; i++) {
      vm.stripsArray.push(new vm.PixelStrip(i, vm.PIXELS_PER_STRIP));
    }

    vm.PIXELS_PER_STRIP = controller.params.pixelpusher.pixelsPerStrip;
    vm.updateExecutable(vm.waveRider(stripsArray));
  }).on('error', (err) => {
    vm.isActive = false;
    vm.controller = null;
    debug('PixelPusher Error: ' + err.message);
  });
};

var PixelPusherInterface = new PixelInterface(() => {});
readFilesFromDir();
nextFile();
loadFile().then(img => {
  debug(`loadFile() ${img} ready`);
});

currentFile = -1;

// Set the exec pattern

function readFilesFromDir() {
  items = fs.readdirSync('./data/');
  items = items.filter(item => {
    return /\.(jpg|jpeg|png)$/i.test(item);
  });
  items.forEach( (item, i) => {
    imageFiles[i] = './data/' + items[i];
  });
}

function nextFile() {
  currentFile++;
  currentFile = (currentFile >= imageFiles.length) ? 0 : currentFile;
}

function previousFile() {
  currentFile--;
  currentFile = (currentFile < 0) ? imageFiles.length - 1 : currentFile;
}

function getNDColumns(pixels) {
  var width = pixels.shape[0];
  var height = pixels.shape[1];
  imageColumns = [];
  for (var col = 0; col < width; col++) {
    imageColumns[col] = [];
    for (var row = 0; row < height; row++) {
      imageColumns[col].push([
        pixels.get(col, row, 0),
        pixels.get(col, row, 1),
        pixels.get(col, row, 2),
        pixels.get(col, row, 3)]);
    }
  }
  // console.log(imageColumns[0]);
  if (PixelPusherInterface.hasOwnProperty('client')
    && PixelPusherInterface.client.hasOwnProperty('emit')) {
      console.log('Emit Smith.');
    PixelPusherInterface.client.emit('column', imageColumns[0]);
  }
}

function loadFile() {
  var deferred = q.defer();
  debug('Working on:', imageFiles[currentFile]);
  var resized = imageFiles[currentFile].replace(/data\//g, 'data/resized/').replace(/\.png/g, '.jpg');
  gm(imageFiles[currentFile])
    .quality(100)
    .resize(360, 360)
    .write(resized, function (err) {
      if (!err) {
        debug('done');
        getPixels(resized, function(err, pixels) {
          getNDColumns(pixels);
          deferred.resolve(resized);
        });
      } else {
        console.log(err);
      }
  });
  return deferred.promise;
}

function parseDataFromRing(data) {
  var matches = rpmReg.exec(data);
  if (matches && matches[1] != null) {
    RPM = Number(matches[1]);
    teensy('\t\tRPM', RPM);
  }
  matches = tickReg.exec(data);
  if (matches && matches[1] != null) {
    SYNC = new Date();
    teensy('SYNC signal caught.', SYNC);
  }
}

function pickupTeensy () {
  teensy('Looking for Teensy..');
  SerialPort.list(function (err, ports) {
    ports.forEach(function(port) {
      if (teensyReg.test(port.comName)) {
        teensy('Found teensy:', port);
        teensyPort = new SerialPort(port.comName, {
  	      parser: SerialPort.parsers.readline('\n')
        });
        teensyPort.on('data', (data) => {
          teensy(data);
          parseDataFromRing(data);
        });
        teensyPort.on('close', () => {
          teensyPort = undefined;
          teensy('Teensy disconnected.');
        });
      }
    });
  });
}

function dec2bin(dec) {
  return (dec >>> 0).toString(2);
}

setInterval(function () {
  //readFilesFromDir();
  nextFile();
  loadFile().then(() => {
    debug('Image ready.');
  });
}, imageChangePeriod);

setInterval(function () {
  if (teensyPort == undefined) {
    // pickupTeensy();
    parseDataFromRing('TARGETRPM: 100.00 GAP: -34.13 GGAP: 34.13 RPM: 134.13 (smoothed): 133 HZ: 2.24 Ascending: 1 Power: 2600.00 Voltage: 2.09 Output: 0.00');
//    parseDataFromRing('TARGETRPM: 100.00 GAP: -34.13 GGAP: 34.13 RPM: 134.13 (smoothed): 133 HZ: 2.24 Ascending: 1 Power: 2600.00 Voltage: 2.09 Output: 0.00 TICK');
  }
}, teensySearchPeriod);



process
  .on('unhandledRejection', (reason, p) => {
    console.error(reason, 'Unhandled Rejection at Promise', p);
  })
  .on('uncaughtException', err => {
    console.error(err, 'Uncaught Exception thrown');
    process.exit(1);
  });
