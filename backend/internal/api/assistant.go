package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// assistantAnswer is the frontend contract for the in-app assistant. Answers
// are composed only from data already visible elsewhere in AgriSense.
type assistantAnswer struct {
	Answer      string            `json:"answer"`
	Intent      string            `json:"intent"`
	Sources     []assistantSource `json:"sources"`
	Suggestions []string          `json:"suggestions"`
}

type assistantSource struct {
	Label string `json:"label"`
	Href  string `json:"href"`
}

type assistantSuitability struct {
	Score       float64 `json:"score"`
	Verdict     string  `json:"verdict"`
	Explanation string  `json:"explanation"`
}

type assistantAdvisory struct {
	Title    string `json:"title"`
	Body     string `json:"body"`
	Category string `json:"category"`
}

type assistantFactor struct {
	Label       string  `json:"label"`
	Impact      string  `json:"impact"`
	Explanation string  `json:"explanation"`
	DataType    string  `json:"dataType"`
	Multiplier  float64 `json:"multiplier"`
}

type assistantPrediction struct {
	ID           string
	Crop         string
	YieldMin     string
	YieldMax     string
	YieldUnit    string
	Quality      int
	Method       string
	HarvestStart string
	HarvestEnd   string
	Suitability  assistantSuitability
	Advisories   []assistantAdvisory
	Factors      []assistantFactor
}

type assistantPlanting struct {
	Crop, Date, Area, AreaUnit, Status string
}

type assistantRisk struct {
	Category, Title, Explanation, Severity, Source string
}

type assistantRecommendation struct {
	Title, Body, Reason, Severity, Status string
}

type assistantReading struct {
	SensorType string
	Label      string
	Unit       string
	Value      float64
	At         time.Time
}

type assistantDay struct {
	Date       string
	Kind       string
	TMax, TMin *float64
	Precip     *float64
}

type assistantDevice struct {
	Name, UID, Firmware, Hardware string
	LastSeen                      interface{}
	Active                        bool
}

type assistantData struct {
	FarmID          string
	FarmName        string
	Location        string
	Size            string
	AreaUnit        string
	Irrigation      string
	SoilType        string
	Plantings       []assistantPlanting
	Predictions     []assistantPrediction
	Risks           []assistantRisk
	Recommendations []assistantRecommendation
	Readings        map[string]assistantReading
	Weather         []assistantDay
	Soil            interface{}
	Devices         []assistantDevice
	Unread          int
	NoticeTitles    []string
}

func (s *Server) assistantAsk(w http.ResponseWriter, r *http.Request) {
	u, e := requireAuth(r)
	if e != nil {
		Error(w, r, e)
		return
	}
	if err := rateLimit("assistant:"+u.ID, 120, time.Hour); err != nil {
		Error(w, r, err)
		return
	}
	var b struct {
		Question string `json:"question"`
		FarmID   string `json:"farmId"`
	}
	if err := decode(w, r, &b); err != nil {
		Error(w, r, err)
		return
	}
	question := strings.TrimSpace(b.Question)
	if question == "" {
		Error(w, r, badRequest("Enter a question"))
		return
	}
	if len(question) > 500 {
		question = question[:500]
	}
	data, e := s.assistantData(r.Context(), u, b.FarmID)
	if e != nil {
		Error(w, r, e)
		return
	}
	JSON(w, answerQuestion(question, data), 200)
}

