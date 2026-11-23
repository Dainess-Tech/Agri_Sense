// Copy this file to config.h and fill in your values. config.h is git-ignored.
// The Device ID and API key are shown once in AgriSense → Devices → Register device.
#pragma once

#define WIFI_SSID        "your-wifi-name"
#define WIFI_PASSWORD    "your-wifi-password"

// Use https:// in production. For local testing on your LAN use your laptop IP, e.g. "http://192.168.1.20:3000"
#define AGRISENSE_HOST   "https://your-agrisense-domain"
#define DEVICE_ID        "as-xxxxxxxx"
#define DEVICE_API_KEY   "ask_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
#define INTERVAL_SEC     900   // overwritten by the server's intervalSec in each response

// Pins
#define PIN_SOIL_MOISTURE  34   // capacitive sensor analog out (ADC1 pin!)
#define PIN_DHT22          4
#define PIN_DS18B20        5
#define PIN_SOIL_PH        35   // optional, analog (ADC1)

// Soil moisture calibration: raw ADC in air (dry) and in water (wet)
#define MOISTURE_RAW_DRY   3200
#define MOISTURE_RAW_WET   1300
