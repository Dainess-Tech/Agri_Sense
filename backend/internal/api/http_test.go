package api

import "testing"

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