func (s *Server) assistantData(ctx context.Context, u *User, requestedFarmID string) (assistantData, error) {
	d := assistantData{Readings: map[string]assistantReading{}}
	farmID := strings.TrimSpace(requestedFarmID)
	if farmID == "" {
		_ = s.DB.QueryRow(ctx, `select id::text from farms
			where (owner_id=$1 or id in (select farm_id from farm_members where user_id=$1)) and archived_at is null
			order by created_at limit 1`, u.ID).Scan(&farmID)
	}
	if farmID == "" {
		return d, notFound("No farm is available for this account")
	}
	f, e := s.getFarmForUser(ctx, u, farmID, "read")
	if e != nil {
		return d, e
	}
	d.FarmID = farmID
	d.FarmName = assistantString(f["name"])
	d.Location = assistantString(f["locationName"])
	d.Size = assistantString(f["size"])
	d.AreaUnit = assistantString(f["areaUnit"])
	d.Irrigation = assistantString(f["irrigation"])
	d.SoilType = assistantString(f["soilType"])
	lat, _ := strconv.ParseFloat(assistantString(f["latitude"]), 64)
	lng, _ := strconv.ParseFloat(assistantString(f["longitude"]), 64)

	if rows, err := s.DB.Query(ctx, `select c.name,p.planting_date::text,p.planted_area::text,p.area_unit,p.status
		from plantings p join crops c on c.id=p.crop_id where p.farm_id=$1 order by p.created_at`, farmID); err == nil {
		for rows.Next() {
			var p assistantPlanting
			if rows.Scan(&p.Crop, &p.Date, &p.Area, &p.AreaUnit, &p.Status) == nil {
				d.Plantings = append(d.Plantings, p)
			}
		}
		rows.Close()
	}

	if rows, err := s.DB.Query(ctx, `select id::text,crop_name,yield_min::text,yield_max::text,yield_unit,data_quality_score,method_version,
		harvest_start::text,harvest_end::text,coalesce(suitability::text,'{}'),coalesce(advisories::text,'[]'),coalesce(factors::text,'[]')
		from predictions where farm_id=$1 order by created_at desc limit 60`, farmID); err == nil {
		for rows.Next() {
			var p assistantPrediction
			var suitability, advisories, factors string
			if rows.Scan(&p.ID, &p.Crop, &p.YieldMin, &p.YieldMax, &p.YieldUnit, &p.Quality, &p.Method,
				&p.HarvestStart, &p.HarvestEnd, &suitability, &advisories, &factors) == nil {
				_ = json.Unmarshal([]byte(suitability), &p.Suitability)
				_ = json.Unmarshal([]byte(advisories), &p.Advisories)
				_ = json.Unmarshal([]byte(factors), &p.Factors)
				d.Predictions = append(d.Predictions, p)
			}
		}
		rows.Close()
	}

	if rows, err := s.DB.Query(ctx, `select category,title,explanation,severity::text,source from farm_risks
		where farm_id=$1 and active=true order by detected_at desc limit 12`, farmID); err == nil {
		for rows.Next() {
			var risk assistantRisk
			if rows.Scan(&risk.Category, &risk.Title, &risk.Explanation, &risk.Severity, &risk.Source) == nil {
				d.Risks = append(d.Risks, risk)
			}
		}
		rows.Close()
	}

	if rows, err := s.DB.Query(ctx, `select title,body,reason,severity::text,status from recommendations
		where farm_id=$1 order by created_at desc limit 12`, farmID); err == nil {
		for rows.Next() {
			var rec assistantRecommendation
			if rows.Scan(&rec.Title, &rec.Body, &rec.Reason, &rec.Severity, &rec.Status) == nil {
				d.Recommendations = append(d.Recommendations, rec)
			}
		}
		rows.Close()
	}

	if rows, err := s.DB.Query(ctx, `select distinct on(sensor_type) sensor_type,value::text,unit,measured_at
		from sensor_readings where farm_id=$1 and quality='valid' and measured_at>now()-interval '30 days'
		order by sensor_type,measured_at desc`, farmID); err == nil {
		for rows.Next() {
			var typ, value, unit string
			var at time.Time
			if rows.Scan(&typ, &value, &unit, &at) == nil {
				reading := assistantReading{SensorType: typ, Label: assistantSensorLabel(typ), Unit: unit, Value: parseFloat(value), At: at}
				if reading.Unit == "" {
					reading.Unit = assistantSensorUnit(typ)
				}
				d.Readings[typ] = reading
			}
		}
		rows.Close()
	}

	if weather, err := s.weatherForecast(lat, lng); err == nil {
		if m, ok := weather.(map[string]interface{}); ok {
			if daily, ok := m["daily"].([]interface{}); ok {
				for _, raw := range daily {
					dayMap, ok := raw.(map[string]interface{})
					if !ok {
						continue
					}
					day := assistantDay{Date: assistantString(dayMap["date"]), Kind: assistantString(dayMap["kind"])}
					day.TMax = assistantFloatPtr(dayMap["tMax"])
					day.TMin = assistantFloatPtr(dayMap["tMin"])
					day.Precip = assistantFloatPtr(dayMap["precipMm"])
					d.Weather = append(d.Weather, day)
				}
			}
		}
	}
	if soil, err := s.soilProfile(lat, lng); err == nil {
		d.Soil = soil
	}

	if rows, err := s.DB.Query(ctx, `select name,device_uid,firmware_version,hardware,last_seen_at,active
		from iot_devices where farm_id=$1 order by created_at`, farmID); err == nil {
		for rows.Next() {
			var dev assistantDevice
			var last interface{}
			if rows.Scan(&dev.Name, &dev.UID, &dev.Firmware, &dev.Hardware, &last, &dev.Active) == nil {
				dev.LastSeen = last
				d.Devices = append(d.Devices, dev)
			}
		}
		rows.Close()
	}

	_ = s.DB.QueryRow(ctx, `select count(*) from notifications where user_id=$1 and read_at is null`, u.ID).Scan(&d.Unread)
	if rows, err := s.DB.Query(ctx, `select title from notifications where user_id=$1 and read_at is null order by created_at desc limit 3`, u.ID); err == nil {
		for rows.Next() {
			var title string
			if rows.Scan(&title) == nil {
				d.NoticeTitles = append(d.NoticeTitles, title)
			}
		}
		rows.Close()
	}
	return d, nil
}

