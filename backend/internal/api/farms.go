package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

func (s *Server) farmsGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	archived := r.URL.Query().Get("archived") == "1"
	query := `select id::text,name,location_name,latitude::text,longitude::text,size::text,area_unit,soil_type,irrigation::text,elevation_m::text,archived_at,created_at,version,owner_id::text
		from farms where (owner_id=$1 or id in (select farm_id from farm_members where user_id=$1))`
	if !archived {
		query += " and archived_at is null"
	}
	query += " order by created_at"
	rows, err := s.DB.Query(r.Context(), query, u.ID)
	if err != nil {
		Error(w, r, err)
		return
	}
	defer rows.Close()
	out := []interface{}{}
	for rows.Next() {
		var id, name string
		var loc, soil interface{}
		var lat, lng, size, area, irrig, elev string
		var arch interface{}
		var created time.Time
		var ver int
		var owner string
		if err := rows.Scan(&id, &name, &loc, &lat, &lng, &size, &area, &soil, &irrig, &elev, &arch, &created, &ver, &owner); err != nil {
			Error(w, r, err)
			return
		}
		out = append(out, map[string]interface{}{"id": id, "name": name, "locationName": loc, "latitude": lat, "longitude": lng, "size": size, "areaUnit": area, "soilType": soil, "irrigation": irrig, "elevationM": elev, "archivedAt": arch, "createdAt": created, "version": ver})
	}
	JSON(w, map[string]interface{}{"farms": out}, 200)
}

func (s *Server) farmsPost(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	var b struct {
		Name         string   `json:"name"`
		LocationName *string  `json:"locationName"`
		Latitude     float64  `json:"latitude"`
		Longitude    float64  `json:"longitude"`
		Size         float64  `json:"size"`
		AreaUnit     string   `json:"areaUnit"`
		SoilType     *string  `json:"soilType"`
		Irrigation   string   `json:"irrigation"`
		ElevationM   *float64 `json:"elevationM"`
		ClientID     string   `json:"clientId"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	if len(b.Name) < 2 || b.Latitude < -90 || b.Latitude > 90 || b.Longitude < -180 || b.Longitude > 180 || b.Size <= 0 {
		Error(w, r, validation("Validation failed", nil))
		return
	}
	if b.AreaUnit == "" {
		b.AreaUnit = "hectares"
	}
	if b.Irrigation == "" {
		b.Irrigation = "rainfed"
	}
	if b.ClientID != "" {
		var id string
		err := s.DB.QueryRow(r.Context(), `select id::text from farms where owner_id=$1 and client_id=$2`, u.ID, b.ClientID).Scan(&id)
		if err == nil {
			f, _ := s.getFarmForUser(r.Context(), u, id, "read")
			JSON(w, map[string]interface{}{"farm": f}, 200)
			return
		}
	}
	var id string
	err := s.DB.QueryRow(r.Context(), `insert into farms(owner_id,name,location_name,latitude,longitude,size,area_unit,soil_type,irrigation,elevation_m,client_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id::text`,
		u.ID, b.Name, b.LocationName, b.Latitude, b.Longitude, b.Size, b.AreaUnit, b.SoilType, b.Irrigation, b.ElevationM, b.ClientID).Scan(&id)
	if err != nil {
		Error(w, r, err)
		return
	}
	f, _ := s.getFarmForUser(r.Context(), u, id, "read")
	JSON(w, map[string]interface{}{"farm": f}, 201)
}

func (s *Server) farmGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	f, e := s.getFarmForUser(r.Context(), u, chi.URLParam(r, "farmId"), "read")
	if e != nil {
		Error(w, r, e)
		return
	}
	can := u.Role == "admin"
	if owner, ok := f["ownerId"].(string); ok && owner == u.ID {
		can = true
	}
	var role string
	if owner, ok := f["ownerId"].(string); ok && owner != u.ID {
		_ = s.DB.QueryRow(r.Context(), `select role from farm_members where farm_id=$1 and user_id=$2`, f["id"], u.ID).Scan(&role)
		can = role == "manager"
	}
	JSON(w, map[string]interface{}{"farm": f, "canEdit": can}, 200)
}
func (s *Server) farmPatch(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	id := chi.URLParam(r, "farmId")
	cur, e := s.getFarmForUser(r.Context(), u, id, "write")
	if e != nil {
		Error(w, r, e)
		return
	}
	var b map[string]interface{}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	ver, ok := b["version"].(float64)
	if !ok {
		Error(w, r, badRequest("Version is required"))
		return
	}
	if int(ver) != cur["version"].(int) {
		Error(w, r, conflict("The farm has changed.", map[string]interface{}{"current": cur["version"]}))
		return
	}
	cols := map[string]string{"name": "name", "locationName": "location_name", "latitude": "latitude", "longitude": "longitude", "size": "size", "areaUnit": "area_unit", "soilType": "soil_type", "irrigation": "irrigation", "elevationM": "elevation_m"}
	for k, col := range cols {
		if v, ok := b[k]; ok {
			_, _ = s.DB.Exec(r.Context(), "update farms set "+col+"=$1,version=version+1,updated_at=$2 where id=$3", v, time.Now(), id)
		}
	}
	if arch, ok := b["archived"].(bool); ok {
		if arch {
			_, _ = s.DB.Exec(r.Context(), `update farms set archived_at=$1,version=version+1,updated_at=$1 where id=$2`, time.Now(), id)
		} else {
			_, _ = s.DB.Exec(r.Context(), `update farms set archived_at=null,version=version+1,updated_at=$1 where id=$2`, time.Now(), id)
		}
	}
	f, _ := s.getFarmForUser(r.Context(), u, id, "read")
	JSON(w, map[string]interface{}{"farm": f}, 200)
}
func (s *Server) farmDelete(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	id := chi.URLParam(r, "farmId")
	cur, e := s.getFarmForUser(r.Context(), u, id, "write")
	if e != nil {
		Error(w, r, e)
		return
	}
	if cur["ownerId"].(string) != u.ID && u.Role != "admin" {
		Error(w, r, forbidden(""))
		return
	}
	_, _ = s.DB.Exec(r.Context(), `delete from farms where id=$1`, id)
	JSON(w, nil, 204)
}
