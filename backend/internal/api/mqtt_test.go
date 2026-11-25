package api

import (
	"strings"
	"testing"
)

func TestDeviceUIDFromTopic(t *testing.T) {
	uid, err := deviceUIDFromTopic("agrisense/devices/as-north-01/readings", "agrisense/devices/+/readings")
	if err != nil || uid != "as-north-01" {
		t.Fatalf("unexpected device ID: %q, error: %v", uid, err)
	}
}

func TestDeviceUIDFromTopicRejectsUnexpectedTopics(t *testing.T) {
	for _, topic := range []string{
		"agrisense/devices/as-north-01/status",
		"agrisense/devices/as/north/readings",
		"agrisense/devices/+/readings",
	} {
		if _, err := deviceUIDFromTopic(topic, "agrisense/devices/+/readings"); err == nil {
			t.Errorf("expected topic %q to be rejected", topic)
		}
	}
}

func TestValidDeviceUID(t *testing.T) {
	for _, uid := range []string{"as-device_1.2", "ESP32-01"} {
		if !validDeviceUID(uid) {
			t.Errorf("expected %q to be valid", uid)
		}
	}
	for _, uid := range []string{"", "a/b", "one two", "bad+id", strings.Repeat("a", 65)} {
		if validDeviceUID(uid) {
			t.Errorf("expected %q to be invalid", uid)
		}
	}
}
