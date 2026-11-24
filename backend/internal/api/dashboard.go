package api

import (
	"encoding/json"
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
	predRows, _ := s.DB.Query(r.Context(), `select row_to_json(p)::text from predictions p where farm_id=$1 order by created_at desc limit 5`, selected)
	defer predRows.Close()
	preds := []interface{}{}
	for predRows.Next() {
		var raw []byte
		predRows.Scan(&raw)
		var m interface{}
		json.Unmarshal(raw, &m)
		preds = append(preds, m)
	}
	riskRows, _ := s.DB.Query(r.Context(), `select row_to_json(r)::text from farm_risks r where farm_id=$1 and active=true order by detected_at desc limit 10`, selected)
	defer riskRows.Close()
	rOut := []interface{}{}
	for riskRows.Next() {
		var raw []byte
		riskRows.Scan(&raw)
		var m interface{}
		json.Unmarshal(raw, &m)
		rOut = append(rOut, m)
	}
	actRows, _ := s.DB.Query(r.Context(), `select row_to_json(a)::text from farm_activities a where farm_id=$1 order by occurred_at desc limit 8`, selected)
	defer actRows.Close()
	aOut := []interface{}{}
	for actRows.Next() {
		var raw []byte
		actRows.Scan(&raw)
		var m interface{}
		json.Unmarshal(raw, &m)
		aOut = append(aOut, m)
	}
	JSON(w, map[string]interface{}{"farms": farms, "selectedFarmId": selected, "totals": map[string]int{"farms": len(farms), "activePlantings": activePlantings, "devices": devices, "devicesOnline": online, "activeRisks": risks, "unread": unread}, "selected": map[string]interface{}{"farm": selectedFarm, "plantings": plantings, "predictions": preds, "risks": rOut, "activities": aOut, "latestReadings": s.latestReadings(r, selected), "devices": dOut}}, 200)
}
