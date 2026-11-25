# AgriSense IoTCode (PlatformIO + HiveMQ MQTT)

This ESP32 sketch reads the sensors shown in `src/app/(app)/devices/images`
and publishes AgriSense readings to HiveMQ over MQTT.
Copy `include/config.example.h` to `include/config.h`, then set the Wi-Fi,
broker, MQTT credentials and device values.

`include/config.h` is ignored by Git.

## Requirements

- PlatformIO Core or the PlatformIO IDE extension
- ESP32 Dev Module
- HiveMQ Cloud cluster or another MQTT broker with TLS
- DHT11 temperature/humidity module (the blue module shown in the photos)
- Two-prong analog soil-moisture probe/module
- DS18B20 soil probe
- 4.7 kOhm resistor for the DS18B20 data-line pull-up
- Optional soil pH probe (not shown in the photos)

## Wiring (ESP32 DevKit)

Connect all sensor grounds to ESP32 GND and power the sensor modules from 3.3 V.
The images show the parts but not their pin labels, so confirm each module's
VCC/GND/DATA or AO labels before powering it.

| Part | ESP32 connection |
| --- | --- |
| DHT11 module: DATA/S | GPIO 4 |
| Soil-moisture module: analog AO | GPIO 34 |
| DS18B20: DATA | GPIO 5 |
| DS18B20: VCC/GND | 3.3 V / GND |
| 4.7 kOhm pull-up resistor | Between DS18B20 DATA and 3.3 V |

The resistor's color bands are not readable in the photos; check its value
before using it as the DS18B20 pull-up.

Use the analog output (AO) from the soil-moisture module, not its digital
threshold output (DO). GPIO 34 is an ADC1 input and remains usable while
Wi-Fi is active. The sketch converts its raw value to a percentage using
`MOISTURE_RAW_DRY` and `MOISTURE_RAW_WET`; calibrate these values for your
probe and soil. Do not connect a sensor output that can exceed 3.3 V to an
ESP32 GPIO.

## Build and upload

```bash
cd iotcode
pio run
pio run --target upload
pio device monitor
```

The serial monitor runs at 115200 baud. On each boot, the sketch prints Wi-Fi
connection status and IP address, then an MQTT connection status or error code.
It goes to deep sleep after the attempt; press the board's reset button to run
another attempt immediately.

### Upload troubleshooting

Before uploading, run `pio device list` and confirm that the ESP32 appears as a
serial port. On Linux it is usually `/dev/ttyUSB0` or `/dev/ttyACM0`; on
Windows it appears as a `COM` port. If no such port appears, use a USB data
cable, check the board's USB connection and serial driver, and make sure the
USB device is passed through to the environment running PlatformIO (for
example, a container or remote development session).

If PlatformIO does not select the board automatically, pass its detected port:

```bash
pio run --target upload --upload-port /dev/ttyUSB0
```

Replace the example with the port reported by `pio device list` (for example,
`COM3` on Windows). If upload stalls at `Connecting...`, hold the ESP32's
`BOOT` button until writing starts, then release it.

## MQTT payload

The sketch publishes retained JSON to `MQTT_TOPIC`. The MQTT client buffer is
set to 1024 bytes so the JSON and topic fit; the library's 256-byte default is
too small for this message. For example:

```json
{
  "messageId": "as-xxxxxxxx-42",
  "measuredAt": 1767000000,
  "firmware": "1.0.0",
  "readings": [
    { "type": "soil_moisture", "value": 31.4 },
    { "type": "air_temperature", "value": 24.2 },
    { "type": "air_humidity", "value": 61 },
    { "type": "soil_temperature", "value": 20.1 }
  ]
}
```

HiveMQ does not ingest MQTT directly into AgriSense. An authenticated broker
consumer or bridge must subscribe to `MQTT_TOPIC` and forward each payload to:

```text
POST /api/v1/iot/readings
X-Device-Id: <DEVICE_ID>
Authorization: Bearer <device API key>
Content-Type: application/json
```

The bridge must preserve `messageId` and `measuredAt` for server
deduplication and timestamps.