func assistantString(v interface{}) string {
	switch x := v.(type) {
	case string:
		return x
	case fmt.Stringer:
		return x.String()
	default:
		return ""
	}
}

func assistantFloatPtr(v interface{}) *float64 {
	switch x := v.(type) {
	case *float64:
		return x
	case float64:
		return &x
	case int:
		f := float64(x)
		return &f
	default:
		return nil
	}
}

func assistantFloat(v float64, decimals int) string {
	return strconv.FormatFloat(v, 'f', decimals, 64)
}

func assistantNumberText(s string) string {
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return s
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func assistantMoment(v interface{}) string {
	switch x := v.(type) {
	case time.Time:
		if x.IsZero() {
			return "—"
		}
		return x.Format("2 Jan 15:04")
	case string:
		if t, err := time.Parse(time.RFC3339, x); err == nil {
			return t.Format("2 Jan 15:04")
		}
		return x
	default:
		return "—"
	}
}

var assistantSensorLabels = map[string]string{
	"soil_moisture": "soil moisture", "air_temperature": "air temperature", "air_humidity": "air humidity",
	"soil_temperature": "soil temperature", "soil_ph": "soil pH", "soil_n": "soil nitrogen",
	"soil_p": "soil phosphorus", "soil_k": "soil potassium",
}
var assistantSensorUnits = map[string]string{
	"soil_moisture": "%", "air_temperature": "°C", "air_humidity": "%RH", "soil_temperature": "°C",
	"soil_ph": "pH", "soil_n": "mg/kg", "soil_p": "mg/kg", "soil_k": "mg/kg",
}
var assistantSensorOrder = []string{"soil_moisture", "air_temperature", "air_humidity", "soil_temperature", "soil_ph", "soil_n", "soil_p", "soil_k"}

func assistantSensorLabel(typ string) string {
	if label, ok := assistantSensorLabels[typ]; ok {
		return label
	}
	return typ
}
func assistantSensorUnit(typ string) string {
	if unit, ok := assistantSensorUnits[typ]; ok {
		return unit
	}
	return ""
}
func assistantReadingText(r assistantReading) string {
	decimals := 1
	if r.SensorType == "soil_n" || r.SensorType == "soil_p" || r.SensorType == "soil_k" {
		decimals = 0
	}
	separator := ""
	if r.Unit != "" && r.Unit != "%" && r.Unit != "°C" && r.Unit != "%RH" {
		separator = " "
	}
	return assistantFloat(r.Value, decimals) + separator + r.Unit
}

type assistantIntentSpec struct {
	name     string
	priority int
	phrases  []string
	words    []string
}

var assistantIntentSpecs = []assistantIntentSpec{
	{"ingestion", 10, []string{"where does data come from", "where do readings come from", "how do readings", "how do i send", "send a reading", "post a reading", "same endpoint", "api key", "device key"}, []string{"esp32", "mqtt", "ingestion", "endpoint", "firmware", "iot", "key"}},
	{"assistant", 10, []string{"who are you", "what can you do", "what can you ask", "good morning", "good afternoon"}, []string{"hello", "hi", "hey", "help", "capabilities"}},
	{"ai", 9, []string{"how does the ai", "how does ai", "how does the model", "how does the system decide", "why did you", "data quality", "machine learning", "rule engine", "trained", "main limiting"}, []string{"ai", "assistant", "model", "rules", "rule", "suitability", "confidence", "factor", "factors", "explain", "explanation", "limitation", "limitations", "score"}},
	{"risks", 8, []string{"what needs attention", "any risks", "active risks", "what concerns", "any problems", "what is wrong"}, []string{"risk", "risks", "alert", "alerts", "concern", "concerns", "problem", "problems", "attention", "issue", "issues"}},
	{"recommendations", 8, []string{"what should i do", "any advice", "next steps", "what action"}, []string{"recommend", "recommendation", "recommendations", "advice", "suggestion", "suggestions", "action", "actions"}},
	{"irrigation", 8, []string{"should i irrigate", "need water", "supplemental water", "dry spell", "how much water"}, []string{"irrigate", "irrigation", "water", "dry", "drought"}},
	{"sensor", 7, []string{"latest readings", "current readings", "sensor readings", "soil moisture", "air humidity", "soil temperature"}, []string{"reading", "readings", "sensor", "sensors", "humidity", "moisture", "measurement", "measured"}},
	{"yield", 7, []string{"yield estimate", "yield range", "expected yield", "estimated yield", "harvest window", "how much yield"}, []string{"yield", "prediction", "predictions", "harvest", "maize", "bean", "beans", "wheat", "rice", "potato", "potatoes", "estimate"}},
	{"weather", 7, []string{"weather forecast", "forecast rain", "how hot", "how cold"}, []string{"weather", "forecast", "rain", "rainfall", "temperature", "hot", "cold", "climate", "precipitation"}},
	{"soil", 7, []string{"soil ph", "soil nutrients", "soil texture", "soil profile"}, []string{"soil", "ph", "nitrogen", "phosphorus", "potassium", "npk", "nutrients", "sand", "silt", "clay", "soilgrids"}},
	{"device", 7, []string{"device status", "last seen", "connected device", "online device"}, []string{"device", "devices", "node", "station", "online", "offline", "connected"}},
	{"notifications", 7, []string{"unread notifications", "any notifications"}, []string{"notification", "notifications", "unread", "inbox"}},
	{"farm", 5, []string{"farm overview", "tell me about the farm", "what is planted", "what crops"}, []string{"farm", "overview", "planted", "planting", "plantings", "area", "size", "location", "crop", "crops"}},
}

func assistantTokens(question string) map[string]bool {
	lower := strings.ToLower(question)
	tokens := map[string]bool{}
	for _, token := range strings.FieldsFunc(lower, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		tokens[token] = true
	}
	return tokens
}

func classifyAssistantIntent(question string) string {
	lower := strings.ToLower(strings.TrimSpace(question))
	tokens := assistantTokens(lower)
	bestName := "fallback"
	bestScore := 0
	bestPriority := -1
	for _, spec := range assistantIntentSpecs {
		score := 0
		for _, phrase := range spec.phrases {
			if strings.Contains(lower, phrase) {
				score += 5
			}
		}
		for _, word := range spec.words {
			if tokens[word] {
				score += 2
			}
		}
		if score > bestScore || (score == bestScore && score > 0 && spec.priority > bestPriority) {
			bestScore = score
			bestName = spec.name
			bestPriority = spec.priority
		}
	}
	if bestScore < 2 {
		return "fallback"
	}
	return bestName
}

func assistantSources(intent string, d assistantData) []assistantSource {
	farmQuery := "?farmId=" + url.QueryEscape(d.FarmID)
	sources := []assistantSource{}
	seen := map[string]bool{}
	add := func(label, href string) {
		if !seen[href] {
			seen[href] = true
			sources = append(sources, assistantSource{Label: label, Href: href})
		}
	}
	switch intent {
	case "ingestion", "device":
		add("Devices", "/devices")
	case "ai", "yield":
		if len(d.Predictions) > 0 && d.Predictions[0].ID != "" {
			add("Prediction detail", "/predictions/"+url.PathEscape(d.Predictions[0].ID))
		}
		add("Predictions", "/predictions"+farmQuery)
	case "risks":
		add("Farm risks", "/farms/"+url.PathEscape(d.FarmID)+"?tab=risks")
	case "recommendations":
		add("Recommendations", "/recommendations"+farmQuery)
	case "notifications":
		add("Notifications", "/notifications")
	case "weather", "soil", "sensor", "irrigation":
		add("Monitoring", "/monitoring"+farmQuery)
		add("Weather & Soil", "/weather"+farmQuery)
	default:
		add("Dashboard", "/dashboard"+farmQuery)
	}
	return sources
}

func assistantSuggestions(d assistantData) []string {
	crop := "maize"
	if len(d.Predictions) > 0 && d.Predictions[0].Crop != "" {
		crop = strings.ToLower(d.Predictions[0].Crop)
	}
	return []string{
		"What needs attention on this farm?",
		fmt.Sprintf("What is the %s yield estimate?", crop),
		"Should I irrigate?",
		"How does the AI decide?",
		"Where do readings come from?",
	}
}

func answerQuestion(question string, d assistantData) assistantAnswer {
	intent := classifyAssistantIntent(question)
	var body string
	switch intent {
	case "assistant":
		body = answerAssistantHelp(d)
	case "overview", "farm":
		body = answerOverview(d)
	case "risks":
		body = answerRisks(d)
	case "recommendations":
		body = answerRecommendations(d)
	case "irrigation":
		body = answerIrrigation(d)
	case "sensor":
		body = answerSensor(question, d)
	case "yield":
		body = answerYield(question, d)
	case "weather":
		body = answerWeather(d)
	case "soil":
		body = answerSoil(d)
	case "device":
		body = answerDevice(d)
	case "ingestion":
		body = answerIngestion(d)
	case "ai":
		body = answerAI(d)
	case "notifications":
		body = answerNotifications(d)
	default:
		body = answerFallback()
	}
	return assistantAnswer{
		Answer:      strings.TrimSpace(body),
		Intent:      intent,
		Sources:     assistantSources(intent, d),
		Suggestions: assistantSuggestions(d),
	}
}

func answerAssistantHelp(d assistantData) string {
	var b strings.Builder
	b.WriteString("I can answer questions from the current farm records: latest sensor readings, irrigation needs, yield estimates, active risks, recommendations, weather and soil, device status, and how the rule engine explains its decisions. ")
	if d.FarmName != "" {
		b.WriteString("I am looking at " + d.FarmName + ". ")
	}
	b.WriteString("Try “What needs attention on this farm?”, “What is the maize yield estimate?”, or “Where do readings come from?”.")
	return b.String()
}

func answerOverview(d assistantData) string {
	if d.FarmName == "" {
		return "No farm is available for this account."
	}
	var b strings.Builder
	place := []string{}
	if d.Location != "" {
		place = append(place, d.Location)
	}
	if d.SoilType != "" {
		place = append(place, d.SoilType+" soil")
	}
	location := ""
	if len(place) > 0 {
		location = " in " + strings.Join(place, ", ")
	}
	b.WriteString(fmt.Sprintf("%s is %s %s%s with %s irrigation.", d.FarmName, assistantNumberText(d.Size), d.AreaUnit, location, d.Irrigation))
	if len(d.Plantings) > 0 {
		items := []string{}
		for _, p := range d.Plantings {
			status := ""
			if p.Status != "" {
				status = ", " + p.Status
			}
			items = append(items, fmt.Sprintf("%s (%s %s%s)", p.Crop, assistantNumberText(p.Area), p.AreaUnit, status))
		}
		b.WriteString(" Active plantings: " + strings.Join(items, "; ") + ".")
	} else {
		b.WriteString(" No active plantings are recorded yet.")
	}
	b.WriteString(fmt.Sprintf(" Field data comes from %d registered device%s and %d current sensor type%s.", len(d.Devices), assistantPlural(len(d.Devices)), len(d.Readings), assistantPlural(len(d.Readings))))
	return b.String()
}

func answerRisks(d assistantData) string {
	if len(d.Risks) == 0 {
		return "There are no active risks on this farm right now. The rule engine re-evaluates the farm whenever readings, weather or plantings change."
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("There %s %d active concern%s on this farm:", assistantAre(len(d.Risks)), len(d.Risks), assistantPlural(len(d.Risks))))
	for i, risk := range d.Risks {
		if i >= 4 {
			break
		}
		b.WriteString(fmt.Sprintf("\n• %s (%s): %s", risk.Title, risk.Severity, strings.TrimSuffix(risk.Explanation, ".")))
	}
	b.WriteString("\nThese come from the rule engine comparing field signals with crop thresholds.")
	return b.String()
}

func answerRecommendations(d assistantData) string {
	if len(d.Recommendations) == 0 {
		return "There are no current recommendations for this farm. Recommendations appear when the rule engine detects a condition outside a crop's expected range."
	}
	var b strings.Builder
	b.WriteString("Current recommendations:")
	for i, rec := range d.Recommendations {
		if i >= 3 {
			break
		}
		b.WriteString(fmt.Sprintf("\n• %s: %s", rec.Title, strings.TrimSuffix(rec.Body, ".")))
	}
	b.WriteString("\nEach one keeps its reason, so you can see which signal generated it.")
	return b.String()
}

func assistantAre(n int) string {
	if n == 1 {
		return "is"
	}
	return "are"
}
func assistantPlural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func answerIrrigation(d assistantData) string {
	var b strings.Builder
	if r, ok := d.Readings["soil_moisture"]; ok {
		b.WriteString(fmt.Sprintf("The latest valid soil moisture reading is %s, recorded %s.", assistantReadingText(r), assistantMoment(r.At)))
	} else {
		b.WriteString("I do not have a recent soil moisture reading for this farm.")
	}
	if risk := assistantFindRisk(d.Risks, "soil_moisture"); risk != nil {
		b.WriteString(" The active advisory “" + risk.Title + "” says: “" + strings.TrimSuffix(risk.Explanation, ".") + ".”")
	} else if risk := assistantFindRisk(d.Risks, "drought"); risk != nil {
		b.WriteString(" The active advisory “" + risk.Title + "” says: “" + strings.TrimSuffix(risk.Explanation, ".") + ".”")
	}
	if b.Len() == 0 {
		return "I need recent soil moisture or forecast data before advising on irrigation."
	}
	b.WriteString(" Recheck the probe after irrigation; the engine uses the 7-day mean, so one reading alone does not trigger the advisory.")
	return b.String()
}

func assistantFindRisk(risks []assistantRisk, category string) *assistantRisk {
	needle := strings.ToLower(category)
	for i := range risks {
		if strings.EqualFold(risks[i].Category, category) || strings.EqualFold(risks[i].Title, category) ||
			strings.Contains(strings.ToLower(risks[i].Title), needle) || strings.Contains(strings.ToLower(risks[i].Explanation), needle) {
			return &risks[i]
		}
	}
	return nil
}

func answerSensor(question string, d assistantData) string {
	sensor := assistantDetectSensor(question, assistantTokens(strings.ToLower(question)))
	if sensor != "" {
		if r, ok := d.Readings[sensor]; ok {
			body := fmt.Sprintf("The latest valid %s is %s, recorded %s.", assistantSensorLabel(sensor), assistantReadingText(r), assistantMoment(r.At))
			if sensor == "soil_moisture" {
				if risk := assistantFindRisk(d.Risks, "soil_moisture"); risk != nil {
					body += " " + risk.Explanation
				}
			}
			return body
		}
		return fmt.Sprintf("No valid %s reading has arrived in the last 30 days.", assistantSensorLabel(sensor))
	}
	items := []string{}
	for _, sensor := range assistantSensorOrder {
		if r, ok := d.Readings[sensor]; ok {
			items = append(items, fmt.Sprintf("%s %s", assistantSensorLabel(sensor), assistantReadingText(r)))
		}
	}
	if len(items) == 0 {
		return "There are no recent valid sensor readings for this farm."
	}
	return "Latest valid readings: " + strings.Join(items, "; ") + "."
}

func assistantDetectSensor(lower string, tokens map[string]bool) string {
	switch {
	case strings.Contains(lower, "soil moisture") || strings.Contains(lower, "moisture"):
		return "soil_moisture"
	case strings.Contains(lower, "soil temperature"):
		return "soil_temperature"
	case strings.Contains(lower, "air temperature") || strings.Contains(lower, "temperature"):
		return "air_temperature"
	case strings.Contains(lower, "humidity"):
		return "air_humidity"
	case strings.Contains(lower, "ph"):
		return "soil_ph"
	case strings.Contains(lower, "nitrogen") || (tokens["n"] && len(tokens) <= 4):
		return "soil_n"
	case strings.Contains(lower, "phosphorus") || (tokens["p"] && len(tokens) <= 4):
		return "soil_p"
	case strings.Contains(lower, "potassium") || (tokens["k"] && len(tokens) <= 4):
		return "soil_k"
	default:
		return ""
	}
}

func assistantLatestPredictions(predictions []assistantPrediction) []assistantPrediction {
	seen := map[string]bool{}
	out := []assistantPrediction{}
	for _, p := range predictions {
		key := strings.ToLower(p.Crop)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, p)
		if len(out) >= 3 {
			break
		}
	}
	return out
}

