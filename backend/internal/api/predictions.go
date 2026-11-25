package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
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
	var farm, crop, plantDate string
	var area float64
	var yieldMin, yieldMax, baseTemp, soilMin, soilMax float64
	err := s.DB.QueryRow(r.Context(), `select p.farm_id::text,c.name,p.planting_date::text,p.planted_area::float,c.base_yield_min::float,c.base_yield_max::float,c.base_temp_c::float,c.soil_moisture_min::float,c.soil_moisture_max::float
		from plantings p join crops c on c.id=p.crop_id where p.id=$1`, b.PlantingID).Scan(&farm, &crop, &plantDate, &area, &yieldMin, &yieldMax, &baseTemp, &soilMin, &soilMax)
	if err != nil {
		Error(w, r, notFound(""))
		return
	}
	if _, e = s.getFarmForUser(r.Context(), u, farm, "write"); e != nil {
		Error(w, r, e)
		return
	}
	totalMin := yieldMin * area
	totalMax := yieldMax * area
	hstart := time.Now().AddDate(0, 3, 0).Format("2006-01-02")
	hend := time.Now().AddDate(0, 5, 0).Format("2006-01-02")
	var id string
	err = s.DB.QueryRow(r.Context(), `insert into predictions(farm_id,planting_id,user_id,crop_name,yield_min,yield_max,yield_unit,total_min,total_max,total_unit,harvest_start,harvest_end,data_quality_score,method_version,conditions_summary,factors,suitability,advisories,limitations)
		values($1,$2,$3,$4,$5,$6,'t/ha',$7,$8,'t',$9,$10,70,'agrisense-rules-1.0.0','{}','[]','{"verdict":"marginal","score":50,"explanation":"Rule-based estimate"}','[]','["Weather and soil providers may limit confidence"]') returning id::text`,
		farm, b.PlantingID, u.ID, crop, yieldMin, yieldMax, totalMin, totalMax, hstart, hend).Scan(&id)
	if err != nil {
		Error(w, r, err)
		return
	}
	p, err := s.predictionJSON(r.Context(), id)
	if err != nil {
		Error(w, r, err)
		return
	}
	JSON(w, map[string]interface{}{"prediction": predictionDetail(p, 70)}, 201)
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
