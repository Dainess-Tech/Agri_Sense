package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// deviceSensors normalises jsonb sensors (returned as text by the query) into
// the array shape expected by the UI and API clients.
func deviceSensors(raw interface{}) []string {
	out := []string{}
	switch v := raw.(type) {
	case []string:
		return v
	case string:
		if err := json.Unmarshal([]byte(v), &out); err != nil {
			return []string{}
		}
	case []byte:
		if err := json.Unmarshal(v, &out); err != nil {
			return []string{}
		}
	case []interface{}:
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
	}
	return out
}

func deviceStatus(last *time.Time, interval int) string {
	if last == nil {
		return "never"
	}
	if time.Since(*last) <= time.Duration(interval)*time.Second*2 {
		return "online"
	}
	return "offline"
}
func validDeviceUID(uid string) bool {
	if uid == "" || len(uid) > 64 {
		return false
	}
	for _, c := range uid {
		if !(c >= 'a' && c <= 'z') && !(c >= 'A' && c <= 'Z') &&
			!(c >= '0' && c <= '9') && c != '-' && c != '_' && c != '.' {
			return false
		}
	}
	return true
}
func (s *Server) devicesGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	fid := r.URL.Query().Get("farmId")
	var rowsPG interface{ Close() }
	_ = rowsPG
	query := `select d.id::text,d.farm_id::text,d.name,d.device_uid,d.hardware,d.sensors::text,d.interval_sec,d.last_seen_at,d.active,d.firmware_version,d.created_at,f.name from iot_devices d join farms f on f.id=d.farm_id where 1=1`
	args := []interface{}{}
	if fid != "" {
		if _, e = s.getFarmForUser(r.Context(), u, fid, "read"); e != nil {
			Error(w, r, e)
			return
		}
		query += " and d.farm_id=$1"
		args = append(args, fid)
	} else {
		query += " and d.farm_id in (select id from farms where owner_id=$1 or id in (select farm_id from farm_members where user_id=$1))"
		args = append(args, u.ID)
	}
	rows, err := s.DB.Query(r.Context(), query, args...)
	if err != nil {
		Error(w, r, err)
		return
	}
	defer rows.Close()
	out := []interface{}{}
	for rows.Next() {
		var id, farm, name, uid, hardware, farmName string
		var interval int
		var last *time.Time
		var active bool
		var firmware interface{}
		var created time.Time
		var sensorsRaw interface{}
		if err := rows.Scan(&id, &farm, &name, &uid, &hardware, &sensorsRaw, &interval, &last, &active, &firmware, &created, &farmName); err != nil {
			continue
		}
		status := deviceStatus(last, interval)
		out = append(out, map[string]interface{}{"id": id, "farmId": farm, "name": name, "deviceUid": uid, "hardware": hardware, "sensors": deviceSensors(sensorsRaw), "intervalSec": interval, "lastSeenAt": last, "active": active, "firmwareVersion": firmware, "createdAt": created, "status": status, "farmName": farmName})
	}
	JSON(w, map[string]interface{}{"devices": out}, 200)
}
func (s *Server) devicesPost(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	var b struct {
		FarmID    string   `json:"farmId"`
		Name      string   `json:"name"`
		DeviceUID string   `json:"deviceUid"`
		Hardware  string   `json:"hardware"`
		Sensors   []string `json:"sensors"`
		Interval  int      `json:"intervalSec"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	if _, e = s.getFarmForUser(r.Context(), u, b.FarmID, "write"); e != nil {
		Error(w, r, e)
		return
	}
	if b.Name == "" || len(b.Name) < 2 {
		Error(w, r, validation("Validation failed", nil))
		return
	}
	if b.Hardware == "" {
		b.Hardware = "ESP32"
	}
	if b.Hardware != "ESP32" {
		Error(w, r, validation("Unsupported microcontroller. Select an available device.", nil))
		return
	}
	if b.Interval == 0 {
		b.Interval = 900
	}
	if len(b.Sensors) == 0 {
		b.Sensors = []string{"soil_moisture", "air_temperature", "air_humidity", "soil_temperature"}
	}
	if b.DeviceUID == "" {
		b.DeviceUID = "as-" + strings.ToLower(randomToken()[:8])
	}
	b.DeviceUID = strings.TrimSpace(b.DeviceUID)
	if !validDeviceUID(b.DeviceUID) {
		Error(w, r, validation("Device ID may contain only letters, numbers, dots, underscores, and hyphens (up to 64 characters).", nil))
		return
	}
	key := "ask_" + randomToken()
	hash := sha(key)
	var id string
	err := s.DB.QueryRow(r.Context(), `insert into iot_devices(farm_id,name,device_uid,api_key_hash,hardware,sensors,interval_sec) values($1,$2,$3,$4,$5,$6,$7) returning id::text`,
		b.FarmID, b.Name, b.DeviceUID, hash, b.Hardware, b.Sensors, b.Interval).Scan(&id)
	if err != nil {
		Error(w, r, conflict("A device with this UID already exists.", nil))
		return
	}
	device := map[string]interface{}{"id": id, "farmId": b.FarmID, "name": b.Name, "deviceUid": b.DeviceUID, "hardware": b.Hardware, "sensors": b.Sensors, "intervalSec": b.Interval, "status": "never", "active": true}
	JSON(w, map[string]interface{}{"device": device, "apiKey": key}, 201)
}
func (s *Server) getDevice(r *http.Request, u *User, mode string) (map[string]interface{}, error) {
	id := chi.URLParam(r, "deviceId")
	var farm, name, uid, hardware string
	var interval int
	var last *time.Time
	var active bool
	err := s.DB.QueryRow(r.Context(), `select farm_id::text,name,device_uid,hardware,interval_sec,last_seen_at,active from iot_devices where id=$1`, id).Scan(&farm, &name, &uid, &hardware, &interval, &last, &active)
	if err != nil {
		return nil, notFound("Device not found")
	}
	if _, e := s.getFarmForUser(r.Context(), u, farm, mode); e != nil {
		return nil, e
	}
	return map[string]interface{}{"id": id, "farmId": farm, "name": name, "deviceUid": uid, "hardware": hardware, "intervalSec": interval, "lastSeenAt": last, "active": active, "status": deviceStatus(last, interval)}, nil
}
func (s *Server) deviceGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	d, e := s.getDevice(r, u, "read")
	if e != nil {
		Error(w, r, e)
		return
	}
	rows, _ := s.DB.Query(r.Context(), `select level,message,created_at from device_logs where device_id=$1 order by created_at desc limit 50`, d["id"])
	defer rows.Close()
	logs := []interface{}{}
	for rows.Next() {
		var level, msg string
		var created time.Time
		rows.Scan(&level, &msg, &created)
		logs = append(logs, map[string]interface{}{"level": level, "message": msg, "createdAt": created})
	}
	JSON(w, map[string]interface{}{"device": d, "logs": logs}, 200)
}
func (s *Server) devicePatch(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	d, e := s.getDevice(r, u, "write")
	if e != nil {
		Error(w, r, e)
		return
	}
	var b map[string]interface{}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	cols := map[string]string{"name": "name", "intervalSec": "interval_sec", "active": "active", "farmId": "farm_id", "sensors": "sensors"}
	for k, col := range cols {
		if v, ok := b[k]; ok {
			if k == "intervalSec" {
				if f, ok := v.(float64); ok {
					v = int(f)
				}
			}
			if k == "farmId" {
				if v.(string) != d["farmId"].(string) {
					if _, e := s.getFarmForUser(r.Context(), u, v.(string), "write"); e != nil {
						Error(w, r, e)
						return
					}
				}
			}
			_, _ = s.DB.Exec(r.Context(), "update iot_devices set "+col+"=$1 where id=$2", v, d["id"])
		}
	}
	d, _ = s.getDevice(r, u, "read")
	JSON(w, map[string]interface{}{"device": d}, 200)
}
func (s *Server) devicePost(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	d, e := s.getDevice(r, u, "write")
	if e != nil {
		Error(w, r, e)
		return
	}
	var b struct {
		Action string `json:"action"`
	}
	decode(w, r, &b)
	if b.Action != "rotate-key" {
		Error(w, r, notFound(""))
		return
	}
	key := "ask_" + randomToken()
	_, _ = s.DB.Exec(r.Context(), `update iot_devices set api_key_hash=$1 where id=$2`, sha(key), d["id"])
	JSON(w, map[string]interface{}{"apiKey": key}, 200)
}
func (s *Server) deviceDelete(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	d, e := s.getDevice(r, u, "write")
	if e != nil {
		Error(w, r, e)
		return
	}
	_, _ = s.DB.Exec(r.Context(), `delete from iot_devices where id=$1`, d["id"])
	JSON(w, nil, 204)
}
func (s *Server) deviceReadings(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	d, e := s.getDevice(r, u, "read")
	if e != nil {
		Error(w, r, e)
		return
	}
	limit, offset, page := page(r, 50, 500)
	if series := r.URL.Query().Get("series"); series != "" {
		hours := atoi(r.URL.Query().Get("hours"), 24)
		rows, _ := s.DB.Query(r.Context(), `select date_trunc('hour',measured_at) t,avg(value::float) v from sensor_readings where device_id=$1 and sensor_type=$2 and quality='valid' and measured_at>now()-make_interval(hours=>$3) group by 1 order by 1`, d["id"], series, hours)
		defer rows.Close()
		out := []interface{}{}
		for rows.Next() {
			var t time.Time
			var v float64
			rows.Scan(&t, &v)
			out = append(out, map[string]interface{}{"t": t, "v": v})
		}
		JSON(w, map[string]interface{}{"sensorType": series, "hours": hours, "series": out}, 200)
		return
	}
	var total int
	if err := s.DB.QueryRow(r.Context(), `select count(*) from sensor_readings where device_id=$1`, d["id"]).Scan(&total); err != nil {
		Error(w, r, err)
		return
	}
	rows, err := s.DB.Query(r.Context(), `select id::text,sensor_type,value::text,unit,quality::text,quality_note,message_id,measured_at,received_at from sensor_readings where device_id=$1 order by measured_at desc limit $2 offset $3`, d["id"], limit, offset)
	if err != nil {
		Error(w, r, err)
		return
	}
	defer rows.Close()
	out := []interface{}{}
	for rows.Next() {
		var id, typ, val, unit, quality, msg string
		var note interface{}
		var measured, received time.Time
		rows.Scan(&id, &typ, &val, &unit, &quality, &note, &msg, &measured, &received)
		out = append(out, map[string]interface{}{"id": id, "sensorType": typ, "value": val, "unit": unit, "quality": quality, "qualityNote": note, "messageId": msg, "measuredAt": measured, "receivedAt": received})
	}
	JSON(w, map[string]interface{}{"readings": out, "page": page, "limit": limit, "total": total}, 200)
}
