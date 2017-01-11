var SerialPort = require('serialport');

var PixelPusher = require('heroic-pixel-pusher');
PixelPusherInst = new PixelPusher;


console.log(PixelPusher);


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
