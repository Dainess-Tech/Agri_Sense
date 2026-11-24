package api

import (
	"net/http"
	"time"
)

func (s *Server) retention(r *http.Request, days int) map[string]int {
	now := time.Now()
	deleted := map[string]int{}
	sweep := func(name, q string, args ...interface{}) {
		tag, e := s.DB.Exec(r.Context(), q, args...)
		if e != nil {
			deleted[name] = -1
		} else {
			deleted[name] = int(tag.RowsAffected())
		}
	}
	sweep("expiredSessions", `delete from sessions where expires_at<$1`, now)
	sweep("expiredAuthTokens", `delete from auth_tokens where expires_at<$1`, now)
	sweep("expiredWeatherCache", `delete from weather_snapshots where expires_at<$1`, now.Add(-7*24*time.Hour))
	sweep("expiredSoilCache", `delete from soil_profiles where expires_at<$1`, now.Add(-7*24*time.Hour))
	sweep("oldDeviceLogs", `delete from device_logs where created_at<$1`, now.Add(-90*24*time.Hour))
	sweep("oldReadNotifications", `delete from notifications where read_at is not null and created_at<$1`, now.Add(-180*24*time.Hour))
	sweep("oldSensorReadings", `delete from sensor_readings where received_at<$1`, now.Add(-time.Duration(days)*24*time.Hour))
	sweep("oldAuditLogs", `delete from audit_logs where created_at<$1`, now.Add(-time.Duration(days*2)*24*time.Hour))
	sweep("resolvedRisks", `delete from farm_risks where active=false and resolved_at is not null and resolved_at<$1`, now.Add(-180*24*time.Hour))
	return deleted
}
