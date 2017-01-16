var SerialPort = require('serialport');
var PixelPusher = require('heroic-pixel-pusher');
var getPixels = require("get-pixels");
var fs = require('fs');

var debug = noise = teensy = function () {};

if (process.env.ENVIRONMENT == 'dev') {
  debug = require('boolean-debug')('info');
  noise = require('boolean-debug')('noise');
  teensy = require('boolean-debug')('teensy');
}

var imageFiles = [];
var currentFile = 0;
var teensyPort;

var RPM;
var rpmReg = new RegExp("\(smoothed\): ([0-9.]+)", "g");
var tickReg = new RegExp("TICK", "g");
var teensyReg = new RegExp("usb.+[0-9]+");
var teensySearchPeriod = 1000;

var imageChangePeriod = 1000;

var imageColumns;
var stripsArray = [];

var PixelInterface = function () {

  var vm = this;

  vm.PixelStrip = PixelPusher.PixelStrip;
  vm.PixelPusherInstance = new PixelPusher(); // will start listener.

  vm.UPDATE_FREQUENCY_MILLIS = 6;
  vm.PIXELS_PER_STRIP = 360;
  vm.exec = function () { return function () {} }; // NOP CLOSURE

  vm.timer;
  vm.controller;

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
    if (!!vm.timer) {
      debug('Killing timer');
      clearTimeout(vm.timer);
      if (vm.isActive) {
        debug('Restarting loop');
        vm.timer = setInterval(function() {
          vm.exec();
        }, vm.UPDATE_FREQUENCY_MILLIS);
      }
    }
  }

  vm.waveRider = function(strips) {
    var waveHeight = vm.PIXELS_PER_STRIP/2;
    var waveWidth = 2;
    var wavePosition = 0;
    return function innerRider() {
      var startIdx = waveHeight+wavePosition;
      for (var i = startIdx, j = waveWidth; i < vm.PIXELS_PER_STRIP &&  i > waveHeight && j > 0; i--, j--) {
          strips.forEach(function (strip) {
            strip.getPixel(i).setColor(0, 255, 0, (j / waveWidth));
          });
      }

      var startIdx = waveHeight-wavePosition;
      for (var i = startIdx, j = waveWidth; i > 0 &&  i < waveHeight && j > 0; i++, j--) {
        strips.forEach(function (strip) {
          strip.getPixel(i).setColor(255, 0, 0, (j / waveWidth));
        });
      }

      strips.forEach(function (strip) {
        strip.getRandomPixel().setColor(0,0,255, 0.1);
      });
      // vm.controller.refresh(strips.map(function (strip) { return strip.getStripData();}));
      vm.controller.emit('data', strips.map(function (strip) { return strip.getStripData();}));

      strips.forEach(function (strip) {
        strip.clear();
      });

      wavePosition = (wavePosition + 1) % waveHeight;
    }
  }

  vm.isActive = false;

  vm.loadFileToMatrix = function () {
    debug(imageFiles[currentFile]);
    getPixels(imageFiles[currentFile], function(err, pixels) {
      getNDColumns(pixels);
    });
  }

  vm.writeImage = function (strips) {
    var columnIter = 0;
    var column = imageColumns[columnIter];
    return function writeColumns () {
      for (var i = 0; i < vm.PIXELS_PER_STRIP; i++) {
        strips.forEach(function (strip) {
          strip.getPixel(i).setColor(column[i][0], column[i][1], column[i][2], 1);
        });
      }
      vm.controller.emit('data', stripsArray.map(function (strip) { return strip.getStripData();}));
      strips.forEach(function (strip) {
        strip.clear();
      });
      columnIter = (columnIter > imageColumns.length - 1) ? 0 : columnItem += 1;
    }
  }


  vm.PixelPusherInstance.on('discover', (controller) => {

    vm.controller = controller;
    vm.isActive = true;

    vm.loadFileToMatrix();

    ['-----------------------------------',
     'Discovered PixelPusher on network: ',
     controller.params.pixelpusher,
     '-----------------------------------'].forEach(line => debug(line));

    // capture the update message sent back from the pp controller
    controller.on('update', () => {
      noise({ updatePeriod: controller.params.pixelpusher.updatePeriod, deltaSequence: controller.params.pixelpusher.deltaSequence, powerTotal: controller.params.pixelpusher.powerTotal });
    }).on('timeout', () => {
      debug('TIMEOUT : PixelPusher at address [' + controller.params.ipAddress + '] with MAC (' + controller.params.macAddress + ') has timed out. Awaiting re-discovery....');
      if (!!vm.timer) clearInterval(vm.timer);
      vm.isActive = false;
      vm.controller = null;
    });

    stripsArray = [];
    for (var i = 0; i < controller.params.pixelpusher.numberStrips; i++) {
      stripsArray.push(new vm.PixelStrip(i, vm.PIXELS_PER_STRIP));
    }
    //var STRIPS_PER_PACKET = controller.params.pixelpusher.stripsPerPkt;
    //var NUM_PACKETS_PER_UPDATE = NUM_STRIPS/STRIPS_PER_PACKET;
    vm.PIXELS_PER_STRIP = controller.params.pixelpusher.pixelsPerStrip;

//    vm.exec = vm.waveRider(stripsArray); // returns closure
    vm.exec = vm.writeImage(stripsArray);

    vm.timer = setInterval(function() {
      vm.exec();
    }, vm.UPDATE_FREQUENCY_MILLIS);

  }).on('error', (err) => {
    vm.isActive = false;
    vm.controller = null;
    debug('PixelPusher Error: ' + err.message);
  });
};

var PixelPusherInterface = new PixelInterface();
//PixelPusherInterface.updateExecutable(oi);
//PixelPusherInterface.updateTiming(100);
currentFile = -1;

// Set the exec pattern

function loadFiles() {
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
  var columnsInc = 0;

  for (var col = 0; col < width; col++) {
    imageColumns[columnsInc] = [];
    for (var row = 0; row < height; row++) {
      imageColumns[columnsInc].push([pixels.get(col, row, 0), pixels.get(col, row, 1), pixels.get(col, row, 2)]);
    }
    columnsInc++;
  }
}


function pickupTeensy () {
  SerialPort.list(function (err, ports) {
    ports.forEach(function(port) {
      if (teensyReg.test(port.comName)) {
        teensy('Found teensy:', port);
        teensyPort = new SerialPort(port.comName, {
  	      parser: SerialPort.parsers.readline('\n')
        });
        teensyPort.on('data', (data) => {
          teensy(data);
          var matches = rpmReg.exec(data);
          if (matches[1]) {
            RPM = matches[1];
            teensy('\t\tRPM', RPM);
          }
          matches = tickReg.exec(data);
          if (matches[1]) {
            teensy('SYNC signal caught.', new Date());
          }
        });
        teensyPort.on('close', () => {
          teensyPort = undefined;
          teensy('Teensy disconnected.');
        });
      }
    });
  });
}

setInterval(function () {
  loadFiles();
  nextFile();
  getPixels(imageFiles[currentFile], function(err, pixels) {
    getNDColumns(pixels);
  });
}, imageChangePeriod);

setInterval(function () {
  if (teensyPort == undefined) {
    teensy('Looking for Teensy..');
    pickupTeensy();
  }
}, teensySearchPeriod);
