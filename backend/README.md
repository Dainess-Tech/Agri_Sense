# Go Backend

The active backend is a standalone Go HTTP service under this directory.
When present, it loads configuration from the repository-root `.env` file.

```bash
cp ../.env.example ../.env
npm --prefix .. run start:api
```

Default listen address: `:3001`. Next.js proxies `/api/v1/*` and `/api/health` to `GO_API_URL` (default `http://127.0.0.1:3001`).

To ingest MQTT devices, set `MQTT_BROKER_URL` (for example
`ssl://your-cluster.example:8883`), `MQTT_USERNAME`, and `MQTT_PASSWORD` in the
repository-root `.env`. The default subscription is
`agrisense/devices/+/readings`; override it with `MQTT_TOPIC` if needed. Use a
unique `MQTT_CLIENT_ID` when running multiple API instances. The bridge only
accepts messages for registered, active device IDs.

Run `npm --prefix .. run build:api` to build `dist/agrisense-api`.
