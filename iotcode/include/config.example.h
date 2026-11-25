#pragma once

#define WIFI_SSID "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// HiveMQ public Cloud cluster example:
// HiveMQ MQTT broker host and port
#define MQTT_HOST "your-cluster.s2.eu.hivemq.cloud"
#define MQTT_PORT 8883
#define MQTT_USERNAME "your-mqtt-username"
#define MQTT_PASSWORD "your-mqtt-password"

// Topic and device identity
#define DEVICE_ID "as-xxxxxxxx"
#define MQTT_TOPIC "agrisense/devices/as-xxxxxxxx/readings"

#define FW_VERSION "1.0.0"
#define INTERVAL_SEC 900

// ESP32 DevKit pins
#define PIN_SOIL_MOISTURE 34
#define PIN_DHT 4
#define DHT_SENSOR_TYPE DHT11
#define PIN_DS18B20 5
// Optional: remove the comment and choose an ADC1 pin to enable an analog pH sensor
// #define PIN_SOIL_PH 35

#define MOISTURE_RAW_DRY 3200
#define MOISTURE_RAW_WET 1300
