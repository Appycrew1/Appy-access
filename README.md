
# Pre‑Survey Pro — Framework‑free Vercel App

**Upgrades included**
- Choropleth postcode polygons (mock GeoJSON) + heat points toggle
- Metrics endpoint used for demand KPI
- Panels for Pricing/Competitor/Lead/Marketing (populated by AI analyse)
- Clear error messages and LIVE/SANDBOX/MOCK mode banner

**Routes**
- `/api/ping`, `/api/env-status`, `/api/sample_addresses`
- `/api/areas`, `/api/metrics?area_code=SW11`, `/api/heatmap`, `/api/geo/postcodes`
- `/api/intake` (POST), `/api/property-image`, `/api/route`, `/api/parking`, `/api/building`, `/api/safety`, `/api/weather`
- `/api/ai/{duration|crew|quote|risk|message|analyse}` (POST)

**Env vars (Vercel → Settings → Environment Variables)**
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
GOOGLE_API_KEY=AIza...
```

**Deploy**
- Push to GitHub → import in Vercel → (optional) add env vars → open `/`
