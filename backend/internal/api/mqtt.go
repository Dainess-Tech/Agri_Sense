package api

import (
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type MQTTConfig struct {
	BrokerURL string
	Username  string
	Password  string
	Topic     string
	ClientID  string
}

func deviceUIDFromTopic(topic, filter string) (string, error) {
	topicParts := strings.Split(topic, "/")
	filterParts := strings.Split(filter, "/")
	if len(topicParts) != len(filterParts) {
		return "", badRequest("MQTT topic does not match the configured filter")
	}
	wildcard := -1
	for i, part := range filterParts {
		if part == "+" {
			if wildcard != -1 {
				return "", badRequest("MQTT topic filter must contain exactly one device wildcard")
			}
			wildcard = i
			continue
		}
		if strings.ContainsAny(part, "+#") || part != topicParts[i] {
			return "", badRequest("MQTT topic does not match the configured filter")
		}
	}
	if wildcard == -1 || strings.ContainsAny(topicParts[wildcard], "+#") || !validDeviceUID(topicParts[wildcard]) {
		return "", badRequest("MQTT topic does not contain a valid device ID")
	}
	return topicParts[wildcard], nil
}

func (s *Server) StartMQTTBridge(config MQTTConfig) (mqtt.Client, error) {
	if config.BrokerURL == "" || config.Username == "" || config.Password == "" || config.Topic == "" {
		return nil, fmt.Errorf("MQTT broker URL, username, password, and topic are required")
	}
	brokerURL, err := url.Parse(config.BrokerURL)
	if err != nil || brokerURL.Scheme != "ssl" || brokerURL.Host == "" {
		return nil, fmt.Errorf("MQTT_BROKER_URL must be an ssl:// URL with a host")
	}
	sampleTopic := strings.Replace(config.Topic, "+", "as-sample", 1)
	if _, err := deviceUIDFromTopic(sampleTopic, config.Topic); err != nil {
		return nil, fmt.Errorf("invalid MQTT topic filter: %w", err)
	}
	if config.ClientID == "" {
		config.ClientID = "agrisense-api-bridge"
	}
	options := mqtt.NewClientOptions().
		AddBroker(config.BrokerURL).
		SetClientID(config.ClientID).
		SetUsername(config.Username).
		SetPassword(config.Password).
		SetCleanSession(true).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(5 * time.Second).
		SetConnectTimeout(15 * time.Second).
		SetKeepAlive(30 * time.Second).
		SetPingTimeout(10 * time.Second).
		SetOrderMatters(false)
	options.SetOnConnectHandler(func(client mqtt.Client) {
		token := client.Subscribe(config.Topic, 1, func(_ mqtt.Client, message mqtt.Message) {
			if err := s.ingestMQTTMessage(config.Topic, message.Topic(), message.Payload()); err != nil {
				log.Printf("[mqtt] rejected message on %s: %v", message.Topic(), err)
				return
			}
			log.Printf("[mqtt] ingested message on %s", message.Topic())
		})
		if !token.WaitTimeout(15 * time.Second) {
			log.Printf("[mqtt] subscribing to %s timed out", config.Topic)
			return
		}
		if err := token.Error(); err != nil {
			log.Printf("[mqtt] failed to subscribe to %s: %v", config.Topic, err)
			return
		}
		log.Printf("[mqtt] subscribed to %s", config.Topic)
	})
	options.SetConnectionLostHandler(func(_ mqtt.Client, err error) {
		log.Printf("[mqtt] broker connection lost: %v", err)
	})
	client := mqtt.NewClient(options)
	token := client.Connect()
	if !token.WaitTimeout(20 * time.Second) {
		return client, fmt.Errorf("MQTT broker connection timed out")
	}
	if err := token.Error(); err != nil {
		return client, fmt.Errorf("connect to MQTT broker: %w", err)
	}
	return client, nil
}
