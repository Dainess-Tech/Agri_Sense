package api

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
)

func (s *Server) sendMail(to, subject, text string) {
	if os.Getenv("MAIL_PROVIDER") == "" {
		log.Printf("[mail:console] to=%s subject=%q\n%s", to, subject, text)
		return
	}
	url := os.Getenv("MAIL_API_URL")
	if url == "" {
		log.Printf("[mail] MAIL_PROVIDER is set but MAIL_API_URL is missing; message to %s was not delivered", to)
		return
	}
	body, _ := json.Marshal(map[string]string{"to": to, "subject": subject, "text": text})
	req, e := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if e != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if k := os.Getenv("MAIL_API_KEY"); k != "" {
		req.Header.Set("Authorization", "Bearer "+k)
	}
	resp, e := http.DefaultClient.Do(req)
	if e != nil {
		log.Printf("[mail] delivery to %s failed: %v", to, e)
		return
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		log.Printf("[mail] provider returned %d for %s", resp.StatusCode, to)
	}
}

func (s *Server) ensureSeed(ctx context.Context) error {
	crops := []struct {
		slug, name, scientific, yieldUnit string
		ymin, ymax                        string
		mmin, mmax                        int
		bt, gdd                           float64
		tomin, tomax, tcl, tch            float64
		wmin, wmax                        int
		smmin, smmax, phmin, phmax        float64
	}{
		{"maize", "Maize", "Zea mays", "t/ha", "2", "6", 90, 150, 10, 1400, 18, 32, 10, 35, 500, 800, 25, 45, 5.5, 7.5},
		{"beans", "Beans", "Phaseolus vulgaris", "t/ha", "0.8", "2", 60, 100, 10, 1000, 16, 28, 8, 32, 300, 500, 25, 40, 6, 7.5},
		{"wheat", "Wheat", "Triticum aestivum", "t/ha", "2", "5", 100, 140, 0, 1900, 12, 25, 3, 32, 450, 650, 20, 40, 6, 7.5},
		{"rice", "Rice", "Oryza sativa", "t/ha", "2.5", "6", 100, 150, 10, 1700, 20, 35, 12, 38, 900, 1500, 40, 60, 5, 7},
		{"potatoes", "Potatoes", "Solanum tuberosum", "t/ha", "10", "25", 90, 120, 7, 1300, 15, 24, 5, 30, 500, 700, 30, 45, 4.8, 6.5},
	}
	for _, c := range crops {
		var id string
		err := s.DB.QueryRow(ctx, `insert into crops(slug,name,scientific_name,yield_unit,base_yield_min,base_yield_max,maturity_days_min,maturity_days_max,base_temp_c,gdd_to_maturity,temp_opt_min,temp_opt_max,temp_critical_low,temp_critical_high,water_need_min_mm,water_need_max_mm,soil_moisture_min,soil_moisture_max,ph_min,ph_max)
			values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
			on conflict (slug) do nothing returning id`, c.slug, c.name, c.scientific, c.yieldUnit, c.ymin, c.ymax, c.mmin, c.mmax, c.bt, c.gdd, c.tomin, c.tomax, c.tcl, c.tch, c.wmin, c.wmax, c.smmin, c.smmax, c.phmin, c.phmax).Scan(&id)
		if err == nil {
			_, _ = s.DB.Exec(ctx, `insert into crop_varieties(crop_id,name) values($1,$2) on conflict do nothing`, id, "Standard")
		}
	}
	sensors := [][5]interface{}{
		{"soil_moisture", "Soil moisture", "%", "0", "100"}, {"air_temperature", "Air temperature", "°C", "-40", "85"}, {"air_humidity", "Air humidity", "%RH", "0", "100"}, {"soil_temperature", "Soil temperature", "°C", "-40", "85"}, {"soil_ph", "Soil pH", "pH", "2", "12"}, {"soil_n", "Soil nitrogen", "mg/kg", "0", "10000"}, {"soil_p", "Soil phosphorus", "mg/kg", "0", "10000"}, {"soil_k", "Soil potassium", "mg/kg", "0", "10000"},
	}
	for _, x := range sensors {
		_, _ = s.DB.Exec(ctx, `insert into sensor_types(code,label,unit,min_valid,max_valid) values($1,$2,$3,$4,$5) on conflict do nothing`, x[0], x[1], x[2], x[3], x[4])
	}
	_, _ = s.DB.Exec(ctx, `insert into prediction_versions(version,method,description) values('agrisense-rules-1.0.0','Rule-based limiting-factor model','Rule-based yield and harvest estimation') on conflict do nothing`)
	rules := [][5]interface{}{
		{"REC_DROUGHT", "drought", "Monitor soil moisture and water availability", "Rainfall has been low and little is forecast.", false}, {"REC_RAIN", "excessive_rainfall", "Review rainfall before field activities", "Heavy rain is forecast.", false}, {"REC_WATERLOG", "waterlogging", "Check field drainage", "Soil may be waterlogged.", false}, {"REC_HEAT", "heat_stress", "Monitor heat stress", "High temperatures are forecast.", false}, {"REC_COLD", "cold_stress", "Prepare for low temperatures", "Low temperatures are forecast.", false}, {"REC_MOISTURE", "soil_moisture", "Monitor soil moisture", "Soil moisture is below the crop threshold.", false}, {"REC_PH", "soil_ph", "Check soil acidity", "Soil pH appears outside the suitable range.", true}, {"REC_SEASON", "season_disruption", "Review planting progress", "The growing season may be disrupted.", false},
	}
	for _, x := range rules {
		_, _ = s.DB.Exec(ctx, `insert into recommendation_rules(code,risk_category,title,body,requires_expert) values($1,$2,$3,$4,$5) on conflict do nothing`, x[0], x[1], x[2], x[3], x[4])
	}
	return nil
}
