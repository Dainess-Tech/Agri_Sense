package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

func csvResponse(w http.ResponseWriter, name, title string, headers []string, rows [][]interface{}) {
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`.csv"`)
	fmt.Fprintf(w, "# %s\n", title)
	fmt.Fprintln(w, strings.Join(headers, ","))
	for _, row := range rows {
		parts := []string{}
		for _, v := range row {
			parts = append(parts, fmt.Sprintf("%v", v))
		}
		fmt.Fprintln(w, strings.Join(parts, ","))
	}
}
func (s *Server) reportGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	fid := chi.URLParam(r, "farmId")
	f, e := s.getFarmForUser(r.Context(), u, fid, "read")
	if e != nil {
		Error(w, r, e)
		return
	}
	typ := r.URL.Query().Get("type")
	if typ == "" {
		typ = "summary"
	}
	slug := strings.ToLower(f["name"].(string))
	slug = strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		return '-'
	}, slug)
	switch typ {
	case "summary":
		plantings := []interface{}{}
		pRows, err := s.DB.Query(r.Context(), `select p.id::text,c.name,v.name,p.planting_date::text,p.planted_area::text,p.area_unit,p.season,p.status,p.actual_yield::text,p.actual_yield_unit
			from plantings p join crops c on c.id=p.crop_id left join crop_varieties v on v.id=p.variety_id
			where p.farm_id=$1 order by p.planting_date desc`, fid)
		if err == nil {
			defer pRows.Close()
			for pRows.Next() {
				var id, crop, plantingDate, plantedArea, areaUnit, status string
				var variety, season, actualYield, yieldUnit interface{}
				if pRows.Scan(&id, &crop, &variety, &plantingDate, &plantedArea, &areaUnit, &season, &status, &actualYield, &yieldUnit) == nil {
					plantings = append(plantings, map[string]interface{}{
						"id": id, "cropName": crop, "varietyName": nilIfEmpty(variety),
						"plantingDate": plantingDate, "plantedArea": plantedArea, "areaUnit": areaUnit,
						"season": nilIfEmpty(season), "status": status,
						"actualYield": nilIfEmpty(actualYield), "actualYieldUnit": nilIfEmpty(yieldUnit),
					})
				}
			}
		}

		predictions := []interface{}{}
		prRows, err := s.DB.Query(r.Context(), `select id::text,crop_name,yield_min::text,yield_max::text,yield_unit,total_min::text,total_max::text,total_unit,harvest_start::text,harvest_end::text,data_quality_score,method_version,created_at
			from predictions where farm_id=$1 order by created_at desc`, fid)
		if err == nil {
			defer prRows.Close()
			for prRows.Next() {
				var id, crop, ymin, ymax, yunit, tmin, tmax, tunit, hstart, hend, method string
				var quality int
				var created time.Time
				if prRows.Scan(&id, &crop, &ymin, &ymax, &yunit, &tmin, &tmax, &tunit, &hstart, &hend, &quality, &method, &created) == nil {
					predictions = append(predictions, map[string]interface{}{
						"id": id, "cropName": crop, "yieldMin": ymin, "yieldMax": ymax, "yieldUnit": yunit,
						"totalMin": tmin, "totalMax": tmax, "totalUnit": tunit,
						"harvestStart": hstart, "harvestEnd": hend, "dataQualityScore": quality,
						"methodVersion": method, "createdAt": created,
					})
				}
			}
		}

		risks := []interface{}{}
		rRows, err := s.DB.Query(r.Context(), `select id::text,category,severity::text,title,active,detected_at
			from farm_risks where farm_id=$1 order by detected_at desc limit 12`, fid)
		if err == nil {
			defer rRows.Close()
			for rRows.Next() {
				var id, category, severity, title string
				var active bool
				var detected time.Time
				if rRows.Scan(&id, &category, &severity, &title, &active, &detected) == nil {
					risks = append(risks, map[string]interface{}{
						"id": id, "category": category, "severity": severity, "title": title,
						"active": active, "detectedAt": detected,
					})
				}
			}
		}

		recommendations := []interface{}{}
		recRows, err := s.DB.Query(r.Context(), `select id::text,title,status,severity::text,requires_expert
			from recommendations where farm_id=$1 order by created_at desc limit 200`, fid)
		if err == nil {
			defer recRows.Close()
			for recRows.Next() {
				var id, title, status, severity string
				var requiresExpert bool
				if recRows.Scan(&id, &title, &status, &severity, &requiresExpert) == nil {
					recommendations = append(recommendations, map[string]interface{}{
						"id": id, "title": title, "status": status,
						"severity": severity, "requiresExpert": requiresExpert,
					})
				}
			}
		}

		devices := []interface{}{}
		dRows, err := s.DB.Query(r.Context(), `select name,device_uid,last_seen_at from iot_devices where farm_id=$1 order by name`, fid)
		if err == nil {
			defer dRows.Close()
			for dRows.Next() {
				var name, uid string
				var lastSeen interface{}
				if dRows.Scan(&name, &uid, &lastSeen) == nil {
					devices = append(devices, map[string]interface{}{"name": name, "uid": uid, "lastSeenAt": nilIfEmpty(lastSeen)})
				}
			}
		}

		soil := map[string]interface{}{"available": false}
		if lat, e1 := strconv.ParseFloat(fmt.Sprint(f["latitude"]), 64); e1 == nil {
			if lng, e2 := strconv.ParseFloat(fmt.Sprint(f["longitude"]), 64); e2 == nil {
				if profile, e3 := s.soilProfile(lat, lng); e3 == nil {
					if outer, ok := profile.(map[string]interface{}); ok {
						if row, ok := outer["soil"].(map[string]interface{}); ok {
							soil = row
						}
					}
				}
			}
		}
		JSON(w, map[string]interface{}{
			"generatedAt": time.Now(), "farm": f,
			"plantings": plantings, "predictions": predictions, "risks": risks,
			"recommendations": recommendations, "latestReadings": s.latestReadings(r, fid),
			"devices": devices, "soil": soil,
		}, 200)
	case "readings":
		from := r.URL.Query().Get("from")
		to := r.URL.Query().Get("to")
		if from == "" {
			from = time.Now().AddDate(0, 0, -30).Format("2006-01-02")
		}
		if to == "" {
			to = time.Now().Format("2006-01-02")
		}
		if _, ok := dateOnly(from); !ok {
			Error(w, r, badRequest("Invalid report date"))
			return
		}
		if _, ok := dateOnly(to); !ok {
			Error(w, r, badRequest("Invalid report date"))
			return
		}
		rows, _ := s.DB.Query(r.Context(), `select measured_at,received_at,device_id::text,sensor_type,value::text,unit,quality::text,quality_note from sensor_readings where farm_id=$1 and measured_at>= $2::date and measured_at<($3::date+1) order by measured_at limit 100000`, fid, from, to)
		defer rows.Close()
		data := [][]interface{}{}
		for rows.Next() {
			var vals [8]interface{}
			rows.Scan(&vals[0], &vals[1], &vals[2], &vals[3], &vals[4], &vals[5], &vals[6], &vals[7])
			data = append(data, vals[:])
		}
		csvResponse(w, slug+"-sensor-readings", "sensor readings", []string{"measured_at_utc", "received_at_utc", "device", "sensor_type", "value", "unit", "quality", "quality_note"}, data)
	case "plantings":
		rows, _ := s.DB.Query(r.Context(), `select c.name,v.name,p.season,p.planting_date,p.planted_area,p.area_unit,p.irrigation,p.status,p.actual_harvest_date,p.actual_yield,p.actual_yield_unit from plantings p join crops c on c.id=p.crop_id left join crop_varieties v on v.id=p.variety_id where p.farm_id=$1 order by p.planting_date`, fid)
		defer rows.Close()
		data := [][]interface{}{}
		for rows.Next() {
			var vals [11]interface{}
			rows.Scan(&vals[0], &vals[1], &vals[2], &vals[3], &vals[4], &vals[5], &vals[6], &vals[7], &vals[8], &vals[9], &vals[10])
			data = append(data, vals[:])
		}
		csvResponse(w, slug+"-plantings", "planting records", []string{"crop", "variety", "season", "planting_date", "planted_area", "area_unit", "irrigation", "status", "actual_harvest_date", "actual_yield", "yield_unit"}, data)
	case "predictions":
		rows, _ := s.DB.Query(r.Context(), `select created_at,crop_name,yield_min,yield_max,yield_unit,total_min,total_max,total_unit,harvest_start,harvest_end,data_quality_score,method_version from predictions where farm_id=$1 order by created_at`, fid)
		defer rows.Close()
		data := [][]interface{}{}
		for rows.Next() {
			var vals [12]interface{}
			rows.Scan(&vals[0], &vals[1], &vals[2], &vals[3], &vals[4], &vals[5], &vals[6], &vals[7], &vals[8], &vals[9], &vals[10], &vals[11])
			data = append(data, vals[:])
		}
		csvResponse(w, slug+"-predictions", "yield predictions", []string{"generated_at_utc", "crop", "yield_min", "yield_max", "yield_unit", "total_min", "total_max", "total_unit", "harvest_start", "harvest_end", "data_quality_score", "method_version"}, data)
	case "weather":
		days := atoi(r.URL.Query().Get("days"), 90)
		if days < 1 {
			days = 1
		}
		if days > 365 {
			days = 365
		}
		lat, _ := strconv.ParseFloat(f["latitude"].(string), 64)
		lng, _ := strconv.ParseFloat(f["longitude"].(string), 64)
		h, e := s.weatherHistory(lat, lng, days)
		if e != nil {
			Error(w, r, &APIError{503, "provider_unavailable", "Weather provider unavailable: " + e.Error(), nil})
			return
		}
		JSON(w, h, 200)
	default:
		Error(w, r, notFound("Unknown report type"))
	}
}
func (s *Server) geoGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q != "" {
		if err := rateLimit("geo:"+u.ID, 1, 1100*time.Millisecond); err != nil {
			Error(w, r, err)
			return
		}
		params := url.Values{"format": {"jsonv2"}, "limit": {"5"}, "q": {q}}
		req, _ := http.NewRequest("GET", "https://nominatim.openstreetmap.org/search?"+params.Encode(), nil)
		req.Header.Set("User-Agent", "AgriSense/1.0 ("+s.appURL(r)+")")
		req.Header.Set("Accept-Language", "en")
		resp, e := http.DefaultClient.Do(req)
		if e != nil || resp.StatusCode != 200 {
			if resp != nil {
				resp.Body.Close()
			}
			Error(w, r, &APIError{503, "provider_unavailable", "Place search is unavailable right now. Enter coordinates manually.", nil})
			return
		}
		defer resp.Body.Close()
		var data []struct {
			DisplayName string `json:"display_name"`
			Lat         string `json:"lat"`
			Lon         string `json:"lon"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
			Error(w, r, err)
			return
		}
		out := []interface{}{}
		for _, d := range data {
			lat, _ := strconv.ParseFloat(d.Lat, 64)
			lng, _ := strconv.ParseFloat(d.Lon, 64)
			out = append(out, map[string]interface{}{"name": d.DisplayName, "latitude": lat, "longitude": lng})
		}
		JSON(w, map[string]interface{}{"results": out, "attribution": "© OpenStreetMap contributors"}, 200)
		return
	}
	latRaw, lngRaw := r.URL.Query().Get("lat"), r.URL.Query().Get("lng")
	lat, e1 := strconv.ParseFloat(latRaw, 64)
	lng, e2 := strconv.ParseFloat(lngRaw, 64)
	if e1 != nil || e2 != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		Error(w, r, validation("Provide q, or valid lat and lng", nil))
		return
	}
	resp, e := http.Get("https://api.open-meteo.com/v1/elevation?latitude=" + strconv.FormatFloat(lat, 'f', 6, 64) + "&longitude=" + strconv.FormatFloat(lng, 'f', 6, 64))
	if e != nil || resp.StatusCode != 200 {
		if resp != nil {
			resp.Body.Close()
		}
		Error(w, r, &APIError{503, "provider_unavailable", "Elevation service unavailable", nil})
		return
	}
	defer resp.Body.Close()
	var data struct {
		Elevation []float64 `json:"elevation"`
	}
	json.NewDecoder(resp.Body).Decode(&data)
	var elevation interface{}
	if len(data.Elevation) > 0 {
		elevation = data.Elevation[0]
	}
	JSON(w, map[string]interface{}{"elevationM": elevation, "provider": "Open-Meteo Elevation (Copernicus DEM GLO-90)", "dataType": "modelled"}, 200)
}