func assistantPredictionValues(p assistantPrediction) string {
	text := fmt.Sprintf("%s–%s %s", p.YieldMin, p.YieldMax, p.YieldUnit)
	if p.Suitability.Score > 0 {
		verdict := ""
		if p.Suitability.Verdict != "" {
			verdict = " (" + p.Suitability.Verdict + ")"
		}
		text += fmt.Sprintf(", suitability %s/100%s", assistantFloat(p.Suitability.Score, 0), verdict)
	}
	if p.Quality > 0 {
		text += fmt.Sprintf(", data quality %d%%", p.Quality)
	}
	return text
}

func assistantPredictionText(p assistantPrediction) string {
	return p.Crop + " " + assistantPredictionValues(p)
}

func answerYield(question string, d assistantData) string {
	latest := assistantLatestPredictions(d.Predictions)
	if len(latest) == 0 {
		return "There is no yield estimate for this farm yet. Open Predictions to generate one from the current planting, weather, soil and sensor data."
	}
	crop := assistantDetectCrop(question)
	if crop != "" {
		for _, p := range latest {
			if strings.EqualFold(p.Crop, crop) {
				text := "Latest estimate for " + p.Crop + ": " + assistantPredictionValues(p) + "."
				if p.Suitability.Explanation != "" {
					text += " " + p.Suitability.Explanation
				}
				if p.HarvestStart != "" && p.HarvestEnd != "" {
					text += fmt.Sprintf(" Harvest window: %s to %s.", p.HarvestStart, p.HarvestEnd)
				}
				return text + " Open the prediction to see every factor and advisory."
			}
		}
		return fmt.Sprintf("I do not have a current estimate for %s on this farm. Available estimates: %s.", crop, assistantJoinPredictionTexts(latest))
	}
	return "Latest yield estimates: " + assistantJoinPredictionTexts(latest) + ". Open a prediction to see the factors and advisories behind each range."
}

