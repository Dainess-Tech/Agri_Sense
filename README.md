# Agri_Sense

Agricultural intelligence PWA: IoT farm monitoring, crop-yield prediction, weather/soil integration, farm management.

## Layout
- frontend/ — React 19 + TypeScript + Vite PWA (main app)
- backend/  — FastAPI placeholder (later phase)
- docs/    — SRS, architecture notes, API contracts

## Frontend quick start
    cd frontend
    npm install
    npm run dev      # http://localhost:5173

## Conventions
- All HTTP calls in frontend/src/services/; no hardcoded data in components.
- Dev mock data in frontend/src/mocks/, swappable for the real API.
- Shared UI in components/; module code in features/<module>/.
