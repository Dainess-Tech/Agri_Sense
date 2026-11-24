package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

func (s *Server) requireAdmin(r *http.Request) (*User, error) {
	u, e := requireAuth(r)
	if e != nil {
		return nil, e
	}
	if u.Role != "admin" {
		return nil, forbidden("")
	}
	return u, nil
}

func (s *Server) adminGet(w http.ResponseWriter, r *http.Request) {
	_, e := s.requireAdmin(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	section := chi.URLParam(r, "section")
	switch section {
	case "stats":
		var users, farms, devices, readings, preds int
		s.DB.QueryRow(r.Context(), `select (select count(*) from users),(select count(*) from farms),(select count(*) from iot_devices),(select count(*) from sensor_readings),(select count(*) from predictions)`).Scan(&users, &farms, &devices, &readings, &preds)
		JSON(w, map[string]interface{}{"stats": map[string]int{"users": users, "farms": farms, "devices": devices, "readings": readings, "predictions": preds}}, 200)
	case "users":
		q := r.URL.Query().Get("q")
		limit, offset, page := page(r, 50, 200)
		rows, err := s.DB.Query(r.Context(), `select id::text,full_name,email,role::text,phone,country,language,measurement_system,email_verified_at,created_at from users where ($1='' or email ilike '%'||$1||'%' or full_name ilike '%'||$1||'%') order by created_at desc limit $2 offset $3`, q, limit, offset)
		if err != nil {
			Error(w, r, err)
			return
		}
		defer rows.Close()
		out := []interface{}{}
		for rows.Next() {
			var id, name, email, role, lang, measure string
			var phone, country interface{}
			var verified interface{}
			var created time.Time
			rows.Scan(&id, &name, &email, &role, &phone, &country, &lang, &measure, &verified, &created)
			out = append(out, map[string]interface{}{"id": id, "fullName": name, "email": email, "role": role, "phone": phone, "country": country, "language": lang, "measurementSystem": measure, "emailVerified": verified != nil, "createdAt": created})
		}
		JSON(w, map[string]interface{}{"users": out, "page": page, "limit": limit}, 200)
	case "audit":
		rows, err := s.DB.Query(r.Context(), `select a.id,a.action,a.entity,a.entity_id,a.meta,a.created_at,u.email from audit_logs a left join users u on u.id=a.actor_id order by a.created_at desc limit 100`)
		if err != nil {
			Error(w, r, err)
			return
		}
		defer rows.Close()
		out := []interface{}{}
		for rows.Next() {
			var id int64
			var action, entity string
			var eid interface{}
			var meta interface{}
			var created time.Time
			var actor interface{}
			rows.Scan(&id, &action, &entity, &eid, &meta, &created, &actor)
			out = append(out, map[string]interface{}{"id": id, "action": action, "entity": entity, "entityId": eid, "meta": meta, "createdAt": created, "actor": actor})
		}
		JSON(w, map[string]interface{}{"logs": out}, 200)
	case "crops", "varieties", "settings":
		if section == "crops" {
			rows, _ := s.DB.Query(r.Context(), `select row_to_json(c)::text from crops c order by name`)
			defer rows.Close()
			out := []interface{}{}
			for rows.Next() {
				var raw []byte
				rows.Scan(&raw)
				var m interface{}
				json.Unmarshal(raw, &m)
				out = append(out, m)
			}
			JSON(w, map[string]interface{}{"crops": out}, 200)
		}
		if section == "varieties" {
			crop := r.URL.Query().Get("cropId")
			rows, _ := s.DB.Query(r.Context(), `select row_to_json(v)::text from crop_varieties v where ($1='' or crop_id::text=$1) order by name`, crop)
			defer rows.Close()
			out := []interface{}{}
			for rows.Next() {
				var raw []byte
				rows.Scan(&raw)
				var m interface{}
				json.Unmarshal(raw, &m)
				out = append(out, m)
			}
			JSON(w, map[string]interface{}{"varieties": out}, 200)
		}
		if section == "settings" {
			key := r.URL.Query().Get("key")
			if key != "" {
				var value interface{}
				var updated *time.Time
				err := s.DB.QueryRow(r.Context(), `select value,updated_at from system_settings where key=$1`, key).Scan(&value, &updated)
				if key != "risk_thresholds" && err != nil {
					Error(w, r, notFound(""))
					return
				}
				if key == "risk_thresholds" {
					JSON(w, map[string]interface{}{"setting": map[string]interface{}{"key": key, "value": value, "effective": effectiveRiskThresholds(value), "updatedAt": updated}}, 200)
					return
				}
				JSON(w, map[string]interface{}{"setting": map[string]interface{}{"key": key, "value": value, "updatedAt": updated}}, 200)
				return
			}
			rows, err := s.DB.Query(r.Context(), `select key,value,updated_at from system_settings`)
			if err != nil {
				Error(w, r, err)
				return
			}
			defer rows.Close()
			values := map[string]interface{}{}
			for rows.Next() {
				var k string
				var v interface{}
				var t *time.Time
				if err := rows.Scan(&k, &v, &t); err != nil {
					Error(w, r, err)
					return
				}
				values[k] = map[string]interface{}{"value": v, "updatedAt": t}
			}
			entry, overridden := values["risk_thresholds"].(map[string]interface{})
			var raw, updated interface{}
			if overridden {
				raw, updated = entry["value"], entry["updatedAt"]
			}
			out := []interface{}{map[string]interface{}{
				"key": "risk_thresholds", "value": raw, "effective": effectiveRiskThresholds(raw),
				"updatedAt": updated, "overridden": overridden,
			}}
			JSON(w, map[string]interface{}{"settings": out}, 200)
		}
	default:
		Error(w, r, notFound(""))
	}
}