func assistantJoinPredictionTexts(predictions []assistantPrediction) string {
	items := []string{}
	for _, p := range predictions {
		items = append(items, assistantPredictionText(p))
	}
	return strings.Join(items, "; ")
}

func assistantDetectCrop(question string) string {
	lower := strings.ToLower(question)
	crops := []struct{ key, label string }{
		{"maize", "Maize"}, {"bean", "Beans"}, {"beans", "Beans"}, {"wheat", "Wheat"},
		{"rice", "Rice"}, {"potato", "Potatoes"}, {"potatoes", "Potatoes"},
	}
	for _, c := range crops {
		if strings.Contains(lower, c.key) {
			return c.label
		}
	}
	return ""
}

func assistantUpcomingWeather(d assistantData) []assistantDay {
	today := time.Now().UTC().Format("2006-01-02")
	out := []assistantDay{}
	for _, day := range d.Weather {
		if day.Date == "" || day.Date < today {
			continue
		}
		out = append(out, day)
		if len(out) == 16 {
			break
		}
	}
	return out
}

func answerWeather(d assistantData) string {
	days := assistantUpcomingWeather(d)
	if len(days) == 0 {
		return "The weather cache is being refreshed. Open Weather & Soil shortly, or ask again after the next forecast update."
	}
	rain, minTemp, maxTemp := 0.0, 1e12, -1e12
	haveTemp := false
	for _, day := range days {
		if day.Precip != nil {
			rain += *day.Precip
		}
		if day.TMin != nil {
			if *day.TMin < minTemp {
				minTemp = *day.TMin
			}
			haveTemp = true
		}
		if day.TMax != nil {
			if *day.TMax > maxTemp {
				maxTemp = *day.TMax
			}
			haveTemp = true
		}
	}
	body := fmt.Sprintf("The forecast period shows %s mm of rain", assistantFloat(rain, 0))
	if haveTemp {
		body += fmt.Sprintf(" and temperatures between %s°C and %s°C", assistantFloat(minTemp, 0), assistantFloat(maxTemp, 0))
	}
	body += "."
	if risk := assistantFindRisk(d.Risks, "supplemental water"); risk != nil {
		body += " The rule engine has raised “" + strings.TrimSuffix(risk.Title, ".") + "” because the forecast rainfall is below the crop's seasonal share."
	}
	return body
}

