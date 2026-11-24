package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
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
	p, _ := s.predictionJSON(r.Context(), id)
	JSON(w, map[string]interface{}{"prediction": p}, 201)
}
func (s *Server) predictionJSON(ctx context.Context, id string) (map[string]interface{}, error) {
	var raw []byte
	if err := s.DB.QueryRow(ctx, `select row_to_json(p)::text from predictions p where id=$1`, id).Scan(&raw); err != nil {
		return nil, err
	}
	var m map[string]interface{}
	json.Unmarshal(raw, &m)
	return m, nil
}
func (s *Server) predictionGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	id := chi.URLParam(r, "predictionId")
	var farm, plant string
	err := s.DB.QueryRow(r.Context(), `select farm_id::text,planting_id::text from predictions where id=$1`, id).Scan(&farm, &plant)
	if err != nil {
		Error(w, r, notFound(""))
		return
	}
	if _, e = s.getFarmForUser(r.Context(), u, farm, "read"); e != nil {
		Error(w, r, e)
		return
	}
	p, _ := s.predictionJSON(r.Context(), id)
	var input, sources interface{}
	risks := []interface{}{}
	_ = s.DB.QueryRow(r.Context(), `select snapshot,sources from prediction_inputs where prediction_id=$1`, id).Scan(&input, &sources)
	rows, _ := s.DB.Query(r.Context(), `select category,severity::text,explanation from prediction_risks where prediction_id=$1`, id)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var c, se, ex string
			rows.Scan(&c, &se, &ex)
			risks = append(risks, map[string]interface{}{"category": c, "severity": se, "explanation": ex})
		}
	}
	JSON(w, map[string]interface{}{"prediction": p, "risks": risks, "inputs": map[string]interface{}{"snapshot": input, "sources": sources}, "previous": nil, "farm": map[string]interface{}{"id": farm}, "planting": map[string]interface{}{"id": plant}, "version": "agrisense-rules-1.0.0"}, 200)
}
