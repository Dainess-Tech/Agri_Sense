package api

import (
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
)

func (s *Server) recommendationPatch(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	id := chi.URLParam(r, "recommendationId")
	var farm string
	if err := s.DB.QueryRow(r.Context(), `select farm_id::text from recommendations where id=$1`, id).Scan(&farm); err != nil {
		Error(w, r, notFound(""))
		return
	}
	if _, e = s.getFarmForUser(r.Context(), u, farm, "read"); e != nil {
		Error(w, r, e)
		return
	}
	var b struct {
		Status string `json:"status"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	if b.Status != "new" && b.Status != "read" && b.Status != "completed" {
		Error(w, r, badRequest("Invalid status"))
		return
	}
	var row map[string]interface{}
	_, _ = s.DB.Exec(r.Context(), `update recommendations set status=$1,updated_at=$2 where id=$3`, b.Status, time.Now(), id)
	row = map[string]interface{}{"id": id, "status": b.Status}
	JSON(w, map[string]interface{}{"recommendation": row}, 200)
}
func (s *Server) notificationsGet(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	limit, offset, page := page(r, 50, 500)
	unread := r.URL.Query().Get("unread") == "1"
	query := `select id::text,type,severity::text,title,body,link,read_at,created_at from notifications where user_id=$1`
	args := []interface{}{u.ID}
	if unread {
		query += ` and read_at is null`
	}
	query += ` order by created_at desc limit $2 offset $3`
	args = append(args, limit, offset)
	rows, err := s.DB.Query(r.Context(), query, args...)
	if err != nil {
		Error(w, r, err)
		return
	}
	defer rows.Close()
	out := []interface{}{}
	for rows.Next() {
		var id, typ, severity, title, body string
		var link interface{}
		var read interface{}
		var created time.Time
		rows.Scan(&id, &typ, &severity, &title, &body, &link, &read, &created)
		out = append(out, map[string]interface{}{"id": id, "type": typ, "severity": severity, "title": title, "body": body, "link": link, "readAt": read, "createdAt": created})
	}
	var unreadCount int
	_ = s.DB.QueryRow(r.Context(), `select count(*) from notifications where user_id=$1 and read_at is null`, u.ID).Scan(&unreadCount)
	JSON(w, map[string]interface{}{"notifications": out, "unread": unreadCount, "page": page, "limit": limit}, 200)
}
func (s *Server) notificationsPost(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	_, _ = s.DB.Exec(r.Context(), `update notifications set read_at=now() where user_id=$1 and read_at is null`, u.ID)
	JSON(w, nil, 204)
}
func (s *Server) notificationGet(w http.ResponseWriter, r *http.Request) {
	_, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	if chi.URLParam(r, "notificationId") != "push" {
		Error(w, r, notFound(""))
		return
	}
	pub := os.Getenv("VAPID_PUBLIC_KEY")
	JSON(w, map[string]interface{}{"configured": pub != "" && os.Getenv("VAPID_PRIVATE_KEY") != "", "publicKey": nilIfText(pub)}, 200)
}
func (s *Server) notificationPost(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	if chi.URLParam(r, "notificationId") != "push" {
		Error(w, r, notFound(""))
		return
	}
	var b struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	_, err := s.DB.Exec(r.Context(), `insert into push_subscriptions(user_id,endpoint,p256dh,auth) values($1,$2,$3,$4) on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,user_id=excluded.user_id`, u.ID, b.Endpoint, b.Keys.P256dh, b.Keys.Auth)
	if err != nil {
		Error(w, r, err)
		return
	}
	JSON(w, map[string]bool{"ok": true}, 201)
}
func (s *Server) notificationPatch(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	id := chi.URLParam(r, "notificationId")
	var b struct {
		Read bool `json:"read"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	var readAt interface{}
	if b.Read {
		readAt = time.Now()
	} else {
		readAt = nil
	}
	tag, err := s.DB.Exec(r.Context(), `update notifications set read_at=$1 where id=$2 and user_id=$3`, readAt, id, u.ID)
	if err != nil {
		Error(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		Error(w, r, notFound(""))
		return
	}
	JSON(w, map[string]interface{}{"notification": map[string]interface{}{"id": id, "read": b.Read}}, 200)
}
