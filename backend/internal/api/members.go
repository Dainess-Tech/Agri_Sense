package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Server) requireMemberManager(r *http.Request, u *User, farmID string) (map[string]interface{}, error) {
	f, e := s.getFarmForUser(r.Context(), u, farmID, "read")
	if e != nil {
		return nil, e
	}
	if f["ownerId"].(string) != u.ID && u.Role != "admin" {
		return nil, forbidden("Only the farm owner or an administrator can manage farm members")
	}
	return f, nil
}
func (s *Server) membersGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	fid := chi.URLParam(r, "farmId")
	f, e := s.getFarmForUser(r.Context(), u, fid, "read")
	if e != nil {
		Error(w, r, e)
		return
	}
	var owner map[string]interface{}
	var oid, oname, oemail, orole string
	_ = s.DB.QueryRow(r.Context(), `select id::text,full_name,email,role::text from users where id=$1`, f["ownerId"]).Scan(&oid, &oname, &oemail, &orole)
	owner = map[string]interface{}{"id": oid, "fullName": oname, "email": oemail, "role": orole}
	rows, err := s.DB.Query(r.Context(), `select m.user_id::text,m.role,u.full_name,u.email,u.role::text,m.created_at from farm_members m join users u on u.id=m.user_id where m.farm_id=$1 order by m.created_at`, fid)
	if err != nil {
		Error(w, r, err)
		return
	}
	defer rows.Close()
	out := []interface{}{}
	for rows.Next() {
		var uid, memberRole, name, email, userRole string
		var created interface{}
		if err := rows.Scan(&uid, &memberRole, &name, &email, &userRole, &created); err != nil {
			continue
		}
		out = append(out, map[string]interface{}{"farmId": fid, "userId": uid, "role": memberRole, "createdAt": created, "user": map[string]interface{}{"id": uid, "fullName": name, "email": email, "role": userRole}})
	}
	JSON(w, map[string]interface{}{"owner": owner, "members": out}, 200)
}
func (s *Server) membersPost(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	fid := chi.URLParam(r, "farmId")
	f, e := s.requireMemberManager(r, u, fid)
	if e != nil {
		Error(w, r, e)
		return
	}
	var b struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	if b.Role != "viewer" && b.Role != "manager" {
		b.Role = "viewer"
	}
	var uid, name string
	err := s.DB.QueryRow(r.Context(), `select id::text,full_name from users where email=$1`, b.Email).Scan(&uid, &name)
	if err != nil {
		Error(w, r, notFound("No AgriSense account found with that email address"))
		return
	}
	if uid == f["ownerId"].(string) {
		Error(w, r, badRequest("The farm owner already has full access"))
		return
	}
	_, err = s.DB.Exec(r.Context(), `insert into farm_members(farm_id,user_id,role) values($1,$2,$3) on conflict(farm_id,user_id) do update set role=excluded.role`, fid, uid, b.Role)
	if err != nil {
		Error(w, r, err)
		return
	}
	JSON(w, map[string]interface{}{"member": map[string]interface{}{"farmId": fid, "userId": uid, "role": b.Role, "user": map[string]interface{}{"id": uid, "fullName": name, "email": b.Email}}}, 201)
}
func (s *Server) membersPatch(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	fid := chi.URLParam(r, "farmId")
	f, e := s.requireMemberManager(r, u, fid)
	if e != nil {
		Error(w, r, e)
		return
	}
	var b struct {
		UserID string `json:"userId"`
		Role   string `json:"role"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	if b.Role != "viewer" && b.Role != "manager" {
		Error(w, r, badRequest("Invalid role"))
		return
	}
	if b.UserID == f["ownerId"].(string) {
		Error(w, r, badRequest("The farm owner's access cannot be changed"))
		return
	}
	tag, err := s.DB.Exec(r.Context(), `update farm_members set role=$1 where farm_id=$2 and user_id=$3`, b.Role, fid, b.UserID)
	if err != nil {
		Error(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		Error(w, r, notFound("Farm member not found"))
		return
	}
	JSON(w, map[string]interface{}{"member": map[string]interface{}{"farmId": fid, "userId": b.UserID, "role": b.Role}}, 200)
}
func (s *Server) membersDelete(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	fid := chi.URLParam(r, "farmId")
	f, e := s.requireMemberManager(r, u, fid)
	if e != nil {
		Error(w, r, e)
		return
	}
	uid := r.URL.Query().Get("userId")
	if uid == "" {
		Error(w, r, badRequest("A valid userId is required"))
		return
	}
	if uid == f["ownerId"].(string) {
		Error(w, r, badRequest("The farm owner cannot be removed"))
		return
	}
	tag, err := s.DB.Exec(r.Context(), `delete from farm_members where farm_id=$1 and user_id=$2`, fid, uid)
	if err != nil {
		Error(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		Error(w, r, notFound("Farm member not found"))
		return
	}
	JSON(w, map[string]bool{"removed": true}, 200)
}
