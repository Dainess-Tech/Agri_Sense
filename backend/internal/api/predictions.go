package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (s *Server) predictionsGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	fid := r.URL.Query().Get("farmId")
	query := `select p.id::text,p.farm_id::text,p.crop_name,p.yield_min::text,p.yield_max::text,p.yield_unit,p.total_min::text,p.total_max::text,p.harvest_start::text,p.harvest_end::text,p.data_quality_score,p.method_version,p.created_at,f.name
		from predictions p join farms f on f.id=p.farm_id where p.farm_id in (select id from farms where owner_id=$1 or id in (select farm_id from farm_members where user_id=$1))`
	args := []interface{}{u.ID}
	if fid != "" {
		if _, e = s.getFarmForUser(r.Context(), u, fid, "read"); e != nil {
			Error(w, r, e)
			return
		}
		query = `select p.id::text,p.farm_id::text,p.crop_name,p.yield_min::text,p.yield_max::text,p.yield_unit,p.total_min::text,p.total_max::text,p.harvest_start::text,p.harvest_end::text,p.data_quality_score,p.method_version,p.created_at,f.name
		from predictions p join farms f on f.id=p.farm_id where p.farm_id=$1`
		args = []interface{}{fid}
	}
	query += " order by p.created_at desc limit 200"
	rows, err := s.DB.Query(r.Context(), query, args...)
	if err != nil {
		Error(w, r, err)
		return
	}
	defer rows.Close()
	out := []interface{}{}
	for rows.Next() {
		var id, farm, crop, ymin, ymax, yunit, tmin, tmax, hstart, hend, method, fname string
		var quality int
		var created time.Time
		rows.Scan(&id, &farm, &crop, &ymin, &ymax, &yunit, &tmin, &tmax, &hstart, &hend, &quality, &method, &created, &fname)
		out = append(out, map[string]interface{}{"id": id, "farmId": farm, "cropName": crop, "yieldMin": ymin, "yieldMax": ymax, "yieldUnit": yunit, "totalMin": tmin, "totalMax": tmax, "harvestStart": hstart, "harvestEnd": hend, "dataQualityScore": quality, "methodVersion": method, "createdAt": created, "farmName": fname})
	}
	JSON(w, map[string]interface{}{"predictions": out}, 200)
}
func (s *Server) recentSensorAverages(ctx context.Context, farmID string) map[string]float64 {
	out := map[string]float64{}
	rows, err := s.DB.Query(ctx, `select sensor_type,avg(value::float8)::text from sensor_readings
		where farm_id=$1 and measured_at>now()-interval '7 days' and quality='valid' group by sensor_type`, farmID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var sensor string
		var avg string
		if rows.Scan(&sensor, &avg) == nil {
			if value, ok := asFloat(avg); ok {
				out[sensor] = value
			}
		}
	}
	return out
}

