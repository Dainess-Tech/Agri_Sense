package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"agrisense/backend/internal/api"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load("../.env"); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Fatalf("load environment: %v", err)
	}
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://postgres@127.0.0.1:5433/app_db"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("database pool: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("database ping: %v", err)
	}

	srv := api.NewServer(pool)
	if brokerURL := os.Getenv("MQTT_BROKER_URL"); brokerURL != "" {
		topic := os.Getenv("MQTT_TOPIC")
		if topic == "" {
			topic = "agrisense/devices/+/readings"
		}
		client, bridgeErr := srv.StartMQTTBridge(api.MQTTConfig{
			BrokerURL: brokerURL,
			Username:  os.Getenv("MQTT_USERNAME"),
			Password:  os.Getenv("MQTT_PASSWORD"),
			Topic:     topic,
			ClientID:  os.Getenv("MQTT_CLIENT_ID"),
		})
		if client != nil {
			defer client.Disconnect(250)
		}
		if bridgeErr != nil {
			log.Printf("MQTT bridge startup failed: %v", bridgeErr)
		}
	} else {
		log.Printf("MQTT bridge disabled; set MQTT_BROKER_URL to enable")
	}
	addr := os.Getenv("GO_API_ADDR")
	if addr == "" {
		addr = ":3001"
	}
	httpServer := &http.Server{Addr: addr, Handler: srv, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		ch := make(chan os.Signal, 1)
		signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
		<-ch
		shutdown, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		_ = httpServer.Shutdown(shutdown)
	}()

	log.Printf("AgriSense Go API listening on %s", addr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
