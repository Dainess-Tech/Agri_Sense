package api

import (
	"net/http"
	"time"
)

func (s *Server) dashboardGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	rows, err := s.DB.Query(r.Context(), `select id::text,name,latitude::text,longitude::text,size::text,area_unit,archived_at,version from farms where (owner_id=$1 or id in (select farm_id from farm_members where user_id=$1)) and archived_at is null order by created_at`, u.ID)
	if err != nil {
		Error(w, r, err)
		return
	}
	defer rows.Close()
	farms := []interface{}{}
	ids := []string{}
	for rows.Next() {
		var id, name, lat, lng, size, area string
		var archived interface{}
		var version int
		rows.Scan(&id, &name, &lat, &lng, &size, &area, &archived, &version)
		ids = append(ids, id)
		farms = append(farms, map[string]interface{}{"id": id, "name": name, "latitude": lat, "longitude": lng, "size": size, "areaUnit": area, "archivedAt": archived, "version": version})
	}
	var unread int
	_ = s.DB.QueryRow(r.Context(), `select count(*) from notifications where user_id=$1 and read_at is null`, u.ID).Scan(&unread)
	if len(ids) == 0 {
		JSON(w, map[string]interface{}{
			"farms": []interface{}{}, "selectedFarmId": nil,
			"totals":   map[string]int{"farms": 0, "activePlantings": 0, "devices": 0, "devicesOnline": 0, "activeRisks": 0, "unread": unread},
			"selected": nil,
		}, 200)
		return
	}
	requested := r.URL.Query().Get("farmId")
	selected := ids[0]
	for _, id := range ids {
		if id == requested {
			selected = id
		}
	}
	selectedFarm, err := s.getFarmForUser(r.Context(), u, selected, "read")
	if err != nil {
		Error(w, r, err)
		return
	}
	var activePlantings, devices, online, risks int
	_ = s.DB.QueryRow(r.Context(), `select (select count(*) from plantings where farm_id=any($1::uuid[]) and status not in ('planned','harvested','failed')),(select count(*) from iot_devices where farm_id=any($1::uuid[])),(select count(*) from farm_risks where farm_id=any($1::uuid[]) and active=true)`, ids).Scan(&activePlantings, &devices, &risks)
	pRows, _ := s.DB.Query(r.Context(), `select p.id::text,p.crop_id::text,p.status::text,p.planting_date::text,c.name,p.planted_area::text from plantings p join crops c on c.id=p.crop_id where p.farm_id=$1 and p.status not in ('planned','harvested','failed') order by p.planting_date desc`, selected)
	defer pRows.Close()
	plantings := []interface{}{}
	for pRows.Next() {
		var id, crop, status, date, cname, area string
		pRows.Scan(&id, &crop, &status, &date, &cname, &area)
		plantings = append(plantings, map[string]interface{}{"id": id, "cropId": crop, "status": status, "plantingDate": date, "cropName": cname, "plantedArea": area})
	}
	dRows, _ := s.DB.Query(r.Context(), `select id::text,name,device_uid,last_seen_at,interval_sec,active from iot_devices where farm_id=$1`, selected)
	defer dRows.Close()
	dOut := []interface{}{}
	for dRows.Next() {
		var id, name, uid string
		var last *time.Time
		var interval int
		var active bool
		dRows.Scan(&id, &name, &uid, &last, &interval, &active)
		dOut = append(dOut, map[string]interface{}{"id": id, "name": name, "deviceUid": uid, "lastSeenAt": last, "intervalSec": interval, "active": active, "status": deviceStatus(last, interval)})
		if deviceStatus(last, interval) == "online" {
			online++
		}
	}
	predRows, _ := s.DB.Query(r.Context(), `select id::text,crop_name,yield_min::text,yield_max::text,yield_unit,total_min::text,total_max::text,total_unit,harvest_start::text,harvest_end::text,data_quality_score,method_version,created_at from predictions where farm_id=$1 order by created_at desc limit 5`, selected)
	defer predRows.Close()
	preds := []interface{}{}
	for predRows.Next() {
		var id, crop, ymin, ymax, yunit, tmin, tmax, tunit, hstart, hend, method string
		var quality int
		var created time.Time
		if predRows.Scan(&id, &crop, &ymin, &ymax, &yunit, &tmin, &tmax, &tunit, &hstart, &hend, &quality, &method, &created) == nil {
			preds = append(preds, map[string]interface{}{
				"id": id, "cropName": crop, "yieldMin": ymin, "yieldMax": ymax, "yieldUnit": yunit,
				"totalMin": tmin, "totalMax": tmax, "totalUnit": tunit,
				"harvestStart": hstart, "harvestEnd": hend, "dataQualityScore": quality,
				"methodVersion": method, "createdAt": created,
			})
		}
	}
	riskRows, _ := s.DB.Query(r.Context(), `select id::text,category,severity::text,title,explanation,source,active,detected_at,last_seen_at,resolved_at from farm_risks where farm_id=$1 and active=true order by detected_at desc limit 10`, selected)
	defer riskRows.Close()
	rOut := []interface{}{}
	for riskRows.Next() {
		var id, category, severity, title, explanation, source string
		var active bool
		var detected, lastSeen time.Time
		var resolved interface{}
		if riskRows.Scan(&id, &category, &severity, &title, &explanation, &source, &active, &detected, &lastSeen, &resolved) == nil {
			rOut = append(rOut, map[string]interface{}{
				"id": id, "category": category, "severity": severity, "title": title,
				"explanation": explanation, "source": source, "active": active,
				"detectedAt": detected, "lastSeenAt": lastSeen, "resolvedAt": resolved,
			})
		}
	}
	actRows, _ := s.DB.Query(r.Context(), `select id::text,type,description,occurred_at from farm_activities where farm_id=$1 order by occurred_at desc limit 8`, selected)
	defer actRows.Close()
	aOut := []interface{}{}
	for actRows.Next() {
		var id, typ, description string
		var occurred time.Time
		if actRows.Scan(&id, &typ, &description, &occurred) == nil {
			aOut = append(aOut, map[string]interface{}{"id": id, "type": typ, "description": description, "occurredAt": occurred})
		}
	}
	JSON(w, map[string]interface{}{"farms": farms, "selectedFarmId": selected, "totals": map[string]int{"farms": len(farms), "activePlantings": activePlantings, "devices": devices, "devicesOnline": online, "activeRisks": risks, "unread": unread}, "selected": map[string]interface{}{"farm": selectedFarm, "plantings": plantings, "predictions": preds, "risks": rOut, "activities": aOut, "latestReadings": s.latestReadings(r, selected), "devices": dOut}}, 200)
}
