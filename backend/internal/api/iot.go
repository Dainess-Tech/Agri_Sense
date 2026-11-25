package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
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

type iotReading struct {
	Type  string   `json:"type"`
	Value *float64 `json:"value"`
}

type iotMessage struct {
	MessageID  string       `json:"messageId"`
	MeasuredAt interface{}  `json:"measuredAt"`
	Readings   []iotReading `json:"readings"`
}

type iotPayload struct {
	Messages   []iotMessage `json:"messages"`
	MessageID  string       `json:"messageId"`
	MeasuredAt interface{}  `json:"measuredAt"`
	Readings   []iotReading `json:"readings"`
	Firmware   string       `json:"firmware"`
	Log        string       `json:"log"`
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
	var interval int
	err := s.DB.QueryRow(r.Context(), `select id::text,farm_id::text,api_key_hash,active,interval_sec from iot_devices where device_uid=$1`, uid).Scan(&did, &farm, &hash, &active, &interval)
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
	var payload iotPayload
	if err := decode(w, r, &payload); err != nil {
		Error(w, r, err)
		return
	}
	if len(payload.Messages) > 200 {
		Error(w, r, badRequest("At most 200 messages can be sent at once"))
		return
	}
	result, status, err := s.ingestIoT(r.Context(), did, farm, interval, payload)
	if err != nil {
		Error(w, r, err)
		return
	}
	JSON(w, result, status)
}

func (s *Server) ingestIoT(ctx context.Context, deviceID, farmID string, interval int, payload iotPayload) (map[string]interface{}, int, error) {
	messages := payload.Messages
	if len(messages) == 0 {
		messages = []iotMessage{{MessageID: payload.MessageID, MeasuredAt: payload.MeasuredAt, Readings: payload.Readings}}
	}
	now := time.Now()
	accepted, duplicates, flagged := 0, 0, 0
	rejected := []interface{}{}
	for _, message := range messages {
		at := now
		clockNote := ""
		if message.MeasuredAt != nil {
			switch value := message.MeasuredAt.(type) {
			case string:
				if measuredAt, err := time.Parse(time.RFC3339, value); err == nil {
					at = measuredAt
				} else {
					clockNote = "device clock not synchronised; server time used"
				}
			case float64:
				at = time.Unix(int64(value), 0)
				if value > 1e12 {
					at = time.UnixMilli(int64(value))
				}
			}
		}
		if at.Before(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)) {
			at = now
			clockNote = "device clock not synchronised; server time used"
		}
		if at.After(now.Add(5 * time.Minute)) {
			rejected = append(rejected, map[string]interface{}{"messageId": message.MessageID, "reason": "measuredAt is in the future"})
			continue
		}
		for _, reading := range message.Readings {
			if reading.Value == nil {
				rejected = append(rejected, map[string]interface{}{"messageId": message.MessageID, "type": reading.Type, "reason": "Sensor read failed (null/NaN) — not stored"})
				continue
			}
			unit, quality, qualityNote, ok := validateSensor(reading.Type, *reading.Value)
			if !ok {
				rejected = append(rejected, map[string]interface{}{"messageId": message.MessageID, "type": reading.Type, "reason": "Unknown sensor type"})
				continue
			}
			qualityNote = strings.TrimSpace(qualityNote + " " + clockNote)
			if quality != "valid" {
				flagged++
			}
			tag, err := s.DB.Exec(ctx, `insert into sensor_readings(device_id,farm_id,sensor_type,value,unit,quality,quality_note,message_id,measured_at,received_at) values($1,$2,$3,$4,$5,$6,nullif($7,''),$8,$9,$10) on conflict do nothing`,
				deviceID, farmID, reading.Type, fmtFloat(*reading.Value), unit, quality, qualityNote, message.MessageID, at, now)
			if err != nil {
				return nil, 0, err
			}
			if tag.RowsAffected() == 1 {
				accepted++
			} else {
				duplicates++
			}
		}
	}
	if _, err := s.DB.Exec(ctx, `update iot_devices set last_seen_at=$1,firmware_version=coalesce(nullif($2,''),firmware_version) where id=$3`, now, payload.Firmware, deviceID); err != nil {
		return nil, 0, err
	}
	if payload.Log != "" {
		if _, err := s.DB.Exec(ctx, `insert into device_logs(device_id,level,message) values($1,'info',$2)`, deviceID, payload.Log); err != nil {
			log.Printf("[iot] failed to save device log for %s: %v", deviceID, err)
		}
	}
	status := http.StatusCreated
	if accepted == 0 {
		status = http.StatusOK
	}
	return map[string]interface{}{"accepted": accepted, "duplicates": duplicates, "flagged": flagged, "rejected": rejected, "intervalSec": interval, "serverTime": now}, status, nil
}

func (s *Server) ingestMQTTMessage(topicFilter, topic string, body []byte) error {
	if len(body) == 0 || len(body) > 1<<20 {
		return badRequest("MQTT payload must be between 1 byte and 1 MiB")
	}
	uid, err := deviceUIDFromTopic(topic, topicFilter)
	if err != nil {
		return err
	}
	var payload iotPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return badRequest("MQTT payload must be valid JSON")
	}
	if len(payload.Messages) > 200 {
		return badRequest("At most 200 messages can be sent at once")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var deviceID, farmID string
	var active bool
	var interval int
	err = s.DB.QueryRow(ctx, `select id::text,farm_id::text,active,interval_sec from iot_devices where device_uid=$1`, uid).Scan(&deviceID, &farmID, &active, &interval)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound("MQTT message is for an unregistered device")
		}
		return err
	}
	if !active {
		return forbidden("MQTT message is for a deactivated device")
	}
	if err := rateLimit("iot:"+deviceID, 120, time.Minute); err != nil {
		return err
	}
	_, _, err = s.ingestIoT(ctx, deviceID, farmID, interval, payload)
	return err
}
