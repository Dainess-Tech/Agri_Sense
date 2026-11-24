package api

import (
	"crypto/subtle"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func fmtFloat(v float64) string { return strconv.FormatFloat(v, 'f', 3, 64) }

func validateSensor(t string, v float64) (unit, quality, note string, ok bool) {
	ranges := map[string][3]float64{"soil_moisture": {0, 100, -1}, "air_temperature": {-40, 85, -1}, "air_humidity": {0, 100, -1}, "soil_temperature": {-40, 85, -1}, "soil_ph": {2, 12, -1}, "soil_n": {0, 10000, -1}, "soil_p": {0, 10000, -1}, "soil_k": {0, 10000, -1}}
	units := map[string]string{"soil_moisture": "%", "air_temperature": "°C", "air_humidity": "%RH", "soil_temperature": "°C", "soil_ph": "pH", "soil_n": "mg/kg", "soil_p": "mg/kg", "soil_k": "mg/kg"}
	r, exists := ranges[t]
	if !exists {
		return "", "", "", false
	}
	if v < r[0] || v > r[1] {
		return units[t], "invalid", "Outside plausible range", true
	}
	suspect := false
	switch t {
	case "soil_moisture", "soil_n", "soil_p", "soil_k":
		suspect = v == r[0]
	}
	if suspect {
		return units[t], "suspect", "Sentinel or boundary value", true
	}
	return units[t], "valid", "", true
}
func (s *Server) iotPost(w http.ResponseWriter, r *http.Request) {
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.RemoteAddr
	}
	if err := rateLimit("iot:lookup:"+ip, 300, time.Minute); err != nil {
		Error(w, r, err)
		return
	}
	uid := strings.TrimSpace(r.Header.Get("X-Device-Id"))
	key := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if uid == "" || key == "" {
		Error(w, r, unauthorized("Device credentials required (X-Device-Id + Authorization: Bearer <key>)"))
		return
	}
	var did, farm, hash string
	var active bool
	err := s.DB.QueryRow(r.Context(), `select id::text,farm_id::text,api_key_hash,active from iot_devices where device_uid=$1`, uid).Scan(&did, &farm, &hash, &active)
	if err != nil {
		Error(w, r, unauthorized("Invalid device credentials"))
		return
	}
	a := []byte(sha(key))
	b := []byte(hash)
	if len(a) != len(b) || subtle.ConstantTimeCompare(a, b) != 1 {
		Error(w, r, unauthorized("Invalid device credentials"))
		return
	}
	if err := rateLimit("iot:"+did, 120, time.Minute); err != nil {
		Error(w, r, err)
		return
	}
	if !active {
		Error(w, r, forbidden("Device is deactivated"))
		return
	}
	var bPayload struct {
		Messages []struct {
			MessageID  string      `json:"messageId"`
			MeasuredAt interface{} `json:"measuredAt"`
			Readings   []struct {
				Type  string   `json:"type"`
				Value *float64 `json:"value"`
			} `json:"readings"`
		} `json:"messages"`
		MessageID  string      `json:"messageId"`
		MeasuredAt interface{} `json:"measuredAt"`
		Readings   []struct {
			Type  string   `json:"type"`
			Value *float64 `json:"value"`
		} `json:"readings"`
		Firmware string `json:"firmware"`
		Log      string `json:"log"`
	}
	if err := decode(w, r, &bPayload); err != nil {
		Error(w, r, err)
		return
	}
	messages := bPayload.Messages
	if len(messages) == 0 {
		messages = append(messages, struct {
			MessageID  string      `json:"messageId"`
			MeasuredAt interface{} `json:"measuredAt"`
			Readings   []struct {
				Type  string   `json:"type"`
				Value *float64 `json:"value"`
			} `json:"readings"`
		}{bPayload.MessageID, bPayload.MeasuredAt, bPayload.Readings})
	}
	now := time.Now()
	accepted, duplicates, flagged := 0, 0, 0
	rejected := []interface{}{}
	for _, m := range messages {
		at := now
		note := ""
		if m.MeasuredAt != nil {
			switch v := m.MeasuredAt.(type) {
			case string:
				if t, e := time.Parse(time.RFC3339, v); e == nil {
					at = t
				} else {
					at = now
					note = "device clock not synchronised; server time used"
				}
			case float64:
				t := time.Unix(int64(v), 0)
				if v > 1e12 {
					t = time.UnixMilli(int64(v))
				}
				at = t
			}
		}
		if at.Before(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)) {
			at = now
			note = "device clock not synchronised; server time used"
		}
		if at.After(now.Add(5 * time.Minute)) {
			rejected = append(rejected, map[string]interface{}{"messageId": m.MessageID, "reason": "measuredAt is in the future"})
			continue
		}
		rows := []struct{ typ, val, unit, quality, qualityNote string }{}
		for _, r := range m.Readings {
			if r.Value == nil {
				rejected = append(rejected, map[string]interface{}{"messageId": m.MessageID, "type": r.Type, "reason": "Sensor read failed (null/NaN) — not stored"})
				continue
			}
			unit, quality, note2, ok := validateSensor(r.Type, *r.Value)
			if !ok {
				rejected = append(rejected, map[string]interface{}{"messageId": m.MessageID, "type": r.Type, "reason": "Unknown sensor type"})
				continue
			}
			qualityNote := strings.TrimSpace(note2 + " " + note)
			if quality != "valid" {
				flagged++
			}
			rows = append(rows, struct{ typ, val, unit, quality, qualityNote string }{r.Type, fmtFloat(*r.Value), unit, quality, qualityNote})
		}
		for _, x := range rows {
			tag, e := s.DB.Exec(r.Context(), `insert into sensor_readings(device_id,farm_id,sensor_type,value,unit,quality,quality_note,message_id,measured_at,received_at) values($1,$2,$3,$4,$5,$6,nullif($7,''),$8,$9,$10) on conflict do nothing`, did, farm, x.typ, x.val, x.unit, x.quality, x.qualityNote, m.MessageID, at, now)
			if e == nil && tag.RowsAffected() == 1 {
				accepted++
			} else {
				duplicates++
			}
		}
	}
	_, _ = s.DB.Exec(r.Context(), `update iot_devices set last_seen_at=$1,firmware_version=coalesce(nullif($2,''),firmware_version) where id=$3`, now, bPayload.Firmware, did)
	if bPayload.Log != "" {
		_, _ = s.DB.Exec(r.Context(), `insert into device_logs(device_id,level,message) values($1,'info',$2)`, did, bPayload.Log)
	}
	status := 201
	if accepted == 0 {
		status = 200
	}
	JSON(w, map[string]interface{}{"accepted": accepted, "duplicates": duplicates, "flagged": flagged, "rejected": rejected, "intervalSec": 900, "serverTime": now}, status)
}
