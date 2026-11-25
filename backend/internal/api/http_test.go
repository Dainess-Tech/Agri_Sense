package api

import (
	"testing"
	"time"
)

func TestDateOnly(t *testing.T) {
	valid := []string{"2026-11-24", "2024-02-29"}
	for _, s := range valid {
		if _, ok := dateOnly(s); !ok {
			t.Fatalf("expected %s to be valid", s)
		}
	}
	for _, s := range []string{"2026-13-45", "2026-02-29", "24-11-2026"} {
		if _, ok := dateOnly(s); ok {
			t.Fatalf("expected %s to be invalid", s)
		}
	}
}

func TestValidateSensor(t *testing.T) {
	unit, quality, _, ok := validateSensor("soil_moisture", 31.5)
	if !ok || unit != "%" || quality != "valid" {
		t.Fatalf("unexpected valid sensor result: %s %s %v", unit, quality, ok)
	}
	_, quality, _, ok = validateSensor("soil_moisture", 0)
	if !ok || quality != "suspect" {
		t.Fatalf("expected sentinel to be suspect")
	}
	if _, _, _, ok := validateSensor("unknown", 1); ok {
		t.Fatalf("unknown sensor must be rejected")
	}
}

func TestCheckCropRanges(t *testing.T) {
	current := map[string]interface{}{"baseYieldMin": float64(2), "baseYieldMax": float64(6)}
	if err := checkCropRanges(current, map[string]interface{}{"baseYieldMin": float64(7)}); err == nil {
		t.Fatal("expected invalid crop range to be rejected")
	}
	if err := checkCropRanges(current, map[string]interface{}{"baseYieldMin": float64(5)}); err != nil {
		t.Fatalf("expected valid crop range, got %v", err)
	}
}

func TestRiskThresholdSettings(t *testing.T) {
	if _, err := riskThresholdOverride(map[string]interface{}{"unknown": float64(1)}); err == nil {
		t.Fatal("expected unknown threshold to be rejected")
	}
	override, err := riskThresholdOverride(map[string]interface{}{"heavyRain7dMediumMm": float64(120)})
	if err != nil {
		t.Fatalf("expected valid threshold override, got %v", err)
	}
	effective := effectiveRiskThresholds(override)
	if effective["heavyRain7dMediumMm"] != float64(120) {
		t.Fatalf("unexpected effective threshold: %v", effective["heavyRain7dMediumMm"])
	}
	if effective["forecastWindowDays"] != riskThresholdDefaults["forecastWindowDays"] {
		t.Fatalf("missing default threshold: %v", effective["forecastWindowDays"])
	}
}

func TestPredictionDetailProvidesFrontendFieldsAndSafeDefaults(t *testing.T) {
	detail := predictionDetail(map[string]interface{}{
		"id":                 "prediction-id",
		"crop_name":          "Maize",
		"yield_min":          "2.00",
		"method_version":     "rules-1",
		"data_quality_score": float64(70),
		"suitability": map[string]interface{}{
			"verdict":     "marginal",
			"score":       float64(50),
			"explanation": "Rule-based estimate",
		},
		"advisories": []interface{}{map[string]interface{}{"category": "water", "title": "Watch soil moisture"}},
	}, 70)

	if detail["cropName"] != "Maize" || detail["methodVersion"] != "rules-1" {
		t.Fatalf("prediction fields were not translated to the frontend contract: %#v", detail)
	}
	if _, exists := detail["crop_name"]; exists {
		t.Fatal("database column names must not leak into the frontend response")
	}
	conditions, ok := detail["conditionsSummary"].(map[string]interface{})
	if !ok {
		t.Fatalf("conditionsSummary has unexpected type: %#v", detail["conditionsSummary"])
	}
	dataQuality, ok := conditions["dataQuality"].(map[string]interface{})
	if !ok {
		t.Fatalf("dataQuality has unexpected type: %#v", conditions["dataQuality"])
	}
	if _, ok := dataQuality["components"].([]interface{}); !ok {
		t.Fatalf("data quality components are not a list: %#v", dataQuality["components"])
	}
	if _, ok := detail["factors"].([]interface{}); !ok {
		t.Fatalf("factors are not a list: %#v", detail["factors"])
	}
	suitability, ok := detail["suitability"].(map[string]interface{})
	if !ok || suitability["verdict"] != "marginal" {
		t.Fatalf("suitability was not translated to the frontend contract: %#v", detail["suitability"])
	}
	advisories, ok := detail["advisories"].([]interface{})
	if !ok || len(advisories) != 1 {
		t.Fatalf("advisories were not translated to the frontend contract: %#v", detail["advisories"])
	}
}

func TestNormalizeWeatherConvertsOpenMeteoDailyArrays(t *testing.T) {
	raw := []byte(`{"elevation":1200,"daily":{"time":["2025-01-01"],"temperature_2m_max":[26.5],"temperature_2m_min":[17.2],"precipitation_sum":[3.4],"precipitation_probability_max":[70]}}`)
	weather, err := normalizeWeather(raw, "Open-Meteo forecast", time.Now(), true, true)
	if err != nil {
		t.Fatalf("normalize weather response: %v", err)
	}
	daily, ok := weather["daily"].([]interface{})
	if !ok || len(daily) != 1 {
		t.Fatalf("daily forecast is not a one-day list: %#v", weather["daily"])
	}
	day, ok := daily[0].(map[string]interface{})
	if !ok || day["date"] != "2025-01-01" || day["kind"] != "modelled" {
		t.Fatalf("unexpected normalized day: %#v", daily[0])
	}
	if value, ok := day["precipMm"].(*float64); !ok || value == nil || *value != 3.4 {
		t.Fatalf("precipitation was not normalized: %#v", day["precipMm"])
	}
}

func TestNormalizeWeatherRejectsInvalidPayload(t *testing.T) {
	if _, err := normalizeWeather([]byte(`{"daily":{}}`), "Open-Meteo forecast", time.Now(), false, true); err == nil {
		t.Fatal("expected a missing daily time series to be rejected")
	}
}