func assistantSoilProfile(d assistantData) map[string]interface{} {
	outer, ok := d.Soil.(map[string]interface{})
	if !ok {
		return map[string]interface{}{}
	}
	inner, ok := outer["soil"].(map[string]interface{})
	if !ok {
		return map[string]interface{}{}
	}
	return inner
}

func assistantTexture(soil map[string]interface{}) string {
	if text := assistantString(soil["texture"]); text != "" {
		return text
	}
	clay, _ := asFloat(soil["clay_pct"])
	sand, _ := asFloat(soil["sand_pct"])
	silt, _ := asFloat(soil["silt_pct"])
	switch {
	case clay >= 40:
		return "clay"
	case sand >= 60:
		return "sand"
	case silt >= 60:
		return "silt"
	case clay >= 35:
		return "clay loam"
	case sand >= 45:
		return "sandy loam"
	default:
		return "loam"
	}
}

func answerSoil(d assistantData) string {
	soil := assistantSoilProfile(d)
	ph, phOK := asFloat(soil["phH2o"])
	if !phOK {
		ph, phOK = asFloat(soil["ph_h2o"])
	}
	parts := []string{}
	if phOK {
		parts = append(parts, fmt.Sprintf("modelled soil pH %s", assistantFloat(ph, 1)))
	}
	if texture := assistantTexture(soil); texture != "" {
		parts = append(parts, texture+" texture")
	}
	body := ""
	if len(parts) > 0 {
		body = "SoilGrids shows " + strings.Join(parts, " and ") + ". "
	}
	measured := []string{}
	for _, sensor := range []string{"soil_ph", "soil_n", "soil_p", "soil_k"} {
		if r, ok := d.Readings[sensor]; ok {
			value := assistantReadingText(r)
			if sensor == "soil_ph" {
				value = strings.TrimSuffix(value, " pH")
			}
			measured = append(measured, fmt.Sprintf("%s %s", strings.TrimPrefix(assistantSensorLabel(sensor), "soil "), value))
		}
	}
	if len(measured) > 0 {
		body += "Probe measurements: " + strings.Join(measured, "; ") + ". "
	}
	if body == "" {
		return "Soil data is being refreshed. Open Weather & Soil shortly to see the current profile."
	}
	body += "The rule engine compares these values with each crop's pH and nutrient bands."
	return body
}

