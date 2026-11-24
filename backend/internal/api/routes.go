package api

import "net/http"

func (s *Server) routes() {
	s.Mux.Use(s.authMiddleware)
	s.Mux.Get("/api/health", s.health)
	s.Mux.Get("/api/v1", s.index)
	s.Mux.Get("/api/v1/auth/{action}", s.authGet)
	s.Mux.Post("/api/v1/auth/{action}", s.authPost)
	s.Mux.Get("/api/v1/users/{section}", s.usersGet)
	s.Mux.Patch("/api/v1/users/{section}", s.usersPatch)
	s.Mux.Delete("/api/v1/users/{section}", s.usersDelete)
	s.Mux.Get("/api/v1/farms", s.farmsGet)
	s.Mux.Post("/api/v1/farms", s.farmsPost)
	s.Mux.Get("/api/v1/farms/{farmId}", s.farmGet)
	s.Mux.Patch("/api/v1/farms/{farmId}", s.farmPatch)
	s.Mux.Delete("/api/v1/farms/{farmId}", s.farmDelete)
	s.Mux.Get("/api/v1/farms/{farmId}/members", s.membersGet)
	s.Mux.Post("/api/v1/farms/{farmId}/members", s.membersPost)
	s.Mux.Patch("/api/v1/farms/{farmId}/members", s.membersPatch)
	s.Mux.Delete("/api/v1/farms/{farmId}/members", s.membersDelete)
	s.Mux.Get("/api/v1/farms/{farmId}/{resource}", s.farmResourceGet)
	s.Mux.Post("/api/v1/farms/{farmId}/{resource}", s.farmResourcePost)
	s.Mux.Get("/api/v1/crops", s.cropsGet)
	s.Mux.Get("/api/v1/plantings", s.plantingsGet)
	s.Mux.Post("/api/v1/plantings", s.plantingsPost)
	s.Mux.Get("/api/v1/plantings/{plantingId}", s.plantingGet)
	s.Mux.Patch("/api/v1/plantings/{plantingId}", s.plantingPatch)
	s.Mux.Delete("/api/v1/plantings/{plantingId}", s.plantingDelete)
	s.Mux.Get("/api/v1/devices", s.devicesGet)
	s.Mux.Post("/api/v1/devices", s.devicesPost)
	s.Mux.Get("/api/v1/devices/{deviceId}", s.deviceGet)
	s.Mux.Patch("/api/v1/devices/{deviceId}", s.devicePatch)
	s.Mux.Post("/api/v1/devices/{deviceId}", s.devicePost)
	s.Mux.Delete("/api/v1/devices/{deviceId}", s.deviceDelete)
	s.Mux.Get("/api/v1/devices/{deviceId}/readings", s.deviceReadings)
	s.Mux.Post("/api/v1/iot/readings", s.iotPost)
	s.Mux.Get("/api/v1/predictions", s.predictionsGet)
	s.Mux.Post("/api/v1/predictions", s.predictionsPost)
	s.Mux.Get("/api/v1/predictions/{predictionId}", s.predictionGet)
	s.Mux.Patch("/api/v1/recommendations/{recommendationId}", s.recommendationPatch)
	s.Mux.Get("/api/v1/notifications", s.notificationsGet)
	s.Mux.Post("/api/v1/notifications", s.notificationsPost)
	s.Mux.Get("/api/v1/notifications/{notificationId}", s.notificationGet)
	s.Mux.Patch("/api/v1/notifications/{notificationId}", s.notificationPatch)
	s.Mux.Post("/api/v1/notifications/{notificationId}", s.notificationPost)
	s.Mux.Get("/api/v1/reports/farms/{farmId}", s.reportGet)
	s.Mux.Get("/api/v1/dashboard", s.dashboardGet)
	s.Mux.Get("/api/v1/admin/{section}", s.adminGet)
	s.Mux.Patch("/api/v1/admin/{section}", s.adminPatch)
	s.Mux.Post("/api/v1/admin/{section}", s.adminPost)
	s.Mux.Delete("/api/v1/admin/{section}", s.adminDelete)
	s.Mux.Get("/api/v1/geo", s.geoGet)
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	var one int
	err := s.DB.QueryRow(r.Context(), "select 1").Scan(&one)
	if err != nil {
		JSON(w, map[string]bool{"ok": false}, 500)
		return
	}
	JSON(w, map[string]bool{"ok": true}, 200)
}
func (s *Server) index(w http.ResponseWriter, r *http.Request) {
	JSON(w, map[string]interface{}{
		"name": "AgriSense API", "version": "v1", "docs": "docs/API.md", "auth": "Session cookie (httpOnly) for users; X-Device-Id + Bearer key for IoT devices",
		"endpoints": map[string]interface{}{
			"auth":            []string{"POST /auth/register", "POST /auth/login", "POST /auth/logout", "GET /auth/me", "POST /auth/forgot-password", "POST /auth/reset-password", "POST /auth/verify-email", "POST /auth/resend-verification"},
			"users":           []string{"GET|PATCH|DELETE /users/profile", "GET|PATCH /users/preferences", "PATCH /users/password", "GET /users/export"},
			"farms":           []string{"GET|POST /farms", "GET|PATCH|DELETE /farms/{id}", "GET|POST|PATCH|DELETE /farms/{id}/members", "GET /farms/{id}/weather", "GET /farms/{id}/soil", "GET /farms/{id}/risks", "GET /farms/{id}/recommendations", "GET|POST /farms/{id}/activities", "GET /farms/{id}/readings", "GET /farms/{id}/predictions"},
			"crops":           []string{"GET /crops"},
			"plantings":       []string{"GET|POST /plantings", "GET|PATCH|DELETE /plantings/{id}"},
			"devices":         []string{"GET|POST /devices", "GET|PATCH|DELETE /devices/{id}", "POST /devices/{id} (rotate-key)", "GET /devices/{id}/readings"},
			"iot":             []string{"POST /iot/readings"},
			"predictions":     []string{"GET|POST /predictions", "GET /predictions/{id}"},
			"recommendations": []string{"PATCH /recommendations/{id}"},
			"notifications":   []string{"GET|POST /notifications", "PATCH /notifications/{id}", "GET|POST /notifications/push"},
			"reports":         []string{"GET /reports/farms/{id}?type=summary|readings|weather|plantings|predictions"},
			"dashboard":       []string{"GET /dashboard"},
			"admin":           []string{"GET /admin/stats|users|audit|crops|varieties|settings", "PATCH /admin/users|crops|varieties|settings", "POST /admin/crops|varieties|announcements|maintenance", "DELETE /admin/crops|varieties|settings"},
			"geo":             []string{"GET /geo?q=", "GET /geo?lat=&lng="},
		},
	}, 200)
}