func (s *Server) predictionsPost(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	if err := rateLimit("predict:"+u.ID, 20, time.Hour); err != nil {
		Error(w, r, err)
		return
	}
	var b struct {
		PlantingID string `json:"plantingId"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	var farm, crop, plantDate, areaUnit, latText, lngText string
	var area float64
	var cropRule ruleCrop
	err := s.DB.QueryRow(r.Context(), `select p.farm_id::text,c.name,p.planting_date::text,p.planted_area::float,p.area_unit::text,
		f.latitude::text,f.longitude::text,c.base_yield_min::float,c.base_yield_max::float,c.yield_unit,
		c.base_temp_c::float,c.temp_opt_min::float,c.temp_opt_max::float,c.temp_critical_low::float,c.temp_critical_high::float,
		c.soil_moisture_min::float,c.soil_moisture_max::float,c.ph_min::float,c.ph_max::float,
		c.water_need_min_mm,c.water_need_max_mm,c.gdd_to_maturity::float,c.maturity_days_min::float,c.maturity_days_max::float
		from plantings p join crops c on c.id=p.crop_id join farms f on f.id=p.farm_id where p.id=$1`, b.PlantingID).
		Scan(&farm, &crop, &plantDate, &area, &areaUnit, &latText, &lngText, &cropRule.YieldMin, &cropRule.YieldMax, &cropRule.YieldUnit,
			&cropRule.BaseTemp, &cropRule.TempOptMin, &cropRule.TempOptMax, &cropRule.TempCriticalLow, &cropRule.TempCriticalHigh,
			&cropRule.SoilMin, &cropRule.SoilMax, &cropRule.PHMin, &cropRule.PHMax,
			&cropRule.WaterNeedMin, &cropRule.WaterNeedMax, &cropRule.GDD, &cropRule.MaturityMin, &cropRule.MaturityMax)
	if err != nil {
		Error(w, r, notFound(""))
		return
	}
	if _, e = s.getFarmForUser(r.Context(), u, farm, "write"); e != nil {
		Error(w, r, e)
		return
	}
	areaHa := area
	switch strings.ToLower(areaUnit) {
	case "acres":
		areaHa *= 0.40468564224
	case "square_meters", "square metres", "m2":
		areaHa /= 10000
	}
	lat, _ := strconv.ParseFloat(latText, 64)
	lng, _ := strconv.ParseFloat(lngText, 64)

	weather, weatherErr := s.weatherForecast(lat, lng)
	soil, soilErr := s.soilProfile(lat, lng)
	sensors := s.recentSensorAverages(r.Context(), farm)
	result := evaluateRules(cropRule, plantDate, areaHa, weather, soil, sensors)

	conditionsJSON, _ := json.Marshal(result.Conditions)
	factorsJSON, _ := json.Marshal(result.Factors)
	suitabilityJSON, _ := json.Marshal(result.Suitability)
	advisoriesJSON, _ := json.Marshal(result.Advisories)
	limitationsJSON, _ := json.Marshal(result.Limitations)
	snapshotJSON, _ := json.Marshal(map[string]interface{}{"crop": cropRule, "plantingDate": plantDate, "areaHa": areaHa, "weather": weather, "soil": soil, "sensorAverages": sensors})
	sourcesList := []map[string]interface{}{
		{"name": "Crop catalogue", "type": "database", "retrievedAt": time.Now()},
		{"name": "Rule engine", "type": "rules", "version": "agrisense-rules-1.1.0"},
	}
	if weatherErr == nil {
		sourcesList = append(sourcesList, map[string]interface{}{"name": "Open-Meteo forecast", "type": "weather", "retrievedAt": time.Now()})
	}
	if soilErr == nil {
		sourcesList = append(sourcesList, map[string]interface{}{"name": "ISRIC SoilGrids", "type": "soil", "retrievedAt": time.Now()})
	}
	if len(sensors) > 0 {
		sourcesList = append(sourcesList, map[string]interface{}{"name": "IoT sensor readings (7-day mean)", "type": "measured", "retrievedAt": time.Now()})
	}
	sourcesJSON, _ := json.Marshal(map[string]interface{}{"sources": sourcesList})

	totalMin := result.YieldMin * areaHa
	totalMax := result.YieldMax * areaHa
	var id string
	err = s.DB.QueryRow(r.Context(), `insert into predictions(farm_id,planting_id,user_id,crop_name,yield_min,yield_max,yield_unit,total_min,total_max,total_unit,harvest_start,harvest_end,data_quality_score,method_version,conditions_summary,factors,suitability,advisories,limitations)
		values($1,$2,$3,$4,$5,$6,$7,$8,$9,'t',$10,$11,$12,'agrisense-rules-1.1.0',$13,$14,$15,$16,$17) returning id::text`,
		farm, b.PlantingID, u.ID, crop, fmtFloat(result.YieldMin), fmtFloat(result.YieldMax), cropRule.YieldUnit,
		fmtFloat(totalMin), fmtFloat(totalMax), result.HarvestStart, result.HarvestEnd, result.Quality,
		string(conditionsJSON), string(factorsJSON), string(suitabilityJSON), string(advisoriesJSON), string(limitationsJSON)).Scan(&id)
	if err != nil {
		Error(w, r, err)
		return
	}
	_, _ = s.DB.Exec(r.Context(), `insert into prediction_inputs(prediction_id,snapshot,sources) values($1,$2,$3)`, id, string(snapshotJSON), string(sourcesJSON))
	for _, risk := range result.Risks {
		_, _ = s.DB.Exec(r.Context(), `insert into prediction_risks(prediction_id,category,severity,explanation) values($1,$2,$3,$4)`, id, risk.Category, risk.Severity, risk.Explanation)
	}
	if err := s.evaluateFarmRules(r.Context(), farm, lat, lng); err != nil {
		log.Printf("[rules] farm %s refresh after prediction failed: %v", farm, err)
	}
	p, err := s.predictionJSON(r.Context(), id)
	if err != nil {
		Error(w, r, err)
		return
	}
	JSON(w, map[string]interface{}{"prediction": predictionDetail(p, result.Quality)}, 201)
}
func (s *Server) predictionJSON(ctx context.Context, id string) (map[string]interface{}, error) {
	var raw []byte
	if err := s.DB.QueryRow(ctx, `select row_to_json(p)::text from predictions p where id=$1`, id).Scan(&raw); err != nil {
		return nil, err
	}
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func predictionConditions(raw interface{}, quality int) map[string]interface{} {
	summary, ok := raw.(map[string]interface{})
	if !ok {
		summary = map[string]interface{}{}
	}
	conditions := map[string]interface{}{
		"rainSincePlantingMm": nil,
		"forecastRainMm":      nil,
		"meanTempC":           nil,
		"gddAccumulated":      nil,
		"hotDays":             0,
		"coldDays":            0,
		"soilPh":              nil,
		"soilPhSource":        nil,
		"soilMoistureAvg":     nil,
		"soilTexture":         nil,
		"growthProgressPct":   0,
		"areaHa":              0,
	}
	for key := range conditions {
		if value, exists := summary[key]; exists {
			conditions[key] = value
		}
	}

	dataQuality, ok := summary["dataQuality"].(map[string]interface{})
	if !ok {
		dataQuality = map[string]interface{}{}
	}
	if _, exists := dataQuality["score"]; !exists {
		dataQuality["score"] = quality
	}
	if _, ok := dataQuality["components"].([]interface{}); !ok {
		dataQuality["components"] = []interface{}{}
	}
	conditions["dataQuality"] = dataQuality
	return conditions
}

func predictionList(raw interface{}) []interface{} {
	list, ok := raw.([]interface{})
	if !ok {
		return []interface{}{}
	}
	return list
}

func predictionSuitability(raw interface{}) map[string]interface{} {
	out := map[string]interface{}{
		"verdict":     "unknown",
		"score":       0,
		"explanation": "Environmental suitability was not evaluated for this prediction.",
	}
	if value, ok := raw.(map[string]interface{}); ok {
		for key, entry := range value {
			out[key] = entry
		}
	}
	return out
}

func predictionDetail(raw map[string]interface{}, quality int) map[string]interface{} {
	return map[string]interface{}{
		"id":                raw["id"],
		"cropName":          raw["crop_name"],
		"yieldMin":          raw["yield_min"],
		"yieldMax":          raw["yield_max"],
		"yieldUnit":         raw["yield_unit"],
		"totalMin":          raw["total_min"],
		"totalMax":          raw["total_max"],
		"totalUnit":         raw["total_unit"],
		"harvestStart":      raw["harvest_start"],
		"harvestEnd":        raw["harvest_end"],
		"dataQualityScore":  raw["data_quality_score"],
		"methodVersion":     raw["method_version"],
		"createdAt":         raw["created_at"],
		"conditionsSummary": predictionConditions(raw["conditions_summary"], quality),
		"factors":           predictionList(raw["factors"]),
		"suitability":       predictionSuitability(raw["suitability"]),
		"advisories":        predictionList(raw["advisories"]),
		"limitations":       predictionList(raw["limitations"]),
	}
}

func (s *Server) predictionGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	id := chi.URLParam(r, "predictionId")
	var farm, plant, farmName, plantingDate, plantedArea, areaUnit, irrigation string
	var actualYield, actualYieldUnit sql.NullString
	err := s.DB.QueryRow(r.Context(), `select p.farm_id::text,p.planting_id::text,f.name,pl.planting_date::text,pl.planted_area::text,pl.area_unit,pl.irrigation::text,pl.actual_yield::text,pl.actual_yield_unit
		from predictions p join farms f on f.id=p.farm_id join plantings pl on pl.id=p.planting_id where p.id=$1`, id).
		Scan(&farm, &plant, &farmName, &plantingDate, &plantedArea, &areaUnit, &irrigation, &actualYield, &actualYieldUnit)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			Error(w, r, notFound(""))
		} else {
			Error(w, r, err)
		}
		return
	}
	if _, e = s.getFarmForUser(r.Context(), u, farm, "read"); e != nil {
		Error(w, r, e)
		return
	}
	rawPrediction, err := s.predictionJSON(r.Context(), id)
	if err != nil {
		Error(w, r, err)
		return
	}
	var quality int
	switch value := rawPrediction["data_quality_score"].(type) {
	case float64:
		quality = int(value)
	case int:
		quality = value
	}
	p := predictionDetail(rawPrediction, quality)

	var input, sources interface{}
	err = s.DB.QueryRow(r.Context(), `select snapshot,sources from prediction_inputs where prediction_id=$1`, id).Scan(&input, &sources)
	if err != nil && err != pgx.ErrNoRows {
		Error(w, r, err)
		return
	}
	risks := []interface{}{}
	rows, err := s.DB.Query(r.Context(), `select id::text,category,severity::text,explanation from prediction_risks where prediction_id=$1`, id)
	if err != nil {
		Error(w, r, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var riskID, category, severity, explanation string
		if err := rows.Scan(&riskID, &category, &severity, &explanation); err != nil {
			Error(w, r, err)
			return
		}
		risks = append(risks, map[string]interface{}{"id": riskID, "category": category, "severity": severity, "explanation": explanation})
	}
	if err := rows.Err(); err != nil {
		Error(w, r, err)
		return
	}

	var version, method, description string
	err = s.DB.QueryRow(r.Context(), `select version,method,description from prediction_versions where version=$1`, rawPrediction["method_version"]).Scan(&version, &method, &description)
	if err != nil {
		Error(w, r, err)
		return
	}

	var yieldActual, yieldUnit interface{}
	if actualYield.Valid {
		yieldActual = actualYield.String
	}
	if actualYieldUnit.Valid {
		yieldUnit = actualYieldUnit.String
	}
	JSON(w, map[string]interface{}{
		"prediction": p,
		"risks":      risks,
		"inputs":     map[string]interface{}{"snapshot": input, "sources": sources},
		"previous":   nil,
		"farm":       map[string]interface{}{"id": farm, "name": farmName},
		"planting": map[string]interface{}{
			"id": plant, "plantingDate": plantingDate, "plantedArea": plantedArea,
			"areaUnit": areaUnit, "irrigation": irrigation,
			"actualYield": yieldActual, "actualYieldUnit": yieldUnit,
		},
		"version": map[string]interface{}{"version": version, "method": method, "description": description},
	}, 200)
}
