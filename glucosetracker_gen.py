#!/usr/bin/env python3
'''
This script generates CSV compatible with https://www.glucosetracker.net/ app
from data stored on Abbott Optium Xido, FreeStyle Precision Neo / Optium Neo,
or Diagnosis Diagnostic Gold device.

You may consider it an example of glucolib.
'''

import sys

try:
    import glucolib
except ImportError as exc:
    if exc.name in ('serial', 'hid'):
        print('Required dependency is not installed for this Python.',
              file=sys.stderr)
        print('Run: ./glucosetracker_gen > readings.csv', file=sys.stderr)
        print('Or:  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt',
              file=sys.stderr)
    else:
        print('Import error:', exc, file=sys.stderr)
    sys.exit(1)

devices = glucolib.list_devices()
if not devices:
    print("*** No supported devices found", file=sys.stderr)
    sys.exit(1)

try:
    g = devices[0][1](devices[0][0])
    readings = g.fetch_data()
    print('"Value","Category","Date","Time","Notes"')
    for type, value, date in readings:
        if type == 'G':
            print('"%d","","%s","%s",""' % (value, date.strftime('%m/%d/%Y'),
                                            date.strftime('%I:%M %p')))

except (glucolib.DeviceInvalid, glucolib.DeviceNotConnected) as ex:
    print("*** Make sure your device is connected properly and "
          "not sleeping (you may want to replug the connector in some cases)",
          file=sys.stderr)
    print("*** Captured exception:", ex, file=sys.stderr)
    sys.exit(1)
