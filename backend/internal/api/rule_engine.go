package api

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// ruleCrop is the crop-specific envelope used by the transparent rule engine.
// It is deliberately small and readable so the model can be demonstrated and
// audited without a machine-learning training step.
type ruleCrop struct {
	YieldMin, YieldMax                float64
	YieldUnit                         string
	BaseTemp, SoilMin, SoilMax        float64
	TempOptMin, TempOptMax            float64
	TempCriticalLow, TempCriticalHigh float64
	WaterNeedMin, WaterNeedMax        float64
	PHMin, PHMax                      float64
	GDD, MaturityMin, MaturityMax     float64
}

type ruleRisk struct {
	Category, Severity, Explanation string
}

type ruleResult struct {
	Suitability  map[string]interface{}
	Advisories   []interface{}
	Factors      []interface{}
	Limitations  []string
	Conditions   map[string]interface{}
	Quality      int
	YieldMin     float64
	YieldMax     float64
	HarvestStart string
	HarvestEnd   string
	Risks        []ruleRisk
}

type ruleComponent struct {
	name      string
	weight    int
	score     float64
	available bool
	note      string
}

type weatherDay struct {
	Date    string
	TMax    float64
	TMin    float64
	Precip  float64
	Kind    string
	HasTemp bool
}

func asFloat(v interface{}) (float64, bool) {
	switch value := v.(type) {
	case float64:
		return value, true
	case float32:
		return float64(value), true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	case json.Number:
		f, err := value.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		return f, err == nil
	case *float64:
		if value == nil {
			return 0, false
		}
		return *value, true
	}
	return 0, false
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// bandScore returns 100 inside the optimal band and decays linearly to the
// hard biological limits. It is intentionally simple and explainable.
func bandScore(value, lo, hi, hardLo, hardHi float64) float64 {
	if value >= lo && value <= hi {
		return 100
	}
	if value < lo {
		if hardLo >= lo {
			return 0
		}
		return clamp(100*(value-hardLo)/(lo-hardLo), 0, 100)
	}
	if hardHi <= hi {
		return 0
	}
	return clamp(100*(hardHi-value)/(hardHi-hi), 0, 100)
}

func parseWeatherDays(value interface{}) []weatherDay {
	out := []weatherDay{}
	root, ok := value.(map[string]interface{})
	if !ok {
		return out
	}
	days, ok := root["daily"].([]interface{})
	if !ok {
		return out
	}
	for _, raw := range days {
		day, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		date, _ := day["date"].(string)
		kind, _ := day["kind"].(string)
		tmax, okMax := asFloat(day["tMax"])
		tmin, okMin := asFloat(day["tMin"])
		precip, _ := asFloat(day["precipMm"])
		out = append(out, weatherDay{Date: date, TMax: tmax, TMin: tmin, Precip: precip, Kind: kind, HasTemp: okMax && okMin})
	}
	return out
}

func parseSoilProfile(value interface{}) (float64, string, bool) {
	root, ok := value.(map[string]interface{})
	if !ok {
		return 0, "", false
	}
	soil, ok := root["soil"].(map[string]interface{})
	if !ok {
		return 0, "", false
	}
	// Fresh provider responses use camelCase; cached rows use database column names.
	ph, ok := asFloat(soil["phH2o"])
	if !ok {
		ph, ok = asFloat(soil["ph_h2o"])
	}
	texture, _ := soil["texture"].(string)
	return ph, texture, ok && ph > 0
}

func factor(label, dataType string, multiplier float64, explanation string) map[string]interface{} {
	impact := "neutral"
	if multiplier > 1.005 {
		impact = "positive"
	} else if multiplier < 0.995 {
		impact = "negative"
	}
	return map[string]interface{}{
		"key":         strings.ToLower(strings.ReplaceAll(label, " ", "-")),
		"label":       label,
		"multiplier":  math.Round(multiplier*100) / 100,
		"impact":      impact,
		"explanation": explanation,
		"dataType":    dataType,
	}
}

func advisory(category, title, body string) map[string]interface{} {
	return map[string]interface{}{"category": category, "title": title, "body": body}
}

func evaluateRules(crop ruleCrop, plantingDate string, area float64, weather, soil interface{}, sensors map[string]float64) ruleResult {
	days := parseWeatherDays(weather)
	soilPH, soilTexture, soilOK := parseSoilProfile(soil)
	today := time.Now().UTC().Format("2006-01-02")
	planted, plantErr := time.Parse("2006-01-02", plantingDate)
	plantedOK := plantErr == nil

	meanTemp, rainPast, rainForecast, gdd, hotDays, coldDays := 0.0, 0.0, 0.0, 0.0, 0, 0
	tempDays := 0
	for _, d := range days {
		if d.HasTemp {
			mean := (d.TMax + d.TMin) / 2
			meanTemp += mean
			tempDays++
			gdd += math.Max(0, mean-crop.BaseTemp)
			if d.TMax > crop.TempOptMax {
				hotDays++
			}
			if d.TMin < crop.TempOptMin {
				coldDays++
			}
		}
		if d.Date != "" && d.Date <= today && (d.Kind == "modelled" || d.Kind == "") {
			if plantedOK && d.Date >= planted.Format("2006-01-02") {
				rainPast += d.Precip
			}
		}
		if d.Kind == "forecast" || (d.Date != "" && d.Date >= today) {
			rainForecast += d.Precip
		}
	}
	if tempDays > 0 {
		meanTemp /= float64(tempDays)
	}

	components := []ruleComponent{}
	weights := 0
	earned := 0.0

	add := func(name string, weight int, value float64, score float64, available bool, note string) {
		components = append(components, ruleComponent{name, weight, score, available, note})
		if available {
			weights += weight
			earned += score * float64(weight)
		}
	}

	if tempDays > 0 {
		score := bandScore(meanTemp, crop.TempOptMin, crop.TempOptMax, crop.TempCriticalLow, crop.TempCriticalHigh)
		if hotDays > 2 {
			score -= float64(hotDays-2) * 4
		}
		if coldDays > 2 {
			score -= float64(coldDays-2) * 3
		}
		score = clamp(score, 0, 100)
		add("Temperature", 25, meanTemp, score, true, fmt.Sprintf("Mean %.1f °C; %d hot / %d cold days", meanTemp, hotDays, coldDays))
	} else {
		add("Temperature", 25, 0, 0, false, "Weather forecast unavailable")
	}

	// Compare a 16-day rainfall window with a proportional share of the
	// crop's seasonal water requirement.
	targetLow := crop.WaterNeedMin * 0.2
	targetHigh := crop.WaterNeedMax * 0.2
	if len(days) > 0 {
		score := bandScore(rainForecast, targetLow, targetHigh, 0, targetHigh*2.2)
		add("Rainfall", 25, rainForecast, score, true, fmt.Sprintf("Forecast %.0f mm vs %.0f–%.0f mm seasonal share", rainForecast, targetLow, targetHigh))
	} else {
		add("Rainfall", 25, 0, 0, false, "Weather forecast unavailable")
	}

	moisture, hasMoisture := sensors["soil_moisture"]
	if hasMoisture {
		score := bandScore(moisture, crop.SoilMin, crop.SoilMax, 0, 100)
		add("Soil moisture", 20, moisture, score, true, fmt.Sprintf("7-day mean %.1f%% vs crop band %.0f–%.0f%%", moisture, crop.SoilMin, crop.SoilMax))
	} else {
		add("Soil moisture", 20, 0, 0, false, "No valid probe readings in the last 7 days")
	}

	if soilOK {
		score := bandScore(soilPH, crop.PHMin, crop.PHMax, 3.5, 9)
		add("Soil pH", 15, soilPH, score, true, fmt.Sprintf("SoilGrids pH %.1f vs crop band %.1f–%.1f", soilPH, crop.PHMin, crop.PHMax))
	} else {
		add("Soil pH", 15, 0, 0, false, "SoilGrids profile unavailable")
	}

	nutrientScore, nutrientNotes := 0.0, []string{}
	for _, probe := range []string{"soil_n", "soil_p", "soil_k"} {
		if value, ok := sensors[probe]; ok {
			lo, hi := 40.0, 120.0
			if probe == "soil_p" {
				lo, hi = 15, 60
			}
			if probe == "soil_k" {
				lo, hi = 120, 300
			}
			nutrientScore += bandScore(value, lo, hi, 0, hi*2)
			nutrientNotes = append(nutrientNotes, fmt.Sprintf("%s %.0f mg/kg", strings.ToUpper(strings.TrimPrefix(probe, "soil_")), value))
		}
	}
	if len(nutrientNotes) > 0 {
		nutrientScore /= float64(len(nutrientNotes))
		add("NPK nutrients", 15, nutrientScore, nutrientScore, true, strings.Join(nutrientNotes, ", "))
	} else {
		add("NPK nutrients", 15, 0, 0, false, "Optional NPK probes not connected")
	}

	quality := weights
	score := 0.0
	if weights > 0 {
		score = earned / float64(weights)
	} else {
		score = 50
	}
	verdict := "unknown"
	switch {
	case weights == 0:
		verdict = "unknown"
	case score >= 70:
		verdict = "suitable"
	case score >= 45:
		verdict = "marginal"
	default:
		verdict = "unsuitable"
	}

	qualityComponents := make([]interface{}, 0, len(components))
	for _, c := range components {
		qualityComponents = append(qualityComponents, map[string]interface{}{"name": c.name, "available": c.available, "weight": c.weight, "note": c.note})
	}

	limitations := []string{}
	if tempDays == 0 {
		limitations = append(limitations, "Weather forecast could not be retrieved; temperature and rainfall were treated as unavailable.")
	}
	if !soilOK {
		limitations = append(limitations, "SoilGrids profile could not be retrieved; soil pH was treated as unavailable.")
	}
	if !hasMoisture {
		limitations = append(limitations, "No valid soil-moisture probe readings in the last 7 days.")
	}
	if len(nutrientNotes) == 0 {
		limitations = append(limitations, "NPK probes are optional; nutrient suitability was not scored.")
	}
	limitations = append(limitations, "Rule-based decision support using configured crop thresholds and current field inputs.")

	// Yield adjustment: good conditions approach the crop's attainable yield;
	// poor or missing conditions widen the range and pull it down.
	strength := 0.65 + 0.35*(score/100)
	if quality < 70 {
		strength -= float64(70-quality) / 500
	}
	strength = clamp(strength, 0.45, 1)
	midpoint := ((crop.YieldMin + crop.YieldMax) / 2) * strength
	half := (crop.YieldMax - crop.YieldMin) / 2 * (1 + float64(100-quality)/200)
	yieldMin := math.Max(0, math.Round((midpoint-half)*100)/100)
	yieldMax := math.Round((midpoint+half)*100) / 100

	maturity := (crop.MaturityMin + crop.MaturityMax) / 2
	if meanTemp > 0 {
		if meanTemp > crop.TempOptMax {
			maturity *= 0.92
		} else if meanTemp < crop.TempOptMin {
			maturity *= 1.08
		}
	}
	harvestStart, harvestEnd := "", ""
	if plantedOK {
		start := planted.AddDate(0, 0, int(math.Round(maturity))-5)
		end := planted.AddDate(0, 0, int(math.Round(maturity))+7)
		harvestStart = start.Format("2006-01-02")
		harvestEnd = end.Format("2006-01-02")
	} else {
		harvestStart = time.Now().AddDate(0, 3, 0).Format("2006-01-02")
		harvestEnd = time.Now().AddDate(0, 5, 0).Format("2006-01-02")
	}

	growth := 0.0
	if plantedOK && crop.MaturityMax > 0 {
		growth = clamp(float64(time.Since(planted).Hours()/24)/crop.MaturityMax*100, 0, 100)
	}

	var soilPHSource interface{}
	if soilOK {
		soilPHSource = "modelled (ISRIC SoilGrids)"
	}
	conditions := map[string]interface{}{
		"rainSincePlantingMm": nilIfFloat(rainPast, len(days) > 0 && plantedOK),
		"forecastRainMm":      nilIfFloat(rainForecast, len(days) > 0),
		"meanTempC":           nilIfFloat(meanTemp, tempDays > 0),
		"gddAccumulated":      nilIfFloat(gdd, tempDays > 0),
		"hotDays":             hotDays,
		"coldDays":            coldDays,
		"soilPh":              nilIfFloat(soilPH, soilOK),
		"soilPhSource":        soilPHSource,
		"soilMoistureAvg":     nilIfFloat(moisture, hasMoisture),
		"soilTexture":         nilIfText(soilTexture),
		"growthProgressPct":   math.Round(growth),
		"areaHa":              math.Round(area*100) / 100,
		"dataQuality":         map[string]interface{}{"score": quality, "components": qualityComponents},
	}

	factors := []interface{}{}
	risks := []ruleRisk{}
	advisories := []interface{}{}
	for _, c := range components {
		if !c.available {
			continue
		}
		multiplier := 0.7 + 0.3*(c.score/100)
		factors = append(factors, factor(c.name, factorDataType(c.name), multiplier, c.note))
	}

	if hasMoisture && moisture < crop.SoilMin {
		body := fmt.Sprintf("7-day mean soil moisture is %.1f%%, below the %.0f–%.0f%% comfort band. Irrigate and recheck the probe before the next field operation.", moisture, crop.SoilMin, crop.SoilMax)
		advisories = append(advisories, advisory("water", "Schedule irrigation", body))
		risks = append(risks, ruleRisk{"soil_moisture", "medium", body})
	}
	if len(days) > 0 && rainForecast < targetLow {
		advisories = append(advisories, advisory("water", "Plan supplemental water", fmt.Sprintf("Forecast rain is %.0f mm, below the %.0f mm seasonal share. Plan supplemental irrigation if the dry spell persists.", rainForecast, targetLow)))
		risks = append(risks, ruleRisk{"drought", "medium", "Forecast rainfall is below the crop's seasonal water share."})
	}
	if len(days) > 0 && rainForecast > targetHigh*1.5 {
		advisories = append(advisories, advisory("field", "Check drainage", "Heavy rainfall is forecast. Avoid compaction and check field drainage before entering the plot."))
		risks = append(risks, ruleRisk{"excessive_rainfall", "high", "Forecast rainfall exceeds the crop's seasonal water share."})
	}
	if tempDays > 0 && hotDays > 2 {
		advisories = append(advisories, advisory("temperature", "Reduce heat stress", fmt.Sprintf("%d forecast days exceed %.0f °C. Mulch and irrigate early in the morning.", hotDays, crop.TempOptMax)))
		risks = append(risks, ruleRisk{"heat_stress", "medium", "Multiple hot days are forecast above the crop optimum."})
	}
	if soilOK && (soilPH < crop.PHMin || soilPH > crop.PHMax) {
		advisories = append(advisories, advisory("soil", "Retest soil pH", fmt.Sprintf("Modelled pH %.1f is outside the %.1f–%.1f crop band. Confirm with a soil test before liming.", soilPH, crop.PHMin, crop.PHMax)))
		risks = append(risks, ruleRisk{"soil_ph", "low", "Modelled soil pH is outside the crop's preferred range."})
	}
	if len(nutrientNotes) > 0 && nutrientScore < 60 {
		advisories = append(advisories, advisory("soil", "Review nutrient levels", "NPK probes indicate at least one nutrient below the rule-based target band. Confirm with a soil test before applying fertiliser."))
	}
	if len(advisories) == 0 {
		advisories = append(advisories, advisory("management", "Maintain current plan", "No rule-based stress conditions were detected from the available data."))
	}

	explanationParts := []string{}
	for _, c := range components {
		if c.available && c.score < 60 {
			explanationParts = append(explanationParts, c.name+" is the main limiting factor")
		}
	}
	explanation := "Conditions are close to the crop's preferred range across the available inputs."
	if len(explanationParts) > 0 {
		explanation = strings.Join(explanationParts, "; ") + "."
	} else if weights == 0 {
		explanation = "No environmental inputs were available; yield reflects the crop baseline only."
	}

	return ruleResult{
		Suitability:  map[string]interface{}{"verdict": verdict, "score": math.Round(score), "explanation": explanation},
		Advisories:   advisories,
		Factors:      factors,
		Limitations:  limitations,
		Conditions:   conditions,
		Quality:      quality,
		YieldMin:     yieldMin,
		YieldMax:     yieldMax,
		HarvestStart: harvestStart,
		HarvestEnd:   harvestEnd,
		Risks:        risks,
	}
}

func nilIfFloat(value float64, ok bool) interface{} {
	if !ok || math.IsNaN(value) {
		return nil
	}
	return math.Round(value*10) / 10
}

func factorDataType(name string) string {
	switch name {
	case "Temperature", "Rainfall":
		return "forecast"
	case "Soil moisture", "NPK nutrients":
		return "measured"
	case "Soil pH":
		return "modelled"
	}
	return "calculated"
}