func answerDevice(d assistantData) string {
	if len(d.Devices) == 0 {
		return "No monitoring device is registered for this farm."
	}
	var b strings.Builder
	for i, dev := range d.Devices {
		if i >= 3 {
			break
		}
		if i > 0 {
			b.WriteString(" ")
		}
		firmware := dev.Firmware
		if firmware == "" {
			firmware = "firmware not reported"
		}
		last := "never"
		if t, ok := dev.LastSeen.(time.Time); ok && !t.IsZero() {
			last = assistantMoment(t)
		} else if text := assistantString(dev.LastSeen); text != "" {
			last = assistantMoment(text)
		}
		status := "active"
		if !dev.Active {
			status = "inactive"
		}
		b.WriteString(fmt.Sprintf("%s (%s), %s %s, last seen %s, %s.", dev.Name, dev.UID, dev.Hardware, firmware, last, status))
	}
	b.WriteString(" Each station uses a device UID and a hashed API key with POST /api/v1/iot/readings.")
	return b.String()
}

func answerIngestion(d assistantData) string {
	body := "Field readings arrive through POST /api/v1/iot/readings. The ESP32 station sends its device UID and a hashed API key with each reading; the same HTTP endpoint also accepts direct field submissions. MQTT is optional. "
	body += "Valid readings update Monitoring, then feed the rule engine used for predictions, risks and recommendations."
	if len(d.Devices) == 1 {
		body += " This farm has one registered station: " + d.Devices[0].Name + "."
	}
	return body
}

