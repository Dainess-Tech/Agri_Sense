package api

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// evaluateFarmRules turns the same rule-engine output used by predictions into
// persistent farm risks, recommendations and in-app notifications. It is
// idempotent: repeated refreshes update the same deduplicated risk rows.
func (s *Server) evaluateFarmRules(ctx context.Context, farmID string, lat, lng float64) error {
	weather, weatherErr := s.weatherForecast(lat, lng)
	soil, soilErr := s.soilProfile(lat, lng)
	sensors := s.recentSensorAverages(ctx, farmID)

	rows, err := s.DB.Query(ctx, `select p.id::text,p.planting_date::text,p.planted_area::float,p.area_unit::text,
		c.base_yield_min::float,c.base_yield_max::float,c.yield_unit,c.base_temp_c::float,
		c.temp_opt_min::float,c.temp_opt_max::float,c.temp_critical_low::float,c.temp_critical_high::float,
		c.soil_moisture_min::float,c.soil_moisture_max::float,c.ph_min::float,c.ph_max::float,
		c.water_need_min_mm,c.water_need_max_mm,c.gdd_to_maturity::float,c.maturity_days_min::float,c.maturity_days_max::float
		from plantings p join crops c on c.id=p.crop_id
		where p.farm_id=$1 and p.status not in ('harvested','failed')`, farmID)
	if err != nil {
		return err
	}
	defer rows.Close()

	seen := []string{}
	type plantingRule struct {
		id     string
		crop   ruleCrop
		date   string
		areaHa float64
	}
	plantings := []plantingRule{}
	for rows.Next() {
		var p plantingRule
		var area float64
		var unit string
		err := rows.Scan(&p.id, &p.date, &area, &unit,
			&p.crop.YieldMin, &p.crop.YieldMax, &p.crop.YieldUnit, &p.crop.BaseTemp,
			&p.crop.TempOptMin, &p.crop.TempOptMax, &p.crop.TempCriticalLow, &p.crop.TempCriticalHigh,
			&p.crop.SoilMin, &p.crop.SoilMax, &p.crop.PHMin, &p.crop.PHMax,
			&p.crop.WaterNeedMin, &p.crop.WaterNeedMax, &p.crop.GDD, &p.crop.MaturityMin, &p.crop.MaturityMax)
		if err != nil {
			return err
		}
		p.areaHa = area
		if strings.ToLower(unit) == "acres" {
			p.areaHa *= 0.40468564224
		} else if strings.ToLower(unit) == "square_meters" || strings.ToLower(unit) == "m2" {
			p.areaHa /= 10000
		}
		plantings = append(plantings, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	now := time.Now()
	for _, p := range plantings {
		result := evaluateRules(p.crop, p.date, p.areaHa, weather, soil, sensors)
		severityByRisk := map[string]string{}
		for _, risk := range result.Risks {
			severityByRisk[risk.Category] = risk.Severity
		}
		for _, raw := range result.Advisories {
			advice, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}
			category, _ := advice["category"].(string)
			title, _ := advice["title"].(string)
			body, _ := advice["body"].(string)
			if category == "" || category == "management" || title == "" || body == "" {
				continue
			}

			riskCategory := advisoryRiskCategory(category, body)
			severity := severityByRisk[riskCategory]
			if severity == "" {
				severity = "low"
			}
			source := advisorySource(category, body, weatherErr == nil, soilErr == nil, len(sensors) > 0)
			dedupe := fmt.Sprintf("rules:%s:%s:%s", farmID, p.id, category)
			riskID, err := s.upsertFarmRisk(ctx, farmID, p.id, riskCategory, severity, title, body, source, dedupe, now)
			if err != nil {
				return err
			}
			seen = append(seen, dedupe)
			if err := s.upsertRecommendation(ctx, farmID, p.id, riskID, category, severity, title, body, source); err != nil {
				return err
			}
			if err := s.notifyFarmUsers(ctx, farmID, riskID, severity, title, body); err != nil {
				return err
			}
		}
	}

	if len(seen) == 0 {
		_, err = s.DB.Exec(ctx, `update farm_risks set active=false,resolved_at=$2 where farm_id=$1 and active=true`, farmID, now)
		return err
	}
	_, err = s.DB.Exec(ctx, `update farm_risks set active=false,resolved_at=$2 where farm_id=$1 and active=true and not (dedupe_key = any($3::text[]))`, farmID, now, seen)
	return err
}

func advisoryRiskCategory(category, body string) string {
	switch category {
	case "water":
		if strings.Contains(strings.ToLower(body), "soil moisture") {
			return "soil_moisture"
		}
		if strings.Contains(strings.ToLower(body), "dry spell") {
			return "drought"
		}
		return "drought"
	case "field":
		return "excessive_rainfall"
	case "temperature":
		return "heat_stress"
	case "soil":
		if strings.Contains(strings.ToLower(body), "ph") {
			return "soil_ph"
		}
		return "soil_nutrients"
	default:
		return category
	}
}

func advisorySource(category, body string, weatherOK, soilOK, sensorsOK bool) string {
	lower := strings.ToLower(body)
	if strings.Contains(lower, "soil moisture") || strings.Contains(lower, "npk") {
		return "sensor"
	}
	if category == "soil" && soilOK {
		return "soil"
	}
	if weatherOK {
		return "forecast"
	}
	if sensorsOK {
		return "sensor"
	}
	return "history"
}

func (s *Server) upsertFarmRisk(ctx context.Context, farmID, plantingID, category, severity, title, body, source, dedupe string, now time.Time) (string, error) {
	var id string
	err := s.DB.QueryRow(ctx, `select id::text from farm_risks where dedupe_key=$1 and active=true`, dedupe).Scan(&id)
	if err == nil {
		_, err = s.DB.Exec(ctx, `update farm_risks set last_seen_at=$2,severity=$3,title=$4,explanation=$5,source=$6 where id=$1`, id, now, severity, title, body, source)
		return id, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	err = s.DB.QueryRow(ctx, `insert into farm_risks(farm_id,planting_id,category,severity,title,explanation,source,dedupe_key,active,detected_at,last_seen_at)
		values($1,nullif($2::text,'')::uuid,$3,$4,$5,$6,$7,$8,true,$9,$9) returning id::text`,
		farmID, plantingID, category, severity, title, body, source, dedupe, now).Scan(&id)
	return id, err
}

func (s *Server) upsertRecommendation(ctx context.Context, farmID, plantingID, riskID, category, severity, title, body, source string) error {
	ruleCode := fmt.Sprintf("rule-%s", category)
	var id string
	err := s.DB.QueryRow(ctx, `select id::text from recommendations where farm_id=$1 and rule_code=$2 and planting_id=$3 limit 1`, farmID, ruleCode, plantingID).Scan(&id)
	if err == nil {
		_, err = s.DB.Exec(ctx, `update recommendations set risk_id=$2,title=$3,body=$4,reason=$5,severity=$6,updated_at=$7 where id=$1`,
			id, riskID, title, body, "Generated by the explainable rule engine from "+source+" signals", severity, time.Now())
		return err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	_, err = s.DB.Exec(ctx, `insert into recommendations(farm_id,planting_id,risk_id,rule_code,title,body,reason,severity,requires_expert,status)
		values($1,nullif($2::text,'')::uuid,$3,$4,$5,$6,$7,$8,false,'new')`,
		farmID, plantingID, riskID, ruleCode, title, body, "Generated by the explainable rule engine from "+source+" signals", severity)
	return err
}

func (s *Server) notifyFarmUsers(ctx context.Context, farmID, riskID, severity, title, body string) error {
	dedupe := "risk:" + riskID
	users, err := s.DB.Query(ctx, `select user_id::text from farm_members where farm_id=$1 union select owner_id::text from farms where id=$1`, farmID)
	if err != nil {
		return err
	}
	defer users.Close()
	ids := []string{}
	for users.Next() {
		var id string
		if users.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	if err := users.Err(); err != nil {
		return err
	}
	for _, userID := range ids {
		var existingID string
		err := s.DB.QueryRow(ctx, `select id::text from notifications where user_id=$1 and dedupe_key=$2 limit 1`, userID, dedupe).Scan(&existingID)
		if err == nil {
			// Keep the notification in sync with the refreshed explanation while
			// preserving its read state and original delivery time.
			_, err = s.DB.Exec(ctx, `update notifications set severity=$2,title=$3,body=$4,link=$5 where id=$1`,
				existingID, severity, title, body, "/farms/"+farmID+"?tab=risks")
			if err != nil {
				return err
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		_, err = s.DB.Exec(ctx, `insert into notifications(user_id,farm_id,type,severity,title,body,link,dedupe_key)
			values($1,$2,'risk',$3,$4,$5,$6,$7)`, userID, farmID, severity, title, body, "/farms/"+farmID+"?tab=risks", dedupe)
		if err != nil {
			return err
		}
	}
	return nil
}
