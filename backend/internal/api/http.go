package api

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type APIError struct {
	Status  int
	Code    string
	Message string
	Details interface{}
}

func (e *APIError) Error() string { return e.Message }
func badRequest(m string, d ...interface{}) *APIError {
	var x interface{}
	if len(d) > 0 {
		x = d[0]
	}
	return &APIError{400, "bad_request", m, x}
}
func unauthorized(m string) *APIError {
	if m == "" {
		m = "Authentication required"
	}
	return &APIError{401, "unauthorized", m, nil}
}
func forbidden(m string) *APIError {
	if m == "" {
		m = "You do not have permission to access this resource"
	}
	return &APIError{403, "forbidden", m, nil}
}
func notFound(m string) *APIError {
	if m == "" {
		m = "Resource not found"
	}
	return &APIError{404, "not_found", m, nil}
}
func conflict(m string, d interface{}) *APIError   { return &APIError{409, "conflict", m, d} }
func validation(m string, d interface{}) *APIError { return &APIError{422, "validation_failed", m, d} }

type Server struct {
	DB  *pgxpool.Pool
	Mux *chi.Mux
}

func NewServer(db *pgxpool.Pool) *Server {
	s := &Server{DB: db, Mux: chi.NewRouter()}
	s.routes()
	return s
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.Mux.ServeHTTP(w, r) }

func JSON(w http.ResponseWriter, v interface{}, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func Error(w http.ResponseWriter, r *http.Request, err error) {
	var ae *APIError
	if !errors.As(err, &ae) {
		log.Printf("[api] %s %s failed: %v", r.Method, r.URL.Path, err)
		ae = &APIError{500, "internal_error", "Unexpected server error", nil}
	}
	JSON(w, map[string]interface{}{"error": map[string]interface{}{"code": ae.Code, "message": ae.Message, "details": ae.Details}}, ae.Status)
}
func decode(w http.ResponseWriter, r *http.Request, dst interface{}) error {
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		return badRequest("Request body must be valid JSON")
	}
	return nil
}
func sha(v string) string {
	h := sha256.Sum256([]byte(v))
	return fmt.Sprintf("%x", h[:])
}
func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = uuid.NewRandom()
	u := uuid.New()
	s := strings.ReplaceAll(u.String(), "-", "")
	if len(s) >= n*2 {
		s = s[:n*2]
	}
	copy(b, []byte(s))
	return fmt.Sprintf("%x", b)
}
func randomToken() string {
	return strings.ReplaceAll(uuid.New().String(), "-", "") + strings.ReplaceAll(uuid.New().String(), "-", "")
}
func uuidParam(r *http.Request, name string) (uuid.UUID, error) {
	x, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		return uuid.Nil, notFound("")
	}
	return x, nil
}
func page(r *http.Request, def, max int) (limit, offset, page int) {
	limit = atoi(r.URL.Query().Get("limit"), def)
	if limit < 1 {
		limit = def
	}
	if limit > max {
		limit = max
	}
	page = atoi(r.URL.Query().Get("page"), 1)
	if page < 1 {
		page = 1
	}
	offset = (page - 1) * limit
	return
}
func atoi(s string, def int) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}
func dateOnly(s string) (string, bool) {
	t, err := time.Parse("2006-01-02", s)
	return s, err == nil && t.Format("2006-01-02") == s
}
