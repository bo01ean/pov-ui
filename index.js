var SerialPort = require('serialport');
var teensyPort;
SerialPort.list(function (err, ports) {
  ports.forEach(function(port) {
    if (/usb.+[0-9]+/.test(port.comName)) {
      console.log('Found:', port);
      teensyPort = new SerialPort(port.comName, {
	parser: SerialPort.parsers.readline('\n')
      });
      teensyPort.on('data', function (data) {
        console.log(data);
      });
    }
  });
});
