package api

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type Farm struct {
	ID, OwnerID, Name, Latitude, Longitude, Size, AreaUnit, Irrigation, LocationName, SoilType, ElevationM, ArchivedAt string
	Version                                                                                                            int
}

func (s *Server) getFarmForUser(ctx context.Context, u *User, farmID, mode string) (map[string]interface{}, error) {
	var exists bool
	if err := s.DB.QueryRow(ctx, `select exists(select 1 from farms where id=$1)`, farmID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, notFound("Farm not found")
	}
	var id, owner, name, latitude, longitude, size, areaUnit, irrigation string
	var locationName, soilType, elevationM, archivedAt interface{}
	var createdAt interface{}
	var version int
	err := s.DB.QueryRow(ctx, `select id::text,owner_id::text,name,latitude::text,longitude::text,size::text,area_unit,irrigation::text,location_name,soil_type,elevation_m::text,coalesce(archived_at::text,''),created_at,version from farms where id=$1`, farmID).Scan(&id, &owner, &name, &latitude, &longitude, &size, &areaUnit, &irrigation, &locationName, &soilType, &elevationM, &archivedAt, &createdAt, &version)
	if err != nil {
		return nil, err
	}
	if owner == u.ID || u.Role == "admin" {
		return map[string]interface{}{"id": id, "ownerId": owner, "name": name, "latitude": latitude, "longitude": longitude, "size": size, "areaUnit": areaUnit, "irrigation": irrigation, "locationName": locationName, "soilType": soilType, "elevationM": elevationM, "archivedAt": nilIfEmpty(archivedAt), "createdAt": createdAt, "version": version}, nil
	}
	var memberRole string
	err = s.DB.QueryRow(ctx, `select role from farm_members where farm_id=$1 and user_id=$2`, farmID, u.ID).Scan(&memberRole)
	if mode == "read" && (err == nil || u.Role == "agronomist") {
		return map[string]interface{}{"id": id, "ownerId": owner, "name": name, "latitude": latitude, "longitude": longitude, "size": size, "areaUnit": areaUnit, "irrigation": irrigation, "locationName": locationName, "soilType": soilType, "elevationM": elevationM, "archivedAt": nilIfEmpty(archivedAt), "createdAt": createdAt, "version": version}, nil
	}
	if mode == "write" && memberRole == "manager" {
		return map[string]interface{}{"id": id, "ownerId": owner, "name": name, "latitude": latitude, "longitude": longitude, "size": size, "areaUnit": areaUnit, "irrigation": irrigation, "locationName": locationName, "soilType": soilType, "elevationM": elevationM, "archivedAt": nilIfEmpty(archivedAt), "createdAt": createdAt, "version": version}, nil
	}
	return nil, forbidden("")
}
func nilIfEmpty(v interface{}) interface{} {
	if s, ok := v.(string); ok && s == "" {
		return nil
	}
	return v
}

func farmID(r *http.Request) string { return chi.URLParam(r, "farmId") }
