var SerialPort = require('serialport');
var PixelPusher = require('heroic-pixel-pusher');
var debug = require('boolean-debug')('info');
var noise = require('boolean-debug')('noise');

var PixelInterface = function () {

  var vm = this;

  vm.PixelStrip = PixelPusher.PixelStrip;
  vm.PixelPusherInstance = new PixelPusher(); // will start listener.

  vm.UPDATE_FREQUENCY_MILLIS = 100;
  vm.PIXELS_PER_STRIP = 1;
  vm.strip = new vm.PixelStrip(0, vm.PIXELS_PER_STRIP);
  vm.exec = function () {}; // NOP
  vm.timer = null;

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
    }

    debug('Restarting loop');
    vm.timer = setInterval(function() {
      vm.exec();
    }, vm.UPDATE_FREQUENCY_MILLIS);

  }

  vm.updateStrip = function (pixels) {
    vm.PIXELS_PER_STRIP = pixels;
    vm.strip = new vm.PixelStrip(0, vm.PIXELS_PER_STRIP);
  }

  vm.PixelPusherInstance.on('discover', (controller) => {

    var info = ['-----------------------------------',
                'Discovered PixelPusher on network: ',
                controller.params.pixelpusher,
                '-----------------------------------'];

    info.forEach(line => debug(line));

    // capture the update message sent back from the pp controller
    controller.on('update', () => {
      noise({ updatePeriod: this.params.pixelpusher.updatePeriod, deltaSequence: this.params.pixelpusher.deltaSequence, powerTotal: this.params.pixelpusher.powerTotal });
    }).on('timeout', () => {
      debug('TIMEOUT : PixelPusher at address [' + controller.params.ipAddress + '] with MAC (' + controller.params.macAddress + ') has timed out. Awaiting re-discovery....');
      if (!!vm.timer) clearInterval(timer);
    });

    var NUM_STRIPS = controller.params.pixelpusher.numberStrips;
    var STRIPS_PER_PACKET = controller.params.pixelpusher.stripsPerPkt;
    var NUM_PACKETS_PER_UPDATE = NUM_STRIPS/STRIPS_PER_PACKET;
    vm.PIXELS_PER_STRIP = controller.params.pixelpusher.pixelsPerStrip;

    var waveHeight = vm.PIXELS_PER_STRIP/2;
    var waveWidth = 2;
    var wavePosition = 0;
    vm.strip = new vm.PixelStrip(0, vm.PIXELS_PER_STRIP);


    vm.timer = setInterval(function() {
      vm.exec();
    }, vm.UPDATE_FREQUENCY_MILLIS);

  }).on('error', (err) => {
    debug('PixelPusher Error: ' + err.message);
  });
};


var PixelPusherInterface = new PixelInterface();

function oi() { debug('executable says oi!');}

PixelPusherInterface.updateExecutable(oi);
PixelPusherInterface.updateTiming(1);

// Set the exec pattern


var fs = require('fs');
var imageFiles;
var currentFile = 0;
var teensyPort;

var RPM;
var rpmReg = new RegExp("\(smoothed\): ([0-9.]+)", "g");
var tickReg = new RegExp("TICK", "g");

function loadFiles() {
  var items = fs.readdirSync('./data/');
  console.log(items);
  imageFiles = items.filter(item => {
    return /\.(jpg|jpeg|png)$/i.test(item);
  });
  imageFiles.forEach( (item, i) => {
    items[i] = './data/' + items[i];
  });
}

function nextFile() {
  currentFile++;
  currentFile = (currentFile > imageFiles.length) ? 0 : currentFile;
}

function previousFile() {
  currentFile--;
  currentFile = (currentFile < 0) ? imageFiles.length : currentFile;
}

function pickupTeensy () {
  SerialPort.list(function (err, ports) {
    ports.forEach(function(port) {
      if (/usb.+[0-9]+/.test(port.comName)) {
        console.log('Found teensy:', port);
        teensyPort = new SerialPort(port.comName, {
  	       parser: SerialPort.parsers.readline('\n')
        });
        teensyPort.on('data', (data) => {
          console.log(data);
          var matches = rpmReg.exec(data);
          if (matches[1]) {
            RPM = matches[1];
            console.log('\t\tRPM', RPM);
          }
          matches = tickReg.exec(data);
          if (matches[1]) {
            console.log('SYNC signal caught.', new Date());
          }
        });
        teensyPort.on('close', () => {
          teensyPort = undefined;
          console.log('Teensy disconnected.');
        });
      }
    });
  });
}

setInterval(function () {
  if (teensyPort == undefined) {
    console.log('Looking for Teensy..');
    pickupTeensy();
  }
}, 1000);
