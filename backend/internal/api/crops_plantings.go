package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

func (s *Server) cropsGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	_ = u
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	rows, e := s.DB.Query(r.Context(), `select c.id::text,c.slug,c.name,c.scientific_name,c.yield_unit,c.base_yield_min::text,c.base_yield_max::text,c.maturity_days_min,c.maturity_days_max,c.base_temp_c::text,c.gdd_to_maturity,c.temp_opt_min::text,c.temp_opt_max::text,c.temp_critical_low::text,c.temp_critical_high::text,c.water_need_min_mm,c.water_need_max_mm,c.soil_moisture_min::text,c.soil_moisture_max::text,c.ph_min::text,c.ph_max::text
		from crops c where c.active=true and ($1='' or c.name ilike '%'||$1||'%' or c.slug ilike '%'||$1||'%') order by c.name`, q)
	if e != nil {
		Error(w, r, e)
		return
	}
	defer rows.Close()
	out := []interface{}{}
	for rows.Next() {
		var id, slug, name, yieldUnit string
		var scientific interface{}
		var smin, smax, phmin, phmax string
		var ymin, ymax, btemp, tomin, tomax, tcl, tch string
		var mmin, mmax, gdd, wmin, wmax int
		if err := rows.Scan(&id, &slug, &name, &scientific, &yieldUnit, &ymin, &ymax, &mmin, &mmax, &btemp, &gdd, &tomin, &tomax, &tcl, &tch, &wmin, &wmax, &smin, &smax, &phmin, &phmax); err != nil {
			continue
		}
		vrows, _ := s.DB.Query(r.Context(), `select id::text,name,maturity_factor::text,yield_factor::text,notes from crop_varieties where crop_id=$1 order by name`, id)
		vars := []interface{}{}
		if vrows != nil {
			defer vrows.Close()
			for vrows.Next() {
				var vid, vname, mf, yf string
				var notes interface{}
				vrows.Scan(&vid, &vname, &mf, &yf, &notes)
				vars = append(vars, map[string]interface{}{"id": vid, "name": vname, "maturityFactor": mf, "yieldFactor": yf, "notes": notes})
			}
		}
		out = append(out, map[string]interface{}{"id": id, "slug": slug, "name": name, "scientificName": scientific, "yieldUnit": yieldUnit, "baseYieldMin": ymin, "baseYieldMax": ymax, "maturityDaysMin": mmin, "maturityDaysMax": mmax, "baseTempC": btemp, "gddToMaturity": gdd, "tempOptMin": tomin, "tempOptMax": tomax, "tempCriticalLow": tcl, "tempCriticalHigh": tch, "waterNeedMinMm": wmin, "waterNeedMaxMm": wmax, "soilMoistureMin": smin, "soilMoistureMax": smax, "phMin": phmin, "phMax": phmax, "varieties": vars})
	}
	JSON(w, map[string]interface{}{"crops": out}, 200)
}

