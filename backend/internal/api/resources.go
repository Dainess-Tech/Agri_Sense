package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

func (s *Server) farmResourceGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	fid := chi.URLParam(r, "farmId")
	resource := chi.URLParam(r, "resource")
	f, e := s.getFarmForUser(r.Context(), u, fid, "read")
	if e != nil {
		Error(w, r, e)
		return
	}
	lat, _ := strconv.ParseFloat(f["latitude"].(string), 64)
	lng, _ := strconv.ParseFloat(f["longitude"].(string), 64)
	switch resource {
	case "weather":
		history := atoi(r.URL.Query().Get("historyDays"), 0)
		if history > 0 {
			h, e := s.weatherHistory(lat, lng, history)
			if e != nil {
				Error(w, r, &APIError{503, "provider_unavailable", "Weather provider unavailable: " + e.Error(), nil})
				return
			}
			JSON(w, h, 200)
			return
		}
		h, e := s.weatherForecast(lat, lng)
		if e != nil {
			Error(w, r, &APIError{503, "provider_unavailable", "Weather provider unavailable: " + e.Error(), nil})
			return
		}
		JSON(w, h, 200)
	case "soil":
		h, e := s.soilProfile(lat, lng)
		if e != nil {
			Error(w, r, &APIError{503, "provider_unavailable", "Soil data provider unavailable: " + e.Error(), nil})
			return
		}
		JSON(w, h, 200)
	case "risks":
		rows, err := s.DB.Query(r.Context(), `select id::text,farm_id::text,planting_id::text,category,severity::text,title,explanation,source,dedupe_key,active,detected_at,last_seen_at,resolved_at from farm_risks where farm_id=$1 order by detected_at desc limit 200`, fid)
		if err != nil {
			Error(w, r, err)
			return
		}
		defer rows.Close()
		out := []interface{}{}
		for rows.Next() {
			var id, farm, plant, category, severity, title, explanation, source, dedupe string
			var active bool
			var detected, last, resolved interface{}
			if rows.Scan(&id, &farm, &plant, &category, &severity, &title, &explanation, &source, &dedupe, &active, &detected, &last, &resolved) == nil {
				if r.URL.Query().Get("history") != "1" && !active {
					continue
				}
				out = append(out, map[string]interface{}{"id": id, "farmId": farm, "plantingId": nilIfText(plant), "category": category, "severity": severity, "title": title, "explanation": explanation, "source": source, "dedupeKey": dedupe, "active": active, "detectedAt": detected, "lastSeenAt": last, "resolvedAt": resolved})
			}
		}
		JSON(w, map[string]interface{}{"risks": out}, 200)
	case "recommendations":
		status := r.URL.Query().Get("status")
		rows, err := s.DB.Query(r.Context(), `select id::text,planting_id::text,title,body,reason,severity::text,requires_expert,status,created_at,updated_at from recommendations where farm_id=$1 and ($2='' or status=$2) order by created_at desc limit 200`, fid, status)
		if err != nil {
			Error(w, r, err)
			return
		}
		defer rows.Close()
		out := []interface{}{}
		for rows.Next() {
			var id, plant, title, body, reason, severity, status string
			var expert bool
			var created, updated time.Time
			if rows.Scan(&id, &plant, &title, &body, &reason, &severity, &expert, &status, &created, &updated) == nil {
				out = append(out, map[string]interface{}{"id": id, "farmId": fid, "plantingId": nilIfText(plant), "title": title, "body": body, "reason": reason, "severity": severity, "requiresExpert": expert, "status": status, "createdAt": created, "updatedAt": updated, "farmName": f["name"]})
			}
		}
		JSON(w, map[string]interface{}{"recommendations": out}, 200)
	case "activities":
		limit, offset, page := page(r, 30, 100)
		rows, err := s.DB.Query(r.Context(), `select a.id::text,a.type,a.description,a.occurred_at,a.created_at,u.full_name,a.planting_id::text from farm_activities a left join users u on u.id=a.user_id where a.farm_id=$1 order by a.occurred_at desc limit $2 offset $3`, fid, limit, offset)
		if err != nil {
			Error(w, r, err)
			return
		}
		defer rows.Close()
		out := []interface{}{}
		for rows.Next() {
			var id, typ, desc string
			var occurred, created time.Time
			var user interface{}
			var plant interface{}
			rows.Scan(&id, &typ, &desc, &occurred, &created, &user, &plant)
			out = append(out, map[string]interface{}{"id": id, "type": typ, "description": desc, "occurredAt": occurred, "createdAt": created, "userName": user, "plantingId": plant})
		}
		JSON(w, map[string]interface{}{"activities": out, "page": page, "limit": limit}, 200)
	case "readings":
		sensor := r.URL.Query().Get("sensorType")
		if sensor == " " || sensor == "" {
			h := s.latestReadings(r, fid)
			JSON(w, map[string]interface{}{"latest": h}, 200)
			return
		}
		hours := atoi(r.URL.Query().Get("hours"), 24)
		if hours < 1 {
			hours = 1
		}
		if hours > 2160 {
			hours = 2160
		}
		bucket := 15
		if hours > 24 {
			bucket = 60
		}
		if hours > 72 {
			bucket = 180
		}
		rows, err := s.DB.Query(r.Context(), `select to_timestamp(floor(extract(epoch from measured_at)/($2*60))*$2*60) t,avg(value::float) v from sensor_readings where farm_id=$1 and sensor_type=$3 and quality='valid' and measured_at>now()-make_interval(hours=>$4) group by 1 order by 1`, fid, bucket, sensor, hours)
		if err != nil {
			Error(w, r, err)
			return
		}
		defer rows.Close()
		out := []interface{}{}
		for rows.Next() {
			var t time.Time
			var v float64
			rows.Scan(&t, &v)
			out = append(out, map[string]interface{}{"t": t, "v": v})
		}
		JSON(w, map[string]interface{}{"sensorType": sensor, "hours": hours, "series": out}, 200)
	case "predictions":
		rows, err := s.DB.Query(r.Context(), `select row_to_json(p)::text from predictions p where farm_id=$1 order by created_at desc limit 100`, fid)
		if err != nil {
			Error(w, r, err)
			return
		}
		defer rows.Close()
		out := []interface{}{}
		for rows.Next() {
			var raw []byte
			rows.Scan(&raw)
			var m interface{}
			json.Unmarshal(raw, &m)
			out = append(out, m)
		}
		JSON(w, map[string]interface{}{"predictions": out}, 200)
	case "summary":
		var plantings, devices, readings int
		s.DB.QueryRow(r.Context(), `select (select count(*) from plantings where farm_id=$1),(select count(*) from iot_devices where farm_id=$1),(select count(*) from sensor_readings where farm_id=$1)`, fid).Scan(&plantings, &devices, &readings)
		JSON(w, map[string]interface{}{"stats": map[string]int{"plantings": plantings, "devices": devices, "readings": readings}}, 200)
	default:
		Error(w, r, notFound(""))
	}
}
func (s *Server) farmResourcePost(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	if chi.URLParam(r, "resource") != "activities" {
		Error(w, r, notFound(""))
		return
	}
	fid := chi.URLParam(r, "farmId")
	if _, e = s.getFarmForUser(r.Context(), u, fid, "write"); e != nil {
		Error(w, r, e)
		return
	}
	var b struct {
		Type        string `json:"type"`
		Description string `json:"description"`
		PlantingID  string `json:"plantingId"`
		OccurredAt  string `json:"occurredAt"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	at := time.Now()
	if b.OccurredAt != "" {
		if t, e := time.Parse(time.RFC3339, b.OccurredAt); e == nil {
			at = t
		}
	}
	var id string
	err := s.DB.QueryRow(r.Context(), `insert into farm_activities(farm_id,planting_id,user_id,type,description,occurred_at) values($1,nullif($2::text,'')::uuid,$3,$4,$5,$6) returning id::text`, fid, b.PlantingID, u.ID, b.Type, b.Description, at).Scan(&id)
	if err != nil {
		Error(w, r, err)
		return
	}
	JSON(w, map[string]interface{}{"activity": map[string]interface{}{"id": id, "type": b.Type, "description": b.Description, "occurredAt": at}}, 201)
}
func (s *Server) latestReadings(r *http.Request, fid string) []interface{} {
	rows, _ := s.DB.Query(r.Context(), `select distinct on(sensor_type) sensor_type,value::text,unit,quality::text,quality_note,measured_at,device_id::text from sensor_readings where farm_id=$1 and measured_at>now()-interval '30 days' order by sensor_type,measured_at desc`, fid)
	defer rows.Close()
	out := []interface{}{}
	for rows.Next() {
		var typ, val, unit, quality, dev string
		var note interface{}
		var at time.Time
		rows.Scan(&typ, &val, &unit, &quality, &note, &at, &dev)
		out = append(out, map[string]interface{}{"sensorType": typ, "value": parseFloat(val), "unit": unit, "quality": quality, "qualityNote": note, "measuredAt": at, "deviceId": dev})
	}
	return out
}
func parseFloat(s string) float64 { v, _ := strconv.ParseFloat(s, 64); return v }

type openMeteoDaily struct {
	Time                        []string   `json:"time"`
	Temperature2mMax            []*float64 `json:"temperature_2m_max"`
	Temperature2mMin            []*float64 `json:"temperature_2m_min"`
	PrecipitationSum            []*float64 `json:"precipitation_sum"`
	PrecipitationProbabilityMax []*float64 `json:"precipitation_probability_max"`
}

type openMeteoWeather struct {
	Elevation float64        `json:"elevation"`
	Daily     openMeteoDaily `json:"daily"`
}

func normalizeWeather(raw []byte, provider string, retrievedAt time.Time, cached bool, forecast bool) (map[string]interface{}, error) {
	var payload openMeteoWeather
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode weather response: %w", err)
	}
	if payload.Daily.Time == nil {
		return nil, fmt.Errorf("weather response has no daily time series")
	}

	valueAt := func(values []*float64, index int) *float64 {
		if index >= len(values) {
			return nil
		}
		return values[index]
	}
	today := time.Now().UTC().Format("2006-01-02")
	daily := make([]interface{}, 0, len(payload.Daily.Time))
	for i, date := range payload.Daily.Time {
		kind := "modelled"
		if forecast && date >= today {
			kind = "forecast"
		}
		daily = append(daily, map[string]interface{}{
			"date": date, "tMax": valueAt(payload.Daily.Temperature2mMax, i),
			"tMin":              valueAt(payload.Daily.Temperature2mMin, i),
			"precipMm":          valueAt(payload.Daily.PrecipitationSum, i),
			"precipProbability": valueAt(payload.Daily.PrecipitationProbabilityMax, i),
			"kind":              kind,
		})
	}

	return map[string]interface{}{
		"provider": provider, "retrievedAt": retrievedAt, "cached": cached,
		"stale": false, "elevation": payload.Elevation, "current": nil, "daily": daily,
	}, nil
}

func (s *Server) weatherForecast(lat, lng float64) (interface{}, error) {
	key := fmt.Sprintf("forecast:%.2f:%.2f", lat, lng)
	var payload []byte
	var expires, retrieved time.Time
	err := s.DB.QueryRow(context.Background(), `select payload::text,retrieved_at,expires_at from weather_snapshots where cache_key=$1`, key).Scan(&payload, &retrieved, &expires)
	cached := err == nil && expires.After(time.Now())
	if cached {
		return normalizeWeather(payload, "Open-Meteo forecast", retrieved, true, true)
	}
	params := url.Values{"latitude": {fmt.Sprintf("%.4f", lat)}, "longitude": {fmt.Sprintf("%.4f", lng)}, "past_days": {"14"}, "forecast_days": {"16"}, "daily": {"temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,et0_fao_evapotranspiration"}, "timezone": {"UTC"}}
	resp, e := http.Get("https://api.open-meteo.com/v1/forecast?" + params.Encode())
	if e != nil {
		return nil, e
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Weather provider returned %d", resp.StatusCode)
	}
	body, e := io.ReadAll(resp.Body)
	if e != nil {
		return nil, e
	}
	now := time.Now()
	_, _ = s.DB.Exec(context.Background(), `insert into weather_snapshots(cache_key,kind,provider,latitude,longitude,payload,retrieved_at,expires_at) values($1,'forecast','Open-Meteo',$2,$3,$4,$5,$6) on conflict(cache_key) do update set payload=excluded.payload,retrieved_at=excluded.retrieved_at,expires_at=excluded.expires_at`, key, lat, lng, string(body), now, now.Add(time.Hour))
	return normalizeWeather(body, "Open-Meteo forecast", now, false, true)
}

func (s *Server) weatherHistory(lat, lng float64, days int) (interface{}, error) {
	today := time.Now().UTC().AddDate(0, 0, -6)
	start := today.AddDate(0, 0, -days)
	end := today
	params := url.Values{"latitude": {fmt.Sprintf("%.4f", lat)}, "longitude": {fmt.Sprintf("%.4f", lng)}, "start_date": {start.Format("2006-01-02")}, "end_date": {end.Format("2006-01-02")}, "daily": {"temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,et0_fao_evapotranspiration"}, "timezone": {"UTC"}}
	resp, e := http.Get("https://archive-api.open-meteo.com/v1/archive?" + params.Encode())
	if e != nil {
		return nil, e
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Weather provider returned %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return normalizeWeather(body, "Open-Meteo archive (ERA5)", time.Now(), false, false)
}

func (s *Server) soilProfile(lat, lng float64) (interface{}, error) {
	key := fmt.Sprintf("soil:%.3f:%.3f", lat, lng)
	var raw []byte
	var expires time.Time
	err := s.DB.QueryRow(context.Background(), `select row_to_json(s)::text,expires_at from soil_profiles s where cache_key=$1`, key).Scan(&raw, &expires)
	if err == nil && expires.After(time.Now()) {
		var v interface{}
		json.Unmarshal(raw, &v)
		return map[string]interface{}{"soil": v, "provider": "ISRIC SoilGrids v2.0", "dataType": "modelled", "license": "CC BY 4.0", "stale": false}, nil
	}
	params := url.Values{"lon": {fmt.Sprintf("%.4f", lng)}, "lat": {fmt.Sprintf("%.4f", lat)}, "value": {"mean"}}
	for _, p := range []string{"phh2o", "soc", "nitrogen", "sand", "silt", "clay"} {
		params.Add("property", p)
	}
	for _, d := range []string{"0-5cm", "5-15cm"} {
		params.Add("depth", d)
	}
	resp, e := http.Get("https://rest.isric.org/soilgrids/v2.0/properties/query?" + params.Encode())
	if e != nil {
		if err == nil {
			var v interface{}
			json.Unmarshal(raw, &v)
			return map[string]interface{}{"soil": v, "provider": "ISRIC SoilGrids v2.0", "stale": true}, nil
		}
		return nil, e
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("SoilGrids returned %d", resp.StatusCode)
	}
	var body struct {
		Properties struct {
			Layers []struct {
				Name string `json:"name"`
				Unit struct {
					DFactor float64 `json:"d_factor"`
				} `json:"unit_measure"`
				Depths []struct {
					Label  string `json:"label"`
					Values struct {
						Mean *float64 `json:"mean"`
					} `json:"values"`
				} `json:"depths"`
			} `json:"layers"`
		} `json:"properties"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	get := func(name string) *float64 {
		for _, l := range body.Properties.Layers {
			if l.Name == name {
				var sum float64
				var weight float64
				for _, d := range l.Depths {
					if d.Values.Mean != nil {
						w := float64(10)
						sum += *d.Values.Mean * w
						weight += w
					}
				}
				if weight > 0 {
					v := sum / weight / l.Unit.DFactor
					return &v
				}
			}
		}
		return nil
	}
	pH := get("phh2o")
	soc := get("soc")
	n := get("nitrogen")
	sand := get("sand")
	silt := get("silt")
	clay := get("clay")
	soil := map[string]interface{}{"phH2o": pH, "organicCarbonGKg": soc, "nitrogenGKg": n, "sandPct": sand, "siltPct": silt, "clayPct": clay, "texture": nil, "depth": "0-15cm", "available": pH != nil || soc != nil || n != nil || sand != nil}
	now := time.Now()
	b, _ := json.Marshal(soil)
	_, _ = s.DB.Exec(context.Background(), `insert into soil_profiles(cache_key,provider,latitude,longitude,ph_h2o,organic_carbon_g_kg,nitrogen_g_kg,sand_pct,silt_pct,clay_pct,texture,depth,available,retrieved_at,expires_at) values($1,'ISRIC SoilGrids v2.0',$2,$3,$4,$5,$6,$7,$8,$9,null,'0-15cm',$10,$11,$12) on conflict(cache_key) do update set retrieved_at=excluded.retrieved_at,expires_at=excluded.expires_at`, key, lat, lng, pH, soc, n, sand, silt, clay, soil["available"], now, now.Add(90*24*time.Hour))
	_ = b
	return map[string]interface{}{"soil": soil, "provider": "ISRIC SoilGrids v2.0", "dataType": "modelled", "license": "CC BY 4.0", "stale": false}, nil
}
