var SerialPort = require('serialport');
var PixelPusher = require('heroic-pixel-pusher');
var getPixels = require("get-pixels");
var fs = require('fs');
var q = require('q');

var files;
var debug;
var noise;
var teensy;

[files, debug, noise, teensy].forEach((debugMode) => {
  debugMode = function(){};
});

if (process.env.ENVIRONMENT == 'dev') {
  debug = require('ndebug')('info');
  noise = require('ndebug')('noise');
  teensy = require('ndebug')('teensy');
  files = require('ndebug')('files');
}

var imageFiles = [];
var currentFile = 0;
var teensyPort;

var RPM;
var rpmReg = new RegExp("\(smoothed\): ([0-9.]+)", "g");
var tickReg = new RegExp("TICK", "g");
var teensyReg = new RegExp("usb.+[0-9]+");
var teensySearchPeriod = 1000;

var imageChangePeriod = 15000;

var imageColumns = [];
var stripsArray = [];


readFilesFromDir();
nextFile();
loadFile().then(() => {
  debug('loadFile() ready');
});


var PixelInterface = function () {

  var vm = this;

  vm.PixelStrip = PixelPusher.PixelStrip;
  vm.PixelPusherInstance = new PixelPusher(); // will start listener.

  vm.UPDATE_FREQUENCY_MILLIS = 10;
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
    var waveWidth = 2;
    var waveHeight = vm.PIXELS_PER_STRIP / waveWidth;
    var wavePosition = 0;
    var startIdx;
    debug('init: waveRider');
    return function innerRider() {
      //debug('Call:', wavePosition);
      startIdx = waveHeight + wavePosition;
      for (var i = startIdx, j = waveWidth; i < vm.PIXELS_PER_STRIP &&  i > waveHeight && j > 0; i--, j--) {
          strips.forEach(function (strip) {
            strip.getPixel(i).setColor(255, 0, 255, (j / waveWidth) / 1.0);
          });
      }

      startIdx = waveHeight - wavePosition;
      for (var i = startIdx, j = waveWidth; i > 0 &&  i < waveHeight && j > 0; i++, j--) {
        strips.forEach(function (strip) {
          strip.getPixel(i).setColor(255, 0, 255, (j / waveWidth) / 1.0);
        });
      }

      strips.forEach(function (strip) {
        strip.getRandomPixel().setColor(0,0,255, 0.1);
      });
      //vm.controller.refresh(strips.map(function (strip) { return strip.getStripData();}));
      vm.controller.emit('data', strips.map(function (strip) { return strip.getStripData();}));

      strips.forEach(function (strip) {
        strip.clear();
      });

      wavePosition = (wavePosition + 1) % waveHeight;
    }
  }

  vm.isActive = false;

  vm.writeImage = function (strips) {
    var columnIter = 0;
    var column = [];
    return function writeColumns () {

      columnIter = (columnIter >= imageColumns.length - 1) ? 0 : columnIter += 1;
      //column = imageColumns[columnIter];

      //debug('columnIter', columnIter, 'imageColumns.length', imageColumns.length, 'columnIter[0]', imageColumns[columnIter][0]);

//      column.forEach((col,id) => { console.log(column, col);})
/*
      for (var i = 0; i < vm.PIXELS_PER_STRIP; i++) {
        strips.forEach(function (strip, stripIndex) {
          //debug('pixel', i, 'strip', stripIndex, column[i][0], column[i][1], column[i][2]);
          strip.getPixel(i).setColor(column[i][0], column[i][1], column[i][2], 1.0);
        });
      }
      */

      strips.forEach(function (strip) {
        strip.getRandomPixel().setColor(0, 0, 255, 0.1);
      });

      vm.controller.emit('data', strips.map(function (strip) { return strip.getStripData();}));

      strips.forEach(function (strip) {
        strip.clear();
      });

      //debug(imageColumns[columnIter][0], imageColumns.length, columnIter);
      columnIter = (columnIter + 1) % imageColumns.length;
    }
  }


  vm.PixelPusherInstance.on('discover', (controller) => {

    vm.controller = controller;
    vm.isActive = true;

    ['-----------------------------------',
     'Discovered PixelPusher on network: ',
     controller.params.pixelpusher,
     '-----------------------------------'].forEach(line => noise(line));

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
    for (var i = 0; i < 1; i++) {
      stripsArray.push(new vm.PixelStrip(i, vm.PIXELS_PER_STRIP));
    }
    //var STRIPS_PER_PACKET = controller.params.pixelpusher.stripsPerPkt;
    //var NUM_PACKETS_PER_UPDATE = NUM_STRIPS/STRIPS_PER_PACKET;
    vm.PIXELS_PER_STRIP = controller.params.pixelpusher.pixelsPerStrip;

    vm.exec = vm.waveRider(stripsArray); // returns closure
//    vm.exec = vm.writeImage(stripsArray);

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
      imageColumns[col].push([pixels.get(col, row, 0), pixels.get(col, row, 1), pixels.get(col, row, 2)]);
    }
  }
}

function loadFile() {
  var deferred = q.defer();
  debug('imageFiles[currentFile]', imageFiles[currentFile]);
  getPixels(imageFiles[currentFile], function(err, pixels) {
    getNDColumns(pixels);
    deferred.resolve();
  });
  return deferred.promise;
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
  //readFilesFromDir();
  //nextFile();
  //loadFile().then(() => {
  //  debug('Image ready.');
  //});
}, imageChangePeriod);

setInterval(function () {
  if (teensyPort == undefined) {
    teensy('Looking for Teensy..');
    pickupTeensy();
  }
}, teensySearchPeriod);