func answerAI(d assistantData) string {
	body := "AgriSense uses an explainable rule engine (" + assistantRuleVersion(d) + "). It scores weather, SoilGrids soil, planting details, 7-day sensor averages and NPK values against crop thresholds, then shows every factor and advisory behind the result. "
	if len(d.Predictions) > 0 && d.Predictions[0].Suitability.Explanation != "" {
		body += "For " + d.Predictions[0].Crop + ", the current explanation is: “" + d.Predictions[0].Suitability.Explanation + "” "
	}
	body += "I answer from those stored outputs, so you can trace each number back to its source."
	return body
}

func assistantRuleVersion(d assistantData) string {
	if len(d.Predictions) > 0 && d.Predictions[0].Method != "" {
		return d.Predictions[0].Method
	}
	return "agrisense-rules-1.1.0"
}

func answerNotifications(d assistantData) string {
	if d.Unread == 0 {
		return "You have no unread notifications."
	}
	body := fmt.Sprintf("You have %d unread notification%s.", d.Unread, assistantPlural(d.Unread))
	if len(d.NoticeTitles) > 0 {
		body += " The latest are: " + strings.Join(d.NoticeTitles, "; ") + "."
	}
	return body
}

func answerFallback() string {
	return "I do not have a specific answer for that in the farm data. I can help with readings, irrigation, yield estimates, active risks, recommendations, weather and soil, devices, and how the rule engine explains its decisions. Try one of the suggested questions."
}
