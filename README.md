# glukometr

Read glucose meter data and open an HTML report in your browser.

## Supported devices

- Abbott Optium Xido (USB serial)
- FreeStyle Precision Neo / Optium Neo (USB HID)
- Diagnosis Diagnostic Gold (USB serial)

## Requirements

- [Bun](https://bun.sh)
- macOS or Linux (Windows may work with serial/HID drivers installed)

## Usage

1. Connect your glucose meter via USB.
2. Wake the meter if needed (some models sleep until you interact with them).
3. Run:

```bash
bun install
bun run readings
```

The script reads all glucose values from the first supported device it finds, writes `readings.html`, and opens it in your default browser.

## License

MIT (original glucolib by Piotr Dobrowolski)
