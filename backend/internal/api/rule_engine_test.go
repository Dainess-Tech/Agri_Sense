package api

import (
	"testing"
	"time"
)

func demoRuleCrop() ruleCrop {
	return ruleCrop{
		YieldMin: 2, YieldMax: 6, YieldUnit: "t/ha", BaseTemp: 10,
		SoilMin: 25, SoilMax: 45, TempOptMin: 18, TempOptMax: 32,
		TempCriticalLow: 10, TempCriticalHigh: 35,
		WaterNeedMin: 500, WaterNeedMax: 800, PHMin: 5.5, PHMax: 7.5,
		GDD: 1400, MaturityMin: 90, MaturityMax: 150,
	}
}

func TestRuleEngineProducesExplainableSuitability(t *testing.T) {
	days := []interface{}{}
	today := time.Now().UTC()
	for i := 0; i < 10; i++ {
		days = append(days, map[string]interface{}{
			"date":     today.AddDate(0, 0, i).Format("2006-01-02"),
			"tMax":     28.0,
			"tMin":     20.0,
			"precipMm": 12.0,
			"kind":     "forecast",
		})
	}
	weather := map[string]interface{}{"daily": days}
	soil := map[string]interface{}{"soil": map[string]interface{}{"phH2o": 6.4, "texture": "loam"}}
	sensors := map[string]float64{"soil_moisture": 30, "soil_n": 70, "soil_p": 30, "soil_k": 190}

	result := evaluateRules(demoRuleCrop(), today.AddDate(0, 0, -20).Format("2006-01-02"), 2, weather, soil, sensors)
	if result.Suitability["verdict"] != "suitable" {
		t.Fatalf("expected suitable conditions, got %#v", result.Suitability)
	}
	if result.Quality != 100 {
		t.Fatalf("expected full data quality, got %d", result.Quality)
	}
	if len(result.Factors) == 0 || len(result.Advisories) == 0 {
		t.Fatalf("expected factors and advisories, got factors=%d advisories=%d", len(result.Factors), len(result.Advisories))
	}
	if result.YieldMin <= 0 || result.YieldMax <= result.YieldMin {
		t.Fatalf("unexpected yield range %.2f–%.2f", result.YieldMin, result.YieldMax)
	}
}

func TestRuleEngineDegradesGracefullyWithoutExternalData(t *testing.T) {
	result := evaluateRules(demoRuleCrop(), time.Now().UTC().Format("2006-01-02"), 1, nil, nil, map[string]float64{})
	if result.Suitability["verdict"] != "unknown" {
		t.Fatalf("expected unknown verdict, got %#v", result.Suitability)
	}
	if result.Quality != 0 {
		t.Fatalf("expected zero data quality, got %d", result.Quality)
	}
	if len(result.Limitations) == 0 {
		t.Fatal("expected missing-data limitations")
	}
}
