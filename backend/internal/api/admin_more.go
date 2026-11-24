package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

var riskThresholdDefaults = map[string]interface{}{
	"forecastWindowDays": 7, "heavyRain7dMediumMm": 100, "heavyRain7dHighMm": 150,
	"heavyRainSingleDayMm": 50, "droughtPast14dMm": 10, "droughtNext7dMm": 10,
	"waterloggingMoistureMargin": 10, "waterloggingClayPct": 45, "waterloggingRain7dMm": 80,
	"minSensorSamples": 3, "phMediumMargin": 0.5, "phHighMargin": 1.5,
}

func effectiveRiskThresholds(raw interface{}) map[string]interface{} {
	effective := make(map[string]interface{}, len(riskThresholdDefaults))
	for key, value := range riskThresholdDefaults {
		effective[key] = value
	}
	if overrides, ok := raw.(map[string]interface{}); ok {
		for key, value := range overrides {
			if _, supported := riskThresholdDefaults[key]; supported {
				effective[key] = value
			}
		}
	}
	return effective
}

func thresholdNumber(value interface{}) (float64, bool) {
	switch number := value.(type) {
	case float64:
		return number, true
	case int:
		return float64(number), true
	default:
		return 0, false
	}
}

var cropRangePairs = [][2]string{
	{"baseYieldMin", "baseYieldMax"}, {"maturityDaysMin", "maturityDaysMax"},
	{"tempOptMin", "tempOptMax"}, {"tempCriticalLow", "tempCriticalHigh"},
	{"waterNeedMinMm", "waterNeedMaxMm"}, {"soilMoistureMin", "soilMoistureMax"},
	{"phMin", "phMax"},
}

func checkCropRanges(current, patch map[string]interface{}) error {
	for _, pair := range cropRangePairs {
		lower, lowerOK := patch[pair[0]].(float64)
		if !lowerOK {
			lower, lowerOK = current[pair[0]].(float64)
		}
		upper, upperOK := patch[pair[1]].(float64)
		if !upperOK {
			upper, upperOK = current[pair[1]].(float64)
		}
		if lowerOK && upperOK && lower > upper {
			return badRequest(fmt.Sprintf("%s (%v) must not exceed %s (%v)", pair[0], lower, pair[1], upper))
		}
	}
	return nil
}

func riskThresholdOverride(value interface{}) (map[string]interface{}, error) {
	override, ok := value.(map[string]interface{})
	if !ok || len(override) == 0 {
		return nil, badRequest("Setting value must be a non-empty JSON object")
	}
	effective := effectiveRiskThresholds(map[string]interface{}{})
	integerKeys := map[string]bool{"forecastWindowDays": true, "minSensorSamples": true}
	for key, raw := range override {
		minimum := map[string]float64{
			"forecastWindowDays": 1, "heavyRain7dMediumMm": 1, "heavyRain7dHighMm": 1,
			"heavyRainSingleDayMm": 1, "droughtPast14dMm": 0, "droughtNext7dMm": 0,
			"waterloggingMoistureMargin": 0, "waterloggingClayPct": 0, "waterloggingRain7dMm": 1,
			"minSensorSamples": 1, "phMediumMargin": 0, "phHighMargin": 0,
		}[key]
		if _, supported := riskThresholdDefaults[key]; !supported {
			return nil, badRequest("No recognised risk threshold fields supplied")
		}
		number, ok := raw.(float64)
		if !ok || number < minimum || (integerKeys[key] && number != float64(int(number))) {
			return nil, badRequest("Invalid risk thresholds")
		}
		maximum := map[string]float64{
			"forecastWindowDays": 30, "heavyRain7dMediumMm": 1000, "heavyRain7dHighMm": 2000,
			"heavyRainSingleDayMm": 500, "droughtPast14dMm": 500, "droughtNext7dMm": 500,
			"waterloggingMoistureMargin": 50, "waterloggingClayPct": 100, "waterloggingRain7dMm": 1000,
			"minSensorSamples": 100, "phMediumMargin": 5, "phHighMargin": 5,
		}[key]
		if number > maximum {
			return nil, badRequest("Invalid risk thresholds")
		}
		effective[key] = number
	}
	highRain, _ := thresholdNumber(effective["heavyRain7dHighMm"])
	mediumRain, _ := thresholdNumber(effective["heavyRain7dMediumMm"])
	if highRain < mediumRain {
		effective["heavyRain7dHighMm"] = effective["heavyRain7dMediumMm"]
	}
	highPH, _ := thresholdNumber(effective["phHighMargin"])
	mediumPH, _ := thresholdNumber(effective["phMediumMargin"])
	if highPH < mediumPH {
		effective["phHighMargin"] = effective["phMediumMargin"]
	}
	return override, nil
}

func (s *Server) audit(actor, action, entity, entityID string, meta interface{}) {
	_, _ = s.DB.Exec(context.Background(), `insert into audit_logs(actor_id,action,entity,entity_id,meta) values(nullif($1,''),$2,$3,nullif($4,''),$5)`, actor, action, entity, entityID, meta)
}

