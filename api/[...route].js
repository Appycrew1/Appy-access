import fs from 'node:fs';
import path from 'node:path';
import {
  SAMPLE, ADDR_BY_ID, DEPOT_BY_ID,
  haversine, sandboxGeocode
} from '../lib/sample.js';

// tiny helpers
function sendJSON(res, obj, code = 200) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

// Router
export default async function handler(req, res) {
  try {
    // Remove query string, normalize path
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname.replace(/^\/api/, '') || '/';

    // Health
    if (pathname === '/ping') return sendJSON(res, { ok: true, ts: Date.now() });
    if (pathname === '/env-status') {
      return sendJSON(res, {
        openai: !!process.env.OPENAI_API_KEY,
        google: !!process.env.GOOGLE_API_KEY
      });
    }

    // Data: areas / metrics / heatmap / sample / geo/postcodes
    if (pathname === '/sample_addresses') {
      return sendJSON(res, { depots: SAMPLE.depots, customers: SAMPLE.addresses });
    }
    if (pathname === '/areas') {
      return sendJSON(res, { areas: SAMPLE.areas });
    }
    if (pathname === '/metrics') {
      const code = (url.searchParams.get('area_code') || '').toUpperCase();
      const a = SAMPLE.areas.find((x) => x.code === code);
      if (!a) return sendJSON(res, { error: 'unknown_area' }, 404);
      const competitor_avg_rate = 88.5;
      const current_rate = 95;
      const recommended_rate = +(current_rate * (a.demand_index / 100)).toFixed(1);
      const change_pct = +(((recommended_rate - current_rate) / current_rate) * 100).toFixed(1);
      const rationale =
        a.demand_index > 70
          ? 'High demand — modest premium sustainable.'
          : 'Moderate demand — align closer to competitor rates.';
      return sendJSON(res, {
        area: a, current_rate, competitor_avg_rate, recommended_rate, change_pct, rationale
      });
    }
    if (pathname === '/heatmap') {
      const features = SAMPLE.areas.map((a) => ({
        type: 'Feature',
        properties: { code: a.code, name: a.name, demand_index: a.demand_index },
        geometry: { type: 'Point', coordinates: [a.centroid[1], a.centroid[0]] }
      }));
      return sendJSON(res, { type: 'FeatureCollection', features });
    }
    if (pathname === '/geo/postcodes') {
      const p = path.join(process.cwd(), 'lib', 'postcodes.geo.json');
      res.setHeader('content-type', 'application/json');
      return res.end(fs.readFileSync(p, 'utf8'));
    }

    // Intake (POST)
    if (pathname === '/intake') {
      if (req.method !== 'POST') return sendJSON(res, { error: 'method_not_allowed' }, 405);
      const { customer_address_id, depot_id, customer_address_text, depot_address_text } =
        await readBody(req);

      if (customer_address_id && depot_id) {
        const o = DEPOT_BY_ID[depot_id];
        const d = ADDR_BY_ID[customer_address_id];
        if (!o || !d) return sendJSON(res, { error: 'unknown origin/dest' }, 400);
        return sendJSON(res, { origin: o, dest: d, mode: 'mock_ids' });
      }

      if (customer_address_text && depot_address_text) {
        const key = process.env.GOOGLE_API_KEY;
        if (!key) {
          const o = sandboxGeocode(depot_address_text, 51.472, -0.142);
          const d = sandboxGeocode(customer_address_text, 51.515, -0.141);
          return sendJSON(res, { origin: o, dest: d, mode: 'sandbox_text' });
        }
        const g = 'https://maps.googleapis.com/maps/api/geocode/json';
        const [rs, rc] = await Promise.all([
          fetch(`${g}?address=${encodeURIComponent(depot_address_text)}&key=${key}`),
          fetch(`${g}?address=${encodeURIComponent(customer_address_text)}&key=${key}`)
        ]);
        const [o, d] = [await rs.json(), await rc.json()];
        if (o.status !== 'OK' || d.status !== 'OK') {
          return sendJSON(res, { error: 'geocode_failed', hint: `origin=${o.status} dest=${d.status}` }, 502);
        }
        const oo = o.results[0], dd = d.results[0];
        return sendJSON(res, {
          origin: { id: 'live_origin', label: oo.formatted_address, lat: oo.geometry.location.lat, lng: oo.geometry.location.lng },
          dest: { id: 'live_dest', label: dd.formatted_address, lat: dd.geometry.location.lat, lng: dd.geometry.location.lng },
          mode: 'live_text'
        });
      }

      return sendJSON(res, { error: 'invalid_payload', hint: 'Use mock IDs or free-text addresses.' }, 400);
    }

    // Property image
    if (pathname === '/property-image') {
      const id = url.searchParams.get('address_id');
      const lat = url.searchParams.get('lat');
      const lng = url.searchParams.get('lng');
      const key = process.env.GOOGLE_API_KEY;

      if (id) {
        const a = ADDR_BY_ID[id];
        if (!a) return sendJSON(res, { error: 'unknown address' }, 400);
        if (key) {
          return sendJSON(res, {
            image_url: `https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${a.lat},${a.lng}&key=${key}`,
            satellite_url: `https://maps.googleapis.com/maps/api/staticmap?center=${a.lat},${a.lng}&zoom=18&size=320x180&maptype=satellite&key=${key}`,
            type_guess: a.type_guess, source: 'live'
          });
        }
        return sendJSON(res, { image_url: a.image_url, satellite_url: a.satellite_url, type_guess: a.type_guess, source: 'mock' });
      }

      if (lat && lng) {
        if (!key) {
          return sendJSON(res, {
            image_url: 'https://placehold.co/640x360?text=Street+View',
            satellite_url: 'https://placehold.co/320x180?text=Satellite',
            type_guess: null, source: 'sandbox'
          });
        }
        return sendJSON(res, {
          image_url: `https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${lat},${lng}&key=${key}`,
          satellite_url: `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=18&size=320x180&maptype=satellite&key=${key}`,
          type_guess: null, source: 'live'
        });
      }

      return sendJSON(res, { error: 'missing_params' }, 400);
    }

    // Route
    if (pathname === '/route') {
      const olat = url.searchParams.get('origin_lat');
      const olng = url.searchParams.get('origin_lng');
      const dlat = url.searchParams.get('dest_lat');
      const dlng = url.searchParams.get('dest_lng');
      const oid = url.searchParams.get('origin_id');
      const did = url.searchParams.get('dest_id');
      const key = process.env.GOOGLE_API_KEY;

      if (olat && olng && dlat && dlng) {
        if (key) {
          const u = `https://maps.googleapis.com/maps/api/directions/json?origin=${olat},${olng}&destination=${dlat},${dlng}&departure_time=now&traffic_model=best_guess&key=${key}`;
          const r = await fetch(u); const j = await r.json();
          if (j.status !== 'OK') return sendJSON(res, { error: 'directions_failed', hint: j.status }, 502);
          const leg = j.routes[0].legs[0];
          const eta = Math.round(((leg.duration_in_traffic || leg.duration).value) / 60);
          const km = +(leg.distance.value / 1000).toFixed(1);
          return sendJSON(res, { distance_km: km, eta_minutes: eta, incidents: [], leave_by: 'Plan 10 min buffer', polyline: null, source: 'live' });
        }
        const km = haversine(+olat, +olng, +dlat, +dlng);
        const eta = Math.max(5, Math.round((km / 25) * 60 * (0.9 + Math.random() * 0.4)));
        const polyline = { type: 'LineString', coordinates: [[+olng, +olat], [+dlng, +dlat]] };
        return sendJSON(res, { distance_km: +km.toFixed(1), eta_minutes: eta, incidents: [], leave_by: 'Leave within 15 min', polyline, source: 'sandbox' });
      }

      if (oid && did) {
        const o = DEPOT_BY_ID[oid], d = ADDR_BY_ID[did];
        if (!o || !d) return sendJSON(res, { error: 'unknown origin/dest' }, 400);
        const km = haversine(o.lat, o.lng, d.lat, d.lng);
        const eta = Math.max(5, Math.round((km / 25) * 60 * (0.85 + Math.random() * 0.5)));
        const polyline = { type: 'LineString', coordinates: [[o.lng, o.lat], [d.lng, d.lat]] };
        return sendJSON(res, { distance_km: +km.toFixed(1), eta_minutes: eta, incidents: [], leave_by: eta < 90 ? 'Leave now' : 'Leave within 15 min', polyline, source: 'mock' });
      }

      return sendJSON(res, { error: 'missing_params' }, 400);
    }

    // Static meta
    if (pathname === '/parking') {
      const id = url.searchParams.get('address_id') || '';
      const rules = {
        cust_1: { cpz: 'Westminster CPZ A', restrictions: ['No loading 7–10am'], red_route: false, bus_lane: true, bay_types: ['Pay & Display'], waiver_required: true },
        cust_2: { cpz: 'CPZ B', restrictions: ['P&D 8–18:30'], red_route: false, bus_lane: false, bay_types: ['Pay & Display'], waiver_required: false },
        cust_3: { cpz: 'Private estate', restrictions: ['Loading dock managed'], red_route: false, bus_lane: false, bay_types: ['Loading Bay'], waiver_required: false }
      };
      return sendJSON(res, rules[id] || {});
    }
    if (pathname === '/building') {
      const id = url.searchParams.get('address_id') || '';
      const meta = {
        cust_1: { floors: 3, lift: false, door_width_cm: 85, stair_width_cm: 90, rear_access: false },
        cust_2: { floors: 4, lift: false, door_width_cm: 80, stair_width_cm: 85, rear_access: false },
        cust_3: { floors: 50, lift: true, door_width_cm: 90, stair_width_cm: 110, rear_access: true }
      };
      return sendJSON(res, meta[id] || {});
    }
    if (pathname === '/safety') {
      const id = url.searchParams.get('address_id') || '';
      const hazards = {
        cust_1: { width_restriction: '2.0m', one_way: true, crime_risk: 'Medium' },
        cust_2: { one_way: false, crime_risk: 'Low' },
        cust_3: { width_restriction: '2.4m', one_way: true, crime_risk: 'Low' }
      };
      return sendJSON(res, hazards[id] || {});
    }

    // Weather
    if (pathname === '/weather') {
      const lat = url.searchParams.get('lat');
      const lng = url.searchParams.get('lng');
      if (!lat || !lng) return sendJSON(res, { error: 'missing_params' }, 400);
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation,wind_speed_10m&current_weather=true`, { cache: 'no-store' });
      const j = await r.json();
      const cw = j.current_weather || {};
      const temp = cw.temperature, wind = cw.windspeed;
      const cond = ([0, 1].includes(cw.weathercode)) ? 'Clear' : 'Cloudy';
      const precip = cond === 'Clear' ? 10 : 50;
      return sendJSON(res, { date: new Date().toISOString().slice(0, 10), condition: cond, temp_c: temp, wind_kmh: wind, precip_chance_pct: precip, source: 'live' });
    }

    // AI (all endpoints via /api/ai/<name>)
    if (pathname.startsWith('/ai/')) {
      if (req.method !== 'POST') return sendJSON(res, { error: 'method_not_allowed' }, 405);
      const name = pathname.split('/')[2] || '';
      const key = process.env.OPENAI_API_KEY;
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const payload = await readBody(req);

      // mock fallback
      if (!key) {
        const mocks = {
          duration: { estimated_minutes: 180, confidence_pct: 78, breakdown: { loading: 70, drive: 40, unloading: 60, buffer: 10 } },
          crew: { crew_size: 3, vehicle: 'Luton van', equipment: ['dollies', 'blankets', 'straps'] },
          quote: { price_gbp: 420, line_items: [{ label: 'Base move', amount: 330 }, { label: 'Fuel', amount: 40 }, { label: 'Materials', amount: 50 }], terms: ['50% deposit', '48h reschedule'] },
          risk: { risk_level: 'medium', flags: ['Stairs', 'One-way', 'Bus lane'], checklist: [{ item: 'Waiver', status: 'pending' }] },
          message: { channels: ['Email', 'SMS'], sms_eta: 'Hi, your movers are on the way.' },
          analyse: { pricing: { current_rate: 95, competitor_avg_rate: 88.5, recommended_rate: 89.6, change_pct: -5.7, rationale: 'High demand premium' }, lead_score: { score: 78, tier: 'A-' }, marketing: { channels: ['LSAs', 'Meta', 'GMB posts'], budget_hint_gbp: 350 }, competitor_watch: [{ name: 'Speedy Move', strength: 'price', risk: 'medium' }, { name: 'Canary Movers', strength: 'brand', risk: 'low' }] }
        };
        return sendJSON(res, mocks[name] ?? { error: 'unknown_ai_endpoint' }, mocks[name] ? 200 : 404);
      }

      const sys = 'You are an expert operations assistant for a London moving company. Return STRICT JSON.';
      const user = JSON.stringify(payload?.context || {});
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
        })
      });
      const j = await r.json();
      const content = j.choices?.[0]?.message?.content;
      try { res.setHeader('content-type', 'application/json'); return res.end(content); }
      catch { return sendJSON(res, { error: 'openai_bad_json', raw: j }, 502); }
    }

    // Not found
    return sendJSON(res, { error: 'not_found' }, 404);
  } catch (e) {
    return sendJSON(res, { error: 'server_error', message: String(e?.message || e) }, 500);
  }
}