func (s *Server) plantingsGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	fid := r.URL.Query().Get("farmId")
	if fid == "" {
		JSON(w, map[string]interface{}{"plantings": []interface{}{}}, 200)
		return
	}
	if _, e = s.getFarmForUser(r.Context(), u, fid, "read"); e != nil {
		Error(w, r, e)
		return
	}
	rows, e := s.DB.Query(r.Context(), `select p.id::text,c.name,v.name
		from plantings p join crops c on c.id=p.crop_id left join crop_varieties v on v.id=p.variety_id where p.farm_id=$1 order by p.planting_date desc`, fid)
	if e != nil {
		Error(w, r, e)
		return
	}
	defer rows.Close()
	out := []interface{}{}
	for rows.Next() {
		var id, cropName string
		var varietyName interface{}
		rows.Scan(&id, &cropName, &varietyName)
		p, _ := s.plantingJSON(r.Context(), id)
		p["cropName"] = cropName
		p["varietyName"] = varietyName
		out = append(out, p)
	}
	JSON(w, map[string]interface{}{"plantings": out}, 200)
}
func nilIfText(v string) interface{} {
	if v == "" {
		return nil
	}
	return v
}
func (s *Server) plantingsPost(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	var b struct {
		FarmID       string  `json:"farmId"`
		CropID       string  `json:"cropId"`
		VarietyID    string  `json:"varietyId"`
		PlantingDate string  `json:"plantingDate"`
		Season       string  `json:"season"`
		Irrigation   string  `json:"irrigation"`
		Status       string  `json:"status"`
		Notes        string  `json:"notes"`
		ClientID     string  `json:"clientId"`
		PlantedArea  float64 `json:"plantedArea"`
		AreaUnit     string  `json:"areaUnit"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	if _, e = s.getFarmForUser(r.Context(), u, b.FarmID, "write"); e != nil {
		Error(w, r, e)
		return
	}
	if b.ClientID != "" {
		var existing string
		err := s.DB.QueryRow(r.Context(), `select id::text from plantings where farm_id=$1 and client_id=$2`, b.FarmID, b.ClientID).Scan(&existing)
		if err == nil {
			p, e := s.plantingJSON(r.Context(), existing)
			if e != nil {
				Error(w, r, e)
				return
			}
			JSON(w, map[string]interface{}{"planting": p, "duplicate": true}, 200)
			return
		}
	}
	if _, ok := dateOnly(b.PlantingDate); !ok {
		Error(w, r, validation("Invalid calendar date", nil))
		return
	}
	if b.AreaUnit == "" {
		b.AreaUnit = "hectares"
	}
	if b.Irrigation == "" {
		b.Irrigation = "rainfed"
	}
	if b.Status == "" {
		b.Status = "planted"
	}
	var id string
	err := s.DB.QueryRow(r.Context(), `insert into plantings(farm_id,crop_id,variety_id,planting_date,planted_area,area_unit,season,irrigation,status,notes,client_id) values($1,$2,nullif($3::text,'')::uuid,$4,$5,$6,nullif($7,''),$8,$9,nullif($10,''),nullif($11,'')) returning id::text`,
		b.FarmID, b.CropID, b.VarietyID, b.PlantingDate, b.PlantedArea, b.AreaUnit, b.Season, b.Irrigation, b.Status, b.Notes, b.ClientID).Scan(&id)
	if err != nil {
		Error(w, r, err)
		return
	}
	p, _ := s.plantingJSON(r.Context(), id)
	JSON(w, map[string]interface{}{"planting": p}, 201)
}

func (s *Server) plantingJSON(ctx context.Context, id string) (map[string]interface{}, error) {
	var raw []byte
	err := s.DB.QueryRow(ctx, `select row_to_json(p)::text from plantings p where p.id=$1`, id).Scan(&raw)
	if err != nil {
		return nil, err
	}
	var m map[string]interface{}
	if err = json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	for from, to := range map[string]string{
		"farm_id": "farmId", "crop_id": "cropId", "variety_id": "varietyId",
		"planting_date": "plantingDate", "planted_area": "plantedArea", "area_unit": "areaUnit",
		"actual_harvest_date": "actualHarvestDate", "actual_yield": "actualYield", "actual_yield_unit": "actualYieldUnit",
		"client_id": "clientId", "created_at": "createdAt", "updated_at": "updatedAt",
	} {
		if value, ok := m[from]; ok {
			m[to] = value
			delete(m, from)
		}
	}
	return m, nil
}
func (s *Server) plantingGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	id := chi.URLParam(r, "plantingId")
	var farm string
	err := s.DB.QueryRow(r.Context(), `select farm_id::text from plantings where id=$1`, id).Scan(&farm)
	if err != nil {
		Error(w, r, notFound(""))
		return
	}
	if _, e = s.getFarmForUser(r.Context(), u, farm, "read"); e != nil {
		Error(w, r, e)
		return
	}
	p, e := s.plantingJSON(r.Context(), id)
	if e != nil {
		Error(w, r, e)
		return
	}
	JSON(w, map[string]interface{}{"planting": p}, 200)
}
func (s *Server) plantingPatch(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	id := chi.URLParam(r, "plantingId")
	var farm, curDate string
	var curVer int
	err := s.DB.QueryRow(r.Context(), `select farm_id::text,planting_date::text,version from plantings where id=$1`, id).Scan(&farm, &curDate, &curVer)
	if err != nil {
		Error(w, r, notFound(""))
		return
	}
	if _, e = s.getFarmForUser(r.Context(), u, farm, "write"); e != nil {
		Error(w, r, e)
		return
	}
	var b map[string]interface{}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	ver, ok := b["version"].(float64)
	if !ok {
		Error(w, r, badRequest("Version is required"))
		return
	}
	if int(ver) != curVer {
		Error(w, r, conflict("The planting has changed.", map[string]interface{}{"current": curVer}))
		return
	}
	cols := map[string]string{"cropId": "crop_id", "varietyId": "variety_id", "plantingDate": "planting_date", "plantedArea": "planted_area", "areaUnit": "area_unit", "season": "season", "irrigation": "irrigation", "status": "status", "notes": "notes", "actualHarvestDate": "actual_harvest_date", "actualYield": "actual_yield", "actualYieldUnit": "actual_yield_unit"}
	for k, col := range cols {
		if v, ok := b[k]; ok {
			_, _ = s.DB.Exec(r.Context(), "update plantings set "+col+"=$1,version=version+1,updated_at=$2 where id=$3", v, time.Now(), id)
		}
	}
	p, _ := s.plantingJSON(r.Context(), id)
	JSON(w, map[string]interface{}{"planting": p}, 200)
}
func (s *Server) plantingDelete(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	id := chi.URLParam(r, "plantingId")
	var farm string
	if err := s.DB.QueryRow(r.Context(), `select farm_id::text from plantings where id=$1`, id).Scan(&farm); err != nil {
		Error(w, r, notFound(""))
		return
	}
	if _, e = s.getFarmForUser(r.Context(), u, farm, "write"); e != nil {
		Error(w, r, e)
		return
	}
	_, _ = s.DB.Exec(r.Context(), `delete from plantings where id=$1`, id)
	JSON(w, nil, 204)
}
