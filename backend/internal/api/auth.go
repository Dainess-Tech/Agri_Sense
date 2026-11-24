package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const sessionCookie = "agrisense_session"

type User struct {
	ID, FullName, Email, Role, PasswordHash string
	Phone, Country                          *string
	Language, MeasurementSystem             string
	EmailVerifiedAt, CreatedAt              interface{}
}

type ctxKey string

const userKey ctxKey = "user"

var buckets sync.Map

func rateLimit(key string, limit int, window time.Duration) error {
	type bucket struct {
		count int
		reset time.Time
	}
	now := time.Now()
	v, _ := buckets.LoadOrStore(key, &bucket{count: 0, reset: now.Add(window)})
	b := v.(*bucket)
	b.count++
	if b.reset.Before(now) {
		b.count = 1
		b.reset = now.Add(window)
	}
	if b.count > limit {
		secs := int(time.Until(b.reset).Seconds())
		if secs < 1 {
			secs = 1
		}
		return &APIError{429, "rate_limited", "Too many requests. Try again in " + itoa(secs) + "s.", nil}
	}
	return nil
}
func itoa(n int) string { return strconv.Itoa(n) }

func publicUser(row pgx.Row) (map[string]interface{}, error) {
	var id uuid.UUID
	var fullName, email, role, lang, measure string
	var phone, country *string
	var verified *time.Time
	var created time.Time
	err := row.Scan(&id, &fullName, &email, &role, &phone, &country, &lang, &measure, &verified, &created)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"id": id.String(), "fullName": fullName, "email": email, "role": role, "phone": phone, "country": country,
		"language": lang, "measurementSystem": measure, "emailVerified": verified != nil, "createdAt": created}, nil
}
func publicUserValues(r *http.Request) (*User, error) {
	if v := r.Context().Value(userKey); v != nil {
		return v.(*User), nil
	}
	return nil, unauthorized("")
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		var u User
		err = s.DB.QueryRow(r.Context(), `select u.id,u.full_name,u.email,u.role,u.password_hash,u.phone,u.country,u.language,u.measurement_system,u.email_verified_at,u.created_at
			from sessions s join users u on u.id=s.user_id
			where s.token_hash=$1 and s.expires_at>$2 limit 1`, sha(c.Value), time.Now()).Scan(
			&u.ID, &u.FullName, &u.Email, &u.Role, &u.PasswordHash, &u.Phone, &u.Country, &u.Language, &u.MeasurementSystem, &u.EmailVerifiedAt, &u.CreatedAt)
		if err == nil {
			ctx := context.WithValue(r.Context(), userKey, &u)
			r = r.WithContext(ctx)
		}
		next.ServeHTTP(w, r)
	})
}
func requireAuth(r *http.Request) (*User, error) {
	u, _ := r.Context().Value(userKey).(*User)
	if u == nil {
		return nil, unauthorized("")
	}
	return u, nil
}
func setSession(w http.ResponseWriter, r *http.Request, db interface {
	Exec(context.Context, string, ...interface{}) (interface{}, error)
}) {
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request, userID string) error {
	token := randomToken()
	expires := time.Now().Add(30 * 24 * time.Hour)
	_, err := s.DB.Exec(r.Context(), `insert into sessions(user_id,token_hash,expires_at,user_agent) values($1,$2,$3,$4)`,
		userID, sha(token), expires, strings.TrimSpace(r.UserAgent())[:min(len(strings.TrimSpace(r.UserAgent())), 255)])
	if err != nil {
		return err
	}
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	if os.Getenv("INSECURE_COOKIES") == "1" {
		secure = false
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Expires: expires, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure, Path: "/"})
	return nil
}
func (s *Server) destroySession(w http.ResponseWriter, r *http.Request) {
	if c, e := r.Cookie(sessionCookie); e == nil {
		_, _ = s.DB.Exec(r.Context(), `delete from sessions where token_hash=$1`, sha(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Expires: time.Unix(1, 0), MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Path: "/"})
}

func bcryptHash(p string) (string, error) {
	b, e := bcrypt.GenerateFromPassword([]byte(p), 11)
	return string(b), e
}

func (s *Server) authGet(w http.ResponseWriter, r *http.Request) {
	action := chi.URLParam(r, "action")
	if action != "me" {
		Error(w, r, notFound(""))
		return
	}
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	JSON(w, map[string]interface{}{"user": s.userJSON(u)}, 200)
}

func (s *Server) authPost(w http.ResponseWriter, r *http.Request) {
	action := chi.URLParam(r, "action")
	switch action {
	case "register":
		s.register(w, r)
	case "login":
		s.login(w, r)
	case "logout":
		s.destroySession(w, r)
		JSON(w, nil, 204)
	case "forgot-password":
		s.forgot(w, r)
	case "reset-password":
		s.reset(w, r)
	case "verify-email":
		s.verify(w, r)
	case "resend-verification":
		s.resend(w, r)
	default:
		Error(w, r, notFound(""))
	}
}
func (s *Server) userJSON(u *User) map[string]interface{} {
	emailVerified := false
	if u.EmailVerifiedAt != nil {
		emailVerified = true
	}
	return map[string]interface{}{"id": u.ID, "fullName": u.FullName, "email": u.Email, "role": u.Role, "phone": u.Phone, "country": u.Country, "language": u.Language, "measurementSystem": u.MeasurementSystem, "emailVerified": emailVerified, "createdAt": u.CreatedAt}
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.RemoteAddr
	}
	if err := rateLimit("register:"+ip, 10, 15*time.Minute); err != nil {
		Error(w, r, err)
		return
	}
	var b struct {
		FullName string  `json:"fullName"`
		Email    string  `json:"email"`
		Password string  `json:"password"`
		Country  *string `json:"country"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	b.Email = strings.ToLower(strings.TrimSpace(b.Email))
	b.FullName = strings.TrimSpace(b.FullName)
	if len(b.FullName) < 2 || len(b.Password) < 8 || len(b.Password) > 128 {
		Error(w, r, validation("Validation failed", nil))
		return
	}
	_ = s.ensureSeed(r.Context())
	var exists int
	_ = s.DB.QueryRow(r.Context(), `select 1 from users where email=$1`, b.Email).Scan(&exists)
	if exists == 1 {
		Error(w, r, &APIError{409, "conflict", "An account with this email already exists.", nil})
		return
	}
	var total int
	if err := s.DB.QueryRow(r.Context(), `select count(*) from users`).Scan(&total); err != nil {
		Error(w, r, err)
		return
	}
	role := "farmer"
	if total == 0 {
		role = "admin"
	}
	h, _ := bcryptHash(b.Password)
	var id uuid.UUID
	err := s.DB.QueryRow(r.Context(), `insert into users(full_name,email,password_hash,country,role) values($1,$2,$3,$4,$5) returning id`,
		b.FullName, b.Email, h, b.Country, role).Scan(&id)
	if err != nil {
		Error(w, r, &APIError{409, "conflict", "An account with this email already exists.", nil})
		return
	}
	_, _ = s.DB.Exec(r.Context(), `insert into notification_preferences(user_id) values($1) on conflict do nothing`, id)
	token := randomToken()
	_, _ = s.DB.Exec(r.Context(), `insert into auth_tokens(user_id,type,token_hash,expires_at) values($1,'verify_email',$2,$3)`, id, sha(token), time.Now().Add(24*time.Hour))
	link := s.appURL(r) + "/auth/verify?token=" + token
	s.sendMail(b.Email, "Verify your AgriSense email", "Welcome to AgriSense! Verify your email: "+link)
	dev := ""
	if os.Getenv("NODE_ENV") != "production" && os.Getenv("MAIL_PROVIDER") == "" {
		dev = link
	}
	if err := s.createSession(w, r, id.String()); err != nil {
		Error(w, r, err)
		return
	}
	u := &User{ID: id.String(), FullName: b.FullName, Email: b.Email, Role: role, Country: b.Country, Language: "en", MeasurementSystem: "metric"}
	resp := map[string]interface{}{"user": s.userJSON(u)}
	if dev != "" {
		resp["devVerificationLink"] = dev
	}
	JSON(w, resp, 201)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.RemoteAddr
	}
	if err := rateLimit("login:"+ip, 20, 15*time.Minute); err != nil {
		Error(w, r, err)
		return
	}
	var b struct{ Email, Password string }
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	b.Email = strings.ToLower(strings.TrimSpace(b.Email))
	if err := rateLimit("login:"+b.Email, 8, 15*time.Minute); err != nil {
		Error(w, r, err)
		return
	}
	var u User
	err := s.DB.QueryRow(r.Context(), `select id,full_name,email,role,password_hash,phone,country,language,measurement_system,email_verified_at,created_at from users where email=$1`, b.Email).Scan(
		&u.ID, &u.FullName, &u.Email, &u.Role, &u.PasswordHash, &u.Phone, &u.Country, &u.Language, &u.MeasurementSystem, &u.EmailVerifiedAt, &u.CreatedAt)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(b.Password)) != nil {
		Error(w, r, unauthorized("Incorrect email or password."))
		return
	}
	if err := s.createSession(w, r, u.ID); err != nil {
		Error(w, r, err)
		return
	}
	JSON(w, map[string]interface{}{"user": s.userJSON(&u)}, 200)
}

func (s *Server) appURL(r *http.Request) string {
	if u := os.Getenv("APP_URL"); u != "" {
		return u
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func (s *Server) forgot(w http.ResponseWriter, r *http.Request) {
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.RemoteAddr
	}
	if err := rateLimit("forgot:"+ip, 5, 15*time.Minute); err != nil {
		Error(w, r, err)
		return
	}
	var b struct {
		Email string `json:"email"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	b.Email = strings.ToLower(strings.TrimSpace(b.Email))
	var id string
	if err := s.DB.QueryRow(r.Context(), `select id::text from users where email=$1`, b.Email).Scan(&id); err == nil {
		token := randomToken()
		_, _ = s.DB.Exec(r.Context(), `insert into auth_tokens(user_id,type,token_hash,expires_at) values($1,'reset_password',$2,$3)`, id, sha(token), time.Now().Add(time.Hour))
		link := s.appURL(r) + "/auth/reset?token=" + token
		s.sendMail(b.Email, "Reset your AgriSense password", "Reset your password (valid 1 hour): "+link)
	}
	JSON(w, map[string]interface{}{"message": "If an account exists for that email, a reset link has been sent."}, 200)
}
func (s *Server) reset(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	if len(b.Password) < 8 {
		Error(w, r, validation("Validation failed", nil))
		return
	}
	h, _ := bcryptHash(b.Password)
	var id string
	err := s.DB.QueryRow(r.Context(), `select user_id::text from auth_tokens where token_hash=$1 and type='reset_password' and used_at is null and expires_at>$2 limit 1`, sha(b.Token), time.Now()).Scan(&id)
	if err != nil {
		Error(w, r, badRequest("This link is invalid or has expired."))
		return
	}
	tx, _ := s.DB.Begin(r.Context())
	defer tx.Rollback(r.Context())
	_, _ = tx.Exec(r.Context(), `update auth_tokens set used_at=$1 where token_hash=$2`, time.Now(), sha(b.Token))
	_, _ = tx.Exec(r.Context(), `update users set password_hash=$1,updated_at=$2 where id=$3`, h, time.Now(), id)
	_, _ = tx.Exec(r.Context(), `delete from sessions where user_id=$1`, id)
	_ = tx.Commit(r.Context())
	JSON(w, map[string]interface{}{"message": "Password updated. Please sign in."}, 200)
}
func (s *Server) verify(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Token string `json:"token"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	var id string
	err := s.DB.QueryRow(r.Context(), `select user_id::text from auth_tokens where token_hash=$1 and type='verify_email' and used_at is null and expires_at>$2 limit 1`, sha(b.Token), time.Now()).Scan(&id)
	if err != nil {
		Error(w, r, badRequest("This link is invalid or has expired."))
		return
	}
	_, _ = s.DB.Exec(r.Context(), `update auth_tokens set used_at=$1 where token_hash=$2`, time.Now(), sha(b.Token))
	_, _ = s.DB.Exec(r.Context(), `update users set email_verified_at=$1,updated_at=$1 where id=$2`, time.Now(), id)
	JSON(w, map[string]interface{}{"message": "Email verified."}, 200)
}
func (s *Server) resend(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	token := randomToken()
	_, _ = s.DB.Exec(r.Context(), `insert into auth_tokens(user_id,type,token_hash,expires_at) values($1,'verify_email',$2,$3)`, u.ID, sha(token), time.Now().Add(24*time.Hour))
	link := s.appURL(r) + "/auth/verify?token=" + token
	s.sendMail(u.Email, "Verify your AgriSense email", "Verify your email: "+link)
	JSON(w, map[string]interface{}{"message": "Verification email sent."}, 200)
}
