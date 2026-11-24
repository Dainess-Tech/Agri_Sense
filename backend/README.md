# Go Backend

The active backend is a standalone Go HTTP service under this directory.
When present, it loads configuration from the repository-root `.env` file.

```bash
cp ../.env.example ../.env
npm --prefix .. run start:api
```

Default listen address: `:3001`. Next.js proxies `/api/v1/*` and `/api/health` to `GO_API_URL` (default `http://127.0.0.1:3001`).

Run `npm --prefix .. run build:api` to build `dist/agrisense-api`.
