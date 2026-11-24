package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
)

func (s *Server) usersGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	section := chi.URLParam(r, "section")
	switch section {
	case "profile":
		JSON(w, map[string]interface{}{"user": s.userJSON(u)}, 200)
	case "preferences":
		_, _ = s.DB.Exec(r.Context(), `insert into notification_preferences(user_id) values($1) on conflict do nothing`, u.ID)
		var risk, prediction, device, harvest, system, push bool
		var severity string
		err := s.DB.QueryRow(r.Context(), `select risk_alerts,prediction_ready,device_offline,harvest_reminders,system_announcements,push_enabled,min_severity::text from notification_preferences where user_id=$1`, u.ID).Scan(&risk, &prediction, &device, &harvest, &system, &push, &severity)
		if err != nil {
			Error(w, r, err)
			return
		}
		JSON(w, map[string]interface{}{"preferences": map[string]interface{}{"riskAlerts": risk, "predictionReady": prediction, "deviceOffline": device, "harvestReminders": harvest, "systemAnnouncements": system, "pushEnabled": push, "minSeverity": severity}}, 200)
	case "export":
		rows, err := s.DB.Query(r.Context(), `select row_to_json(f) from farms f where owner_id=$1`, u.ID)
		if err != nil {
			Error(w, r, err)
			return
		}
		defer rows.Close()
		farms := []interface{}{}
		for rows.Next() {
			var raw []byte
			if rows.Scan(&raw) == nil {
				var v interface{}
				json.Unmarshal(raw, &v)
				farms = append(farms, v)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="agrisense-data-export.json"`)
		JSON(w, map[string]interface{}{"exportedAt": time.Now().UTC(), "profile": s.userJSON(u), "farms": farms}, 200)
	default:
		Error(w, r, notFound(""))
	}
}

func (s *Server) usersPatch(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	section := chi.URLParam(r, "section")
	switch section {
	case "profile":
		var b map[string]interface{}
		if err := decode(w, r, &b); err != nil {
			Error(w, r, err)
			return
		}
		allowed := []string{"fullName", "phone", "country", "language", "measurementSystem"}
		cols := map[string]string{"fullName": "full_name", "phone": "phone", "country": "country", "language": "language", "measurementSystem": "measurement_system"}
		for k, v := range b {
			ok := false
			for _, x := range allowed {
				if k == x {
					ok = true
				}
			}
			if ok {
				_, _ = s.DB.Exec(r.Context(), "update users set "+cols[k]+"=$1,updated_at=$2 where id=$3", v, time.Now(), u.ID)
			}
		}
		var lang, measure string
		_ = s.DB.QueryRow(r.Context(), `select language,measurement_system from users where id=$1`, u.ID).Scan(&lang, &measure)
		u.Language = lang
		u.MeasurementSystem = measure
		JSON(w, map[string]interface{}{"user": s.userJSON(u)}, 200)
	case "preferences":
		var b map[string]interface{}
		if err := decode(w, r, &b); err != nil {
			Error(w, r, err)
			return
		}
		m := map[string]string{"riskAlerts": "risk_alerts", "predictionReady": "prediction_ready", "deviceOffline": "device_offline", "harvestReminders": "harvest_reminders", "systemAnnouncements": "system_announcements", "pushEnabled": "push_enabled", "minSeverity": "min_severity"}
		for k, v := range b {
			if col, ok := m[k]; ok {
				_, _ = s.DB.Exec(r.Context(), "update notification_preferences set "+col+"=$1,updated_at=$2 where user_id=$3", v, time.Now(), u.ID)
			}
		}
		s.usersGet(w, r)
	case "password":
		var b struct {
			CurrentPassword string `json:"currentPassword"`
			NewPassword     string `json:"newPassword"`
		}
		if err := decode(w, r, &b); err != nil {
			Error(w, r, err)
			return
		}
		if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(b.CurrentPassword)) != nil {
			Error(w, r, badRequest("Current password is incorrect."))
			return
		}
		if len(b.NewPassword) < 8 {
			Error(w, r, validation("Validation failed", nil))
			return
		}
		h, _ := bcryptHash(b.NewPassword)
		_, _ = s.DB.Exec(r.Context(), `update users set password_hash=$1,updated_at=$2 where id=$3`, h, time.Now(), u.ID)
		_, _ = s.DB.Exec(r.Context(), `delete from sessions where user_id=$1`, u.ID)
		s.destroySession(w, r)
		JSON(w, map[string]interface{}{"message": "Password changed. Please sign in again."}, 200)
	default:
		Error(w, r, notFound(""))
	}
}
func (s *Server) usersDelete(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	if chi.URLParam(r, "section") != "profile" {
		Error(w, r, notFound(""))
		return
	}
	var b struct {
		Password string `json:"password"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(b.Password)) != nil {
		Error(w, r, badRequest("Password is incorrect."))
		return
	}
	s.destroySession(w, r)
	_, _ = s.DB.Exec(r.Context(), `delete from users where id=$1`, u.ID)
	JSON(w, nil, 204)
}
