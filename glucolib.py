"""
Copyright (c) 2014 Piotr Dobrowolski

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

import serial
from serial.tools.list_ports import comports
import datetime
import locale
import struct
import logging
import time

reading_types = {
    'G': 'Glucose',
    }


class GlucometerException(Exception): pass
class DeviceNotConnected(GlucometerException): pass
class DeviceInvalid(GlucometerException): pass


def hexdump(data):
    return ' '.join(['%02X' % n for n in data])


def _read_byte(ser):
    data = ser.read(1)
    if not data:
        raise DeviceNotConnected('Device not responding')
    return data[0]


# Diagnosis Diagnotic GOLD
class DiagnosticGold(object):
    def __init__(self, path='/dev/ttyUSB0'):
        self.logger = logging.getLogger('glucolib.DiagnosisGold')
        try:
            self.ser = serial.Serial(path, 38400, timeout=1,
                                     inter_byte_timeout=0.1)
        except Exception as ex:
            raise DeviceNotConnected(ex)

    def fetch_data(self, timeout=5):
        end_time = time.time() + timeout

        while True:
            try:
                d = self.read()
                if d:
                    if d[0] == 0x10:
                        break
            except DeviceNotConnected as exc:
                self.logger.debug('No device found... (%s)', exc)

                if end_time < time.time():
                    raise

        self.logger.debug('Device found, doing handshake')
        self.write(bytearray([0x10, 0x40]))
        (_, _, readings_count, id_code, uid) = struct.unpack('BBB3s16s',
                                                             self.read())

        readings = []

        while True:
            self.write(bytearray([0x10, 0x60]))
            data = self.read()

            if len(data) < 17:
                self.logger.debug('Reading finished')
                break

            (_, _, date_year, date_month, date_day, date_hour, date_minute,
                _, value) = struct.unpack('B'*9, data[0:9])

            date = datetime.datetime(day=date_day, month=date_month,
                                     year=2000+date_year,
                                     hour=date_hour, minute=date_minute)
            readings.append(('G', value, date))

        return readings

    def read(self):
        start = self.ser.read(1)
        if not start or start == b'\x00':
            raise DeviceNotConnected('Device not responding')

        elif start[0] != 0x53:
            raise DeviceInvalid('Start byte invalid (%r)' % start)

        direction = _read_byte(self.ser)
        if direction != 0x20:
            raise DeviceInvalid('Direction byte invalid (??)')

        data_length = _read_byte(self.ser)
        data = bytearray(self.ser.read(data_length - 2))

        chksum = _read_byte(self.ser)
        if chksum != self.checksum(data):
            raise DeviceInvalid('Checksum invalid')

        end = _read_byte(self.ser)
        if end != 0xaa:
            raise DeviceInvalid('End byte invalid')

        self.logger.debug('<-- %s', hexdump(data))
        return data

    def checksum(self, data):
        chksum = 0

        for b in data:
            chksum ^= b

        return chksum

    def write(self, data):
        buf = bytearray([0x53, 0x10, len(data) + 2]) + data + \
            bytearray([self.checksum(data), 0xaa])

        self.logger.debug('<-- %s // %s', hexdump(data), hexdump(buf))
        self.ser.write(buf)

    def close(self):
        if self.ser:
            self.ser.close()


# Abbott Optium Xido glucometer
class OptiumXido(object):
    def __init__(self, path='/dev/ttyUSB0'):
        try:
            self.ser = serial.Serial(path, 19200, timeout=0.1,
                                     inter_byte_timeout=0.1)
        except Exception as ex:
            raise DeviceNotConnected(ex)

    def fetch_data(self):
        """Returns glucometer readings in form of list of tuples:
            [(value, readingType, datetime)]

            value
                saved measurement

            readingType
                str('G') - Glucose

            datetime
                datetime.datetime object containing date of measurement
        """

        resp = self.command('$xmem')

        # First line of response is empty, we check it to distinguish invalid
        # devices
        if resp[0] != '':
            raise DeviceInvalid()

        readings_count = resp[4]
        raw_dataset = resp[5:5 + int(readings_count)]
        readings = []

        for reading in raw_dataset:
            value, month, day, year, time, reading_type, _ = reading.split()

            saved = locale.setlocale(locale.LC_ALL, 'C')
            try:
                parsed_datetime = datetime.datetime.strptime(
                    ' '.join([month, day, year, time]), '%b %d %Y %H:%M')
            finally:
                locale.setlocale(locale.LC_ALL, saved)

            readings.append((reading_type, int(value), parsed_datetime))

        return readings

    def device_info(self):
        """Return dict containing different system-specific values, including:

            S/N
                Device serial number

            Ver
                Software version

            Clock
                Current date and time set on device

        """
        resp = self.command('$colq')

        if resp[-1] != 'CMD OK':
            raise DeviceInvalid()

        return dict((n.partition(':')[0], n.split('\t')[1:])
                    for n in resp[:-1])

    def close(self):
        if self.ser:
            self.ser.close()

    def command(self, cmd):
        self.ser.write((cmd + "\r\n").encode('ascii'))

        # FIXME readlines fails when packet is split into multiple buffers (eg.
        # in $colq response)
        #time.sleep(1)

        resp = [l.decode('ascii').strip() for l in self.ser.readlines()]

        # If no data received then device is not connected or sleeping (data
        # cable connector replug is needed)
        if not resp:
            raise DeviceNotConnected('Device not responding')

        return resp


supported_devices = {
    ('1a61', '3420'): OptiumXido,
    ('10c4', 'ea60'): DiagnosticGold,
    }


def list_devices():
    """Return list of tuples depicting connected devices found and apropriate
    classes to use for communication."""
    results = list()

    for port, desc, hwids in comports():
        for (pid, vid), cls in supported_devices.items():
            if pid in hwids.lower() and vid in hwids.lower():
                # FIXME yield?
                results.append((port, cls))
                break

    try:
        from abbott_hid import list_hid_devices
        results.extend(list_hid_devices())
    except ImportError:
        pass

    return results