func (s *Server) adminPatch(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireAdmin(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	section := chi.URLParam(r, "section")
	var b map[string]interface{}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	switch section {
	case "users":
		id, _ := b["userId"].(string)
		role, _ := b["role"].(string)
		if id == u.ID && role != "admin" {
			Error(w, r, badRequest("You cannot remove your own admin role."))
			return
		}
		tag, err := s.DB.Exec(r.Context(), `update users set role=$1,updated_at=$2 where id=$3`, role, time.Now(), id)
		if err != nil {
			Error(w, r, err)
			return
		}
		if tag.RowsAffected() == 0 {
			Error(w, r, notFound("User not found"))
			return
		}
		s.audit(u.ID, "admin.user_role", "user", id, b)
		JSON(w, map[string]interface{}{"user": map[string]interface{}{"id": id, "role": role}}, 200)
	case "crops":
		id, _ := b["cropId"].(string)
		var current map[string]interface{}
		var currentRaw []byte
		if err := s.DB.QueryRow(r.Context(), `select row_to_json(c)::text from crops c where id=$1`, id).Scan(&currentRaw); err != nil {
			Error(w, r, notFound("Crop not found"))
			return
		}
		if err := json.Unmarshal(currentRaw, &current); err != nil {
			Error(w, r, err)
			return
		}
		if err := checkCropRanges(current, b); err != nil {
			Error(w, r, err)
			return
		}
		cols := map[string]string{"name": "name", "scientificName": "scientific_name", "yieldUnit": "yield_unit", "baseYieldMin": "base_yield_min", "baseYieldMax": "base_yield_max", "maturityDaysMin": "maturity_days_min", "maturityDaysMax": "maturity_days_max", "baseTempC": "base_temp_c", "gddToMaturity": "gdd_to_maturity", "tempOptMin": "temp_opt_min", "tempOptMax": "temp_opt_max", "tempCriticalLow": "temp_critical_low", "tempCriticalHigh": "temp_critical_high", "waterNeedMinMm": "water_need_min_mm", "waterNeedMaxMm": "water_need_max_mm", "soilMoistureMin": "soil_moisture_min", "soilMoistureMax": "soil_moisture_max", "phMin": "ph_min", "phMax": "ph_max", "active": "active"}
		for k, col := range cols {
			if v, ok := b[k]; ok {
				_, _ = s.DB.Exec(r.Context(), "update crops set "+col+"=$1,updated_at=$2 where id=$3", v, time.Now(), id)
			}
		}
		var raw []byte
		err := s.DB.QueryRow(r.Context(), `select row_to_json(c)::text from crops c where id=$1`, id).Scan(&raw)
		if err != nil {
			Error(w, r, notFound("Crop not found"))
			return
		}
		var crop interface{}
		json.Unmarshal(raw, &crop)
		s.audit(u.ID, "admin.crop_update", "crop", id, b)
		JSON(w, map[string]interface{}{"crop": crop}, 200)
	case "varieties":
		id, _ := b["varietyId"].(string)
		cols := map[string]string{"name": "name", "maturityFactor": "maturity_factor", "yieldFactor": "yield_factor", "notes": "notes"}
		for k, col := range cols {
			if v, ok := b[k]; ok {
				_, _ = s.DB.Exec(r.Context(), "update crop_varieties set "+col+"=$1 where id=$2", v, id)
			}
		}
		var raw []byte
		err := s.DB.QueryRow(r.Context(), `select row_to_json(v)::text from crop_varieties v where id=$1`, id).Scan(&raw)
		if err != nil {
			Error(w, r, notFound("Variety not found"))
			return
		}
		var v interface{}
		json.Unmarshal(raw, &v)
		s.audit(u.ID, "admin.variety_update", "crop_variety", id, b)
		JSON(w, map[string]interface{}{"variety": v}, 200)
	case "settings":
		key, _ := b["key"].(string)
		value, err := riskThresholdOverride(b["value"])
		if err != nil {
			Error(w, r, err)
			return
		}
		if key != "risk_thresholds" {
			Error(w, r, badRequest("Unknown setting \""+key+"\""))
			return
		}
		_, err = s.DB.Exec(r.Context(), `insert into system_settings(key,value,updated_at) values($1,$2,$3) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at`, key, value, time.Now())
		if err != nil {
			Error(w, r, err)
			return
		}
		var raw interface{}
		err = s.DB.QueryRow(r.Context(), `select value from system_settings where key=$1`, key).Scan(&raw)
		if err != nil {
			Error(w, r, err)
			return
		}
		s.audit(u.ID, "admin.setting_update", "system_setting", key, b)
		JSON(w, map[string]interface{}{"setting": map[string]interface{}{"key": key, "value": raw}}, 200)
	default:
		Error(w, r, notFound(""))
	}
}
func (s *Server) adminPost(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireAdmin(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	section := chi.URLParam(r, "section")
	var b map[string]interface{}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	switch section {
	case "maintenance":
		action, _ := b["action"].(string)
		if action != "retention" {
			Error(w, r, badRequest("Invalid maintenance action"))
			return
		}
		days := 365
		if f, ok := b["readingsDays"].(float64); ok {
			days = int(f)
		}
		deleted := s.retention(r, days)
		s.audit(u.ID, "admin.retention", "system", "", deleted)
		JSON(w, map[string]interface{}{"result": map[string]interface{}{"ranAt": time.Now(), "readingsDays": days, "deleted": deleted}}, 200)
	case "announcements":
		title, _ := b["title"].(string)
		body, _ := b["body"].(string)
		rows, _ := s.DB.Query(r.Context(), `select id::text from users`)
		defer rows.Close()
		count := 0
		for rows.Next() {
			var uid string
			rows.Scan(&uid)
			_, _ = s.DB.Exec(r.Context(), `insert into notifications(user_id,type,severity,title,body) values($1,'system','info',$2,$3)`, uid, title, body)
			count++
		}
		s.audit(u.ID, "admin.announcement", "notification", "", map[string]int{"recipients": count})
		JSON(w, map[string]int{"sent": count}, 201)
	case "varieties":
		crop, _ := b["cropId"].(string)
		name, _ := b["name"].(string)
		mf := 1.0
		if f, ok := b["maturityFactor"].(float64); ok {
			mf = f
		}
		yf := 1.0
		if f, ok := b["yieldFactor"].(float64); ok {
			yf = f
		}
		var id string
		err := s.DB.QueryRow(r.Context(), `insert into crop_varieties(crop_id,name,maturity_factor,yield_factor,notes) values($1,$2,$3,$4,$5) returning id::text`, crop, name, mf, yf, b["notes"]).Scan(&id)
		if err != nil {
			Error(w, r, err)
			return
		}
		s.audit(u.ID, "admin.variety_create", "crop_variety", id, b)
		JSON(w, map[string]interface{}{"variety": map[string]interface{}{"id": id, "name": name}}, 201)
	case "crops":
		slug, _ := b["slug"].(string)
		name, _ := b["name"].(string)
		if slug == "" || !strings.HasPrefix(slug, "") || strings.Contains(slug, " ") {
			Error(w, r, badRequest("Invalid crop slug"))
			return
		}
		if err := checkCropRanges(nil, b); err != nil {
			Error(w, r, err)
			return
		}
		var id string
		err := s.DB.QueryRow(r.Context(), `insert into crops(slug,name,yield_unit,base_yield_min,base_yield_max,maturity_days_min,maturity_days_max,base_temp_c,gdd_to_maturity,temp_opt_min,temp_opt_max,temp_critical_low,temp_critical_high,water_need_min_mm,water_need_max_mm,soil_moisture_min,soil_moisture_max,ph_min,ph_max)
			values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id::text`,
			slug, name, b["yieldUnit"], b["baseYieldMin"], b["baseYieldMax"], b["maturityDaysMin"], b["maturityDaysMax"], b["baseTempC"], b["gddToMaturity"], b["tempOptMin"], b["tempOptMax"], b["tempCriticalLow"], b["tempCriticalHigh"], b["waterNeedMinMm"], b["waterNeedMaxMm"], b["soilMoistureMin"], b["soilMoistureMax"], b["phMin"], b["phMax"]).Scan(&id)
		if err != nil {
			Error(w, r, err)
			return
		}
		s.audit(u.ID, "admin.crop_create", "crop", id, b)
		JSON(w, map[string]interface{}{"crop": map[string]interface{}{"id": id, "slug": slug, "name": name}}, 201)
	default:
		Error(w, r, notFound(""))
	}
}
func (s *Server) adminDelete(w http.ResponseWriter, r *http.Request) {
	u, e := s.requireAdmin(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	section := chi.URLParam(r, "section")
	if section == "settings" {
		key := r.URL.Query().Get("key")
		if key != "risk_thresholds" {
			Error(w, r, badRequest("Unknown setting \""+key+"\""))
			return
		}
		_, _ = s.DB.Exec(r.Context(), `delete from system_settings where key=$1`, key)
		JSON(w, map[string]interface{}{"setting": map[string]interface{}{"key": key, "value": nil}}, 200)
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		Error(w, r, badRequest("id is required"))
		return
	}
	if section == "crops" {
		tag, err := s.DB.Exec(r.Context(), `update crops set active=false,updated_at=$1 where id=$2`, time.Now(), id)
		if err != nil {
			Error(w, r, err)
			return
		}
		if tag.RowsAffected() == 0 {
			Error(w, r, notFound("Crop not found"))
			return
		}
		s.audit(u.ID, "admin.crop_deactivate", "crop", id, nil)
		JSON(w, map[string]interface{}{"crop": map[string]interface{}{"id": id, "active": false}}, 200)
		return
	}
	if section == "varieties" {
		tag, err := s.DB.Exec(r.Context(), `delete from crop_varieties where id=$1`, id)
		if err != nil {
			Error(w, r, err)
			return
		}
		if tag.RowsAffected() == 0 {
			Error(w, r, notFound("Variety not found"))
			return
		}
		s.audit(u.ID, "admin.variety_delete", "crop_variety", id, nil)
		JSON(w, map[string]interface{}{"variety": map[string]interface{}{"id": id}}, 200)
		return
	}
	Error(w, r, notFound(""))
}
