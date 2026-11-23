/*
 * AgriSense ESP32 monitoring node — firmware v1.0
 * Sensors: capacitive soil moisture, DHT22 (air temp/humidity), DS18B20 (soil temp), optional pH probe.
 * Transport: HTTPS/HTTP POST JSON to /api/v1/iot/readings (see docs/API.md).
 *
 * Features required by the SRS:
 *  - device identification (X-Device-Id) + device API key (independent of user accounts)
 *  - timestamps via NTP (epoch seconds); server falls back to receipt time if clock not synced
 *  - basic validation: NaN / disconnected sensors are sent as null and never as fake values
 *  - unique messageId per measurement → server de-duplicates retries (idempotent)
 *  - ring buffer of unsent readings in RTC memory; uploaded in batches after reconnection
 *  - configurable interval: server returns intervalSec in every response
 *
 * Libraries (Arduino Library Manager): ArduinoJson (v7), DHT sensor library (Adafruit),
 * OneWire, DallasTemperature.  Board: "ESP32 Dev Module".
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>
#include "config.h"

#define FW_VERSION "1.0.0"
#define BUFFER_SIZE 48          // ~12 h of 15-minute readings retained while offline

DHT dht(PIN_DHT22, DHT22);
OneWire oneWire(PIN_DS18B20);
DallasTemperature soilTemp(&oneWire);

struct Sample {
  uint32_t seq;
  uint32_t ts;          // epoch seconds (0 if clock not synced)
  float moisture, airT, airH, soilT, ph;  // NAN = not available / sensor fault
};

RTC_DATA_ATTR Sample buffer[BUFFER_SIZE];
RTC_DATA_ATTR int bufCount = 0;
RTC_DATA_ATTR uint32_t seqCounter = 0;
RTC_DATA_ATTR uint32_t intervalSec = INTERVAL_SEC;

bool connectWiFi(uint32_t timeoutMs = 15000) {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) delay(250);
  return WiFi.status() == WL_CONNECTED;
}

uint32_t nowEpoch() {
  time_t t = time(nullptr);
  return t > 1700000000 ? (uint32_t)t : 0;  // 0 → let the server use receipt time
}

float readMoisturePct() {
  long acc = 0;
  for (int i = 0; i < 10; i++) { acc += analogRead(PIN_SOIL_MOISTURE); delay(10); }
  int raw = acc / 10;
  if (raw < 100 || raw > 4000) return NAN;  // disconnected / shorted probe → fault, NOT dry soil
  float pct = 100.0f * (MOISTURE_RAW_DRY - raw) / (float)(MOISTURE_RAW_DRY - MOISTURE_RAW_WET);
  return constrain(pct, 0.0f, 100.0f);
}

float readSoilTemp() {
  soilTemp.requestTemperatures();
  float t = soilTemp.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C || t == 85.0f) return NAN;  // -127 disconnected, 85 power-on reset
  return t;
}

float readPh() {
#ifdef PIN_SOIL_PH
  int raw = analogRead(PIN_SOIL_PH);
  if (raw < 50) return NAN;
  float volts = raw * 3.3f / 4095.0f;
  float ph = 7.0f + (2.5f - volts) * 3.5f;   // replace with your probe's calibration
  return (ph < 0 || ph > 14) ? NAN : ph;
#else
  return NAN;
#endif
}

void takeSample() {
  Sample s;
  s.seq = ++seqCounter;
  s.ts = nowEpoch();
  s.moisture = readMoisturePct();
  s.airT = dht.readTemperature();
  s.airH = dht.readHumidity();
  s.soilT = readSoilTemp();
  s.ph = readPh();
  if (bufCount == BUFFER_SIZE) {               // buffer full: drop oldest
    memmove(&buffer[0], &buffer[1], sizeof(Sample) * (BUFFER_SIZE - 1));
    bufCount--;
  }
  buffer[bufCount++] = s;
}

void addReading(JsonArray arr, const char* type, float v) {
  JsonObject o = arr.add<JsonObject>();
  o["type"] = type;
  if (isnan(v)) o["value"] = nullptr; else o["value"] = roundf(v * 100) / 100.0f;
}

bool uploadBuffer() {
  if (bufCount == 0) return true;
  JsonDocument doc;
  doc["firmware"] = FW_VERSION;
  JsonArray msgs = doc["messages"].to<JsonArray>();
  for (int i = 0; i < bufCount; i++) {
    JsonObject m = msgs.add<JsonObject>();
    char id[48];
    snprintf(id, sizeof(id), "%s-%lu", DEVICE_ID, (unsigned long)buffer[i].seq);
    m["messageId"] = id;                         // stable id → retries are de-duplicated
    if (buffer[i].ts) m["measuredAt"] = buffer[i].ts;
    JsonArray r = m["readings"].to<JsonArray>();
    addReading(r, "soil_moisture", buffer[i].moisture);
    addReading(r, "air_temperature", buffer[i].airT);
    addReading(r, "air_humidity", buffer[i].airH);
    addReading(r, "soil_temperature", buffer[i].soilT);
    if (!isnan(buffer[i].ph)) addReading(r, "soil_ph", buffer[i].ph);
  }
  String body;
  serializeJson(doc, body);

  HTTPClient http;
  WiFiClientSecure secure;
  String url = String(AGRISENSE_HOST) + "/api/v1/iot/readings";
  if (url.startsWith("https")) { secure.setInsecure(); /* TODO: pin your CA certificate */ http.begin(secure, url); }
  else http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("Authorization", String("Bearer ") + DEVICE_API_KEY);
  http.setTimeout(15000);

  for (int attempt = 0; attempt < 3; attempt++) {      // retry with backoff
    int code = http.POST(body);
    if (code == 200 || code == 201) {
      JsonDocument res;
      if (!deserializeJson(res, http.getString()) && res["intervalSec"].is<int>()) intervalSec = res["intervalSec"];
      http.end();
      bufCount = 0;
      return true;
    }
    if (code == 401 || code == 403 || code == 422) { Serial.printf("Rejected (%d) — check credentials/payload\n", code); break; }
    delay(2000 * (attempt + 1));
  }
  http.end();
  return false;
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  dht.begin();
  soilTemp.begin();
  if (connectWiFi()) configTime(0, 0, "pool.ntp.org", "time.google.com");
  delay(1500);
  takeSample();
  if (connectWiFi()) uploadBuffer();
  Serial.printf("Buffered: %d, sleeping %lu s\n", bufCount, (unsigned long)intervalSec);
  WiFi.disconnect(true);
  esp_sleep_enable_timer_wakeup((uint64_t)intervalSec * 1000000ULL);
  esp_deep_sleep_start();   // RTC memory keeps the buffer across deep sleep
}

void loop() {}
