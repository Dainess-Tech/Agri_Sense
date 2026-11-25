#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>

#include "config.h"

DHT dht(PIN_DHT, DHT_SENSOR_TYPE);
OneWire oneWire(PIN_DS18B20);
DallasTemperature soilTemperature(&oneWire);
WiFiClientSecure mqttClient;
PubSubClient mqtt(mqttClient);

constexpr uint16_t MQTT_BUFFER_SIZE = 1024;

RTC_DATA_ATTR uint32_t sequence = 0;
RTC_DATA_ATTR uint32_t intervalSeconds = INTERVAL_SEC;

const char *mqttStateName(int state) {
  switch (state) {
  case MQTT_CONNECTION_TIMEOUT:
    return "connection timed out";
  case MQTT_CONNECTION_LOST:
    return "connection lost";
  case MQTT_CONNECT_FAILED:
    return "network/TLS connection failed";
  case MQTT_DISCONNECTED:
    return "disconnected";
  case MQTT_CONNECTED:
    return "connected";
  case MQTT_CONNECT_BAD_PROTOCOL:
    return "unsupported protocol";
  case MQTT_CONNECT_BAD_CLIENT_ID:
    return "bad client ID";
  case MQTT_CONNECT_UNAVAILABLE:
    return "broker unavailable";
  case MQTT_CONNECT_BAD_CREDENTIALS:
    return "bad credentials";
  case MQTT_CONNECT_UNAUTHORIZED:
    return "not authorized";
  default:
    return "unknown";
  }
}

uint32_t epochSeconds() {
  time_t now = time(nullptr);
  return now > 1700000000 ? static_cast<uint32_t>(now) : 0;
}

bool connectWiFi(uint32_t timeoutMs = 15000) {
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi already connected; IP: ");
    Serial.print(WiFi.localIP());
    Serial.printf("; RSSI: %d dBm\n", WiFi.RSSI());
    return true;
  }

  Serial.println("Connecting to Wi-Fi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < timeoutMs) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected; IP: ");
    Serial.print(WiFi.localIP());
    Serial.printf("; RSSI: %d dBm\n", WiFi.RSSI());
    configTzTime("UTC0", "pool.ntp.org", "time.google.com");
    return true;
  }
  Serial.printf("Wi-Fi connection timed out; status=%d\n",
                static_cast<int>(WiFi.status()));
  return false;
}

bool connectMqtt(uint32_t timeoutMs = 10000) {
  if (mqtt.connected()) {
    return true;
  }

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setInsecure();
  Serial.printf("Connecting to MQTT broker %s:%u...\n", MQTT_HOST,
                static_cast<unsigned>(MQTT_PORT));

  char clientId[64];
  snprintf(clientId, sizeof(clientId), "agrisense-%s-%lu", DEVICE_ID, millis());
  uint32_t started = millis();
  while (!mqtt.connected() && millis() - started < timeoutMs) {
    if (mqtt.connect(clientId, MQTT_USERNAME, MQTT_PASSWORD)) {
      Serial.println("MQTT connected");
      return true;
    }
    if (!mqtt.connected()) {
      delay(250);
    }
  }

  int state = mqtt.state();
  Serial.printf("MQTT connection failed; state=%d (%s)\n", state,
                mqttStateName(state));
  return false;
}

float readSoilMoisture() {
  long total = 0;
  for (int i = 0; i < 10; i++) {
    total += analogRead(PIN_SOIL_MOISTURE);
    delay(10);
  }

  int raw = total / 10;
  if (raw < 100 || raw > 4000) {
    return NAN;
  }

  float percentage =
      100.0f * (MOISTURE_RAW_DRY - raw) /
      static_cast<float>(MOISTURE_RAW_DRY - MOISTURE_RAW_WET);
  return constrain(percentage, 0.0f, 100.0f);
}

float readSoilTemperature() {
  soilTemperature.requestTemperatures();
  float temperature = soilTemperature.getTempCByIndex(0);
  if (temperature == DEVICE_DISCONNECTED_C || temperature == 85.0f) {
    return NAN;
  }
  return temperature;
}

float readSoilPh() {
#ifdef PIN_SOIL_PH
  int raw = analogRead(PIN_SOIL_PH);
  if (raw < 50) {
    return NAN;
  }

  float voltage = raw * 3.3f / 4095.0f;
  float ph = 7.0f + (2.5f - voltage) * 3.5f;
  return ph >= 0.0f && ph <= 14.0f ? ph : NAN;
#else
  return NAN;
#endif
}

void addReading(JsonArray readings, const char *type, float value) {
  JsonObject reading = readings.add<JsonObject>();
  reading["type"] = type;
  if (isnan(value)) {
    reading["value"] = nullptr;
  } else {
    reading["value"] = roundf(value * 100.0f) / 100.0f;
  }
}

bool publishReading() {
  JsonDocument document;
  document["messageId"] =
      String(DEVICE_ID) + "-" + String(++sequence);
  uint32_t measuredAt = epochSeconds();
  if (measuredAt != 0) {
    document["measuredAt"] = measuredAt;
  }
  document["firmware"] = FW_VERSION;

  JsonArray readings = document["readings"].to<JsonArray>();
  addReading(readings, "soil_moisture", readSoilMoisture());
  addReading(readings, "air_temperature", dht.readTemperature());
  addReading(readings, "air_humidity", dht.readHumidity());
  addReading(readings, "soil_temperature", readSoilTemperature());

#ifdef PIN_SOIL_PH
  addReading(readings, "soil_ph", readSoilPh());
#endif

  char payload[768];
  size_t payloadLength =
      serializeJson(document, payload, sizeof(payload));
  if (payloadLength == 0) {
    return false;
  }

  bool published = mqtt.publish(MQTT_TOPIC, payload, true);
  if (published) {
    Serial.printf("Published %u bytes to %s\n", payloadLength, MQTT_TOPIC);
  } else {
    int state = mqtt.state();
    Serial.printf("MQTT publish failed; payload=%u bytes, state=%d (%s)\n",
                  static_cast<unsigned>(payloadLength), state,
                  mqttStateName(state));
  }
  return published;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nAgriSense boot");
  analogReadResolution(12);
  dht.begin();
  soilTemperature.begin();

  bool mqttBufferReady = mqtt.setBufferSize(MQTT_BUFFER_SIZE);
  if (!mqttBufferReady) {
    Serial.println("MQTT buffer allocation failed; skipping MQTT");
  }

  if (connectWiFi()) {
    if (mqttBufferReady && connectMqtt()) {
      publishReading();
      mqtt.loop();
    }
  } else {
    Serial.println("Wi-Fi connection failed");
  }

  WiFi.disconnect(true);
  mqtt.disconnect();
  Serial.printf("Sequence: %lu, next interval: %lu seconds\n",
                sequence, intervalSeconds);
  Serial.flush();
  esp_deep_sleep((uint64_t)intervalSeconds * 1000000ULL);
}

void loop() {}
