"""Abbott FreeStyle HID protocol support (Precision Neo / Optium Neo)."""

import csv
import datetime
import logging
import re

from glucolib import DeviceInvalid, DeviceNotConnected, GlucometerException

try:
    import hid
except ImportError:
    hid = None

ABBOTT_VENDOR_ID = 0x1A61
PRECISION_NEO_PRODUCT_ID = 0x3850

_INIT_COMMAND = 0x01
_INIT_RESPONSE = 0x71
_KEEPALIVE_RESPONSE = 0x22
_UNKNOWN_MESSAGE_RESPONSE = 0x30
_TEXT_MESSAGE_TYPE = 0x60

_TEXT_COMPLETION_RE = re.compile(rb'CMD (?:OK|Fail!)')
_TEXT_REPLY_FORMAT = re.compile(
    rb'^(?P<message>.*)CKSM:(?P<checksum>[0-9A-F]{8})\r\n'
    rb'CMD (?P<status>OK|Fail!)\r\n$',
    re.DOTALL,
)
_MULTIRECORDS_FORMAT = re.compile(
    rb'^(?P<message>.+\r\n)(?P<count>[0-9]+),(?P<checksum>[0-9A-F]{8})\r\n$',
    re.DOTALL,
)

_GLUCOSE_RECORD_TYPE = '7'


class HidSessionError(GlucometerException):
    pass


def _verify_checksum(message, expected_checksum_hex):
    expected_checksum = int(expected_checksum_hex, 16)
    calculated_checksum = sum(message)
    if expected_checksum != calculated_checksum:
        raise HidSessionError(
            'Invalid checksum, expected %d, calculated %d' %
            (expected_checksum, calculated_checksum))


class AbbottHidSession(object):
    def __init__(self, vendor_id, product_id, device_path=None):
        if hid is None:
            raise DeviceNotConnected('hidapi is not installed (pip install hidapi)')

        self._handle = hid.device()
        try:
            if device_path is not None:
                self._handle.open_path(device_path)
            else:
                self._handle.open(vendor_id, product_id)
        except OSError as ex:
            raise DeviceNotConnected(ex)

    def close(self):
        self._handle.close()

    def _write_hid(self, packet):
        report = bytes([0]) + packet
        if len(report) < 65:
            report += bytes(65 - len(report))
        written = self._handle.write(report)
        if written < 0:
            raise HidSessionError('HID write failed (%d)' % written)

    def send_command(self, message_type, command):
        message = bytearray(64)
        message[0] = message_type
        message[1] = len(command)
        message[2:2 + len(command)] = command
        self._write_hid(bytes(message))

    def read_response(self):
        while True:
            usb_packet = bytes(self._handle.read(64, timeout_ms=5000))
            if not usb_packet:
                raise DeviceNotConnected('Device not responding')

            message_type = usb_packet[0]
            if message_type == _KEEPALIVE_RESPONSE:
                continue
            if message_type == _UNKNOWN_MESSAGE_RESPONSE:
                raise DeviceInvalid('Invalid command')

            message_length = usb_packet[1]
            message_content = usb_packet[2:2 + message_length]
            return message_type, bytes(message_content)

    def connect(self):
        self.send_command(_INIT_COMMAND, b'')
        response_type, response = self.read_response()
        if response_type != _INIT_RESPONSE or response != b'\x01':
            raise DeviceInvalid(
                'Unexpected init response %02x:%s' %
                (response_type, response.hex()))

    def _send_text_command_raw(self, command):
        self.send_command(_TEXT_MESSAGE_TYPE, command)

        full_content = b''
        while True:
            message_type, content = self.read_response()
            if message_type != _TEXT_MESSAGE_TYPE:
                raise DeviceInvalid(
                    'Unexpected message type %02x' % message_type)

            full_content += content
            if _TEXT_COMPLETION_RE.search(full_content):
                break

        match = _TEXT_REPLY_FORMAT.search(full_content)
        if not match:
            raise DeviceInvalid(repr(full_content))

        message = match.group('message')
        _verify_checksum(message, match.group('checksum'))

        if match.group('status') != b'OK':
            raise DeviceInvalid(repr(message) or 'Command failed')

        return message

    def query_multirecord(self, command):
        message = self._send_text_command_raw(command)
        if message == b'Log Empty\r\n':
            return iter(())

        match = _MULTIRECORDS_FORMAT.search(message)
        if not match:
            raise DeviceInvalid(repr(message))

        records_raw = match.group('message')
        _verify_checksum(records_raw, match.group('checksum'))
        records_str = records_raw.decode('ascii', 'replace')
        return csv.reader(records_str.split('\r\n'))


class FreeStylePrecisionNeo(object):
    """FreeStyle Precision Neo / Optium Neo (USB HID, 1a61:3850)."""

    def __init__(self, path=None):
        self.logger = logging.getLogger('glucolib.FreeStylePrecisionNeo')
        self._session = AbbottHidSession(
            ABBOTT_VENDOR_ID, PRECISION_NEO_PRODUCT_ID, device_path=path)
        self._session.connect()

    def fetch_data(self):
        readings = []

        for record in self._session.query_multirecord(b'$result?'):
            if not record or record[0] != _GLUCOSE_RECORD_TYPE:
                continue

            value_text = record[8]
            if value_text in ('HI', 'LO'):
                continue

            month = int(record[2])
            day = int(record[3])
            year = int(record[4])
            hour = int(record[5])
            minute = int(record[6])
            value = int(value_text)

            date = datetime.datetime(
                year=2000 + year, month=month, day=day,
                hour=hour, minute=minute)
            readings.append(('G', value, date))

        return readings

    def close(self):
        self._session.close()


def list_hid_devices():
    """Return connected Abbott HID meters as (path, class) tuples."""
    if hid is None:
        return []

    supported = {
        PRECISION_NEO_PRODUCT_ID: FreeStylePrecisionNeo,
    }
    results = []

    for dev in hid.enumerate(ABBOTT_VENDOR_ID):
        cls = supported.get(dev['product_id'])
        if cls is not None:
            results.append((dev['path'], cls))

    return results
