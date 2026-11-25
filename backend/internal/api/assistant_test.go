package api

import (
	"strings"
	"testing"
	"time"
)

func TestClassifyAssistantIntent(t *testing.T) {
	cases := map[string]string{
		"Where do readings come from?":  "ingestion",
		"How does the AI decide?":       "ai",
		"Should I irrigate?":            "irrigation",
		"What is soil moisture?":        "sensor",
		"What is the maize yield?":      "yield",
		"What needs attention?":         "risks",
		"What should I do next?":        "recommendations",
		"What is the weather forecast?": "weather",
		"Tell me about the farm":        "farm",
		"Hello there":                   "assistant",
		"Tell me a joke about dogs":     "fallback",
	}
	for question, want := range cases {
		if got := classifyAssistantIntent(question); got != want {
			t.Errorf("classifyAssistantIntent(%q) = %q, want %q", question, got, want)
		}
	}
}

func TestAssistantAnswersAreGrounded(t *testing.T) {
	now := time.Now().UTC()
	score := 71.0
	data := assistantData{
		FarmID:   "farm-1",
		FarmName: "Nairobi North Farm",
		Readings: map[string]assistantReading{
			"soil_moisture": {SensorType: "soil_moisture", Label: "soil moisture", Unit: "%", Value: 23.9, At: now},
		},
		Risks: []assistantRisk{{
			Category: "soil_moisture", Title: "Schedule irrigation", Severity: "medium",
			Explanation: "7-day mean soil moisture is 23.9%, below the comfort band.",
		}},
		Predictions: []assistantPrediction{{
			ID: "prediction-1", Crop: "Maize", YieldMin: "1.56", YieldMax: "6.06", YieldUnit: "t/ha",
			Quality: 100, Method: "agrisense-rules-1.1.0",
			Suitability: assistantSuitability{Score: score, Verdict: "suitable", Explanation: "Temperature is the main limiting factor."},
		}},
	}

	ingestion := answerQuestion("Where do readings come from?", data)
	if !strings.Contains(ingestion.Answer, "POST /api/v1/iot/readings") {
		t.Fatalf("ingestion answer missed the real endpoint: %q", ingestion.Answer)
	}
	if len(ingestion.Sources) == 0 || ingestion.Sources[0].Href != "/devices" {
		t.Fatalf("ingestion answer missed a useful source: %#v", ingestion.Sources)
	}

	yield := answerQuestion("What is the maize yield?", data)
	if !strings.Contains(yield.Answer, "1.56–6.06 t/ha") || !strings.Contains(yield.Answer, "71/100") {
		t.Fatalf("yield answer missed stored values: %q", yield.Answer)
	}

	irrigation := answerQuestion("Should I irrigate?", data)
	if !strings.Contains(irrigation.Answer, "23.9%") || !strings.Contains(irrigation.Answer, "Schedule irrigation") {
		t.Fatalf("irrigation answer missed the current reading and advisory: %q", irrigation.Answer)
	}

	fallback := answerQuestion("Tell me a joke about dogs", data)
	if !strings.Contains(fallback.Answer, "do not have a specific answer") {
		t.Fatalf("fallback must stay within the available data: %q", fallback.Answer)
	}
}

func TestAssistantHandlesEmptyFarmData(t *testing.T) {
	for _, question := range []string{"What needs attention?", "What is the maize yield?", "Should I irrigate?", "How does the AI decide?"} {
		answer := answerQuestion(question, assistantData{FarmID: "empty"})
		if strings.TrimSpace(answer.Answer) == "" {
			t.Fatalf("empty answer for %q", question)
		}
		if len(answer.Suggestions) == 0 {
			t.Fatalf("missing suggestions for %q", question)
		}
	}
}
