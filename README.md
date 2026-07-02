# glukometr

Read and manage glucose meter data via CLI or a local web UI.

## Supported devices

- Abbott Optium Xido (USB serial)
- FreeStyle Precision Neo / Optium Neo (USB HID)

## Requirements

- [Bun](https://bun.sh)
- macOS or Linux (Windows may work with serial/HID drivers installed)

## Web UI

1. Connect your glucose meter via USB.
2. Wake the meter if needed (some models sleep until you interact with them).
3. Run:

```bash
bun install
bun run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

The web UI lets you:

- View device info (serial, firmware, patient name, clock)
- Download and browse readings (glucose, ketones, insulin)
- Set date/time on the device
- Set patient name and ID
- Attempt to delete readings (supported on some meters; FreeStyle Neo does not support this over USB)

## CLI export

For a one-shot HTML report:

```bash
bun run readings
```

This reads all glucose values from the first supported device, writes `readings.html`, and opens it in your default browser.

## License

MIT (original glucolib by Piotr Dobrowolski)
