import fs from 'node:fs';
import path from 'node:path';
import {
  SAMPLE, ADDR_BY_ID, DEPOT_BY_ID,
  haversine, sandboxGeocode
} from '../lib/sample.js';

// ---------- helpers ----------
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
function toUnix(tsISOOrMillis, fallback = Date.now()) {
  if (!tsISOOrMillis) return Math.floor(fallback / 1000);
  if (/^\d+$/.test(String(tsISOOrMillis))) return Math.floor(Number(tsISOOrMillis) / 1000);
  const t = Date.parse(tsISOOrMillis);
  return Number.isFinite(t) ? Math.floor(t / 1000) : Math.floor(fallback / 1000);
}
function bboxAround(lat, lng, km = 5) {
  const dLat = km / 111;            // deg per km
  const dLng = km / (111 * Math.cos(lat * Math.PI / 180));
  return {
    top: lat + dLat, bottom: lat - dLat,
    left: lng - dLng, right: lng + dLng
  };
}

// ---------- router ----------
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname.replace(/^\/api/, '') || '/';

    // Health
    if (pathname === '/ping') return sendJSON(res, { ok: true, ts: Date.now() });
    if (pathname === '/env-status') {
      return sendJSON(res, {
        openai: !!process.env.OPENAI_API_KEY,
        google: !!process.env.GOOGLE_API_KEY,
        tomtom: !!process.env.TOMTOM_API_KEY,
        tfl: !!(process.env.TFL_APP_ID && process.env.TFL_APP_KEY)
      });
    }

    // Static data
    if (pathname === '/sample_addresses') {
      return sendJSON(res, { depots: SAMPLE.depots, customers: SAMPLE.addresses });
    }
    if (pathname === '/areas') return sendJSON(res, { areas: SAMPLE.areas });
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
      return sendJSON(res, { area: a, current_rate, competitor_avg_rate, recommended_rate, change_pct, rationale });
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

    // Intake: origin/dest selection (mock IDs or free text)
    if (pathname === '/intake') {
      if (req.method !== 'POST') return sendJSON(res, { error: 'method_not_allowed' }, 405);
      const { customer_address_id, depot_id, customer_address_text, depot_address_text } = await readBody(req);

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
          const oh = `${o.status}${o.error_message ? ' - ' + o.error_message : ''}`;
          const dh = `${d.status}${d.error_message ? ' - ' + d.error_message : ''}`;
          return sendJSON(res, { error: 'geocode_failed', hint: `origin=${oh} dest=${dh}` }, 502);
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

    // Property imagery (Street View + Satellite) — live or mock
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

    // Route — supports future planning via departure_time (UNIX)
    if (pathname === '/route') {
      const olat = url.searchParams.get('origin_lat');
      const olng = url.searchParams.get('origin_lng');
      const dlat = url.searchParams.get('dest_lat');
      const dlng = url.searchParams.get('dest_lng');
      const oid = url.searchParams.get('origin_id');
      const did = url.searchParams.get('dest_id');
      const when = url.searchParams.get('when'); // ISO or unix
      const key = process.env.GOOGLE_API_KEY;

      const depUnix = toUnix(when);

      if (olat && olng && dlat && dlng) {
        if (key) {
          const u = `https://maps.googleapis.com/maps/api/directions/json?origin=${olat},${olng}&destination=${dlat},${dlng}&departure_time=${depUnix}&traffic_model=best_guess&key=${key}`;
          const r = await fetch(u); const j = await r.json();
          if (j.status !== 'OK') return sendJSON(res, { error: 'directions_failed', hint: j.status }, 502);
          const leg = j.routes[0].legs[0];
          const eta = Math.round(((leg.duration_in_traffic || leg.duration).value) / 60);
          const km = +(leg.distance.value / 1000).toFixed(1);
          return sendJSON(res, { distance_km: km, eta_minutes: eta, incidents: [], leave_by: 'Plan 10 min buffer', polyline: null, source: 'live', departure_unix: depUnix });
        }
        const km = haversine(+olat, +olng, +dlat, +dlng);
        const eta = Math.max(5, Math.round((km / 25) * 60 * (0.9 + Math.random() * 0.4)));
        const polyline = { type: 'LineString', coordinates: [[+olng, +olat], [+dlng, +dlat]] };
        return sendJSON(res, { distance_km: +km.toFixed(1), eta_minutes: eta, incidents: [], leave_by: 'Leave within 15 min', polyline, source: 'sandbox', departure_unix: depUnix });
      }

      if (oid && did) {
        const o = DEPOT_BY_ID[oid], d = ADDR_BY_ID[did];
        if (!o || !d) return sendJSON(res, { error: 'unknown origin/dest' }, 400);
        const km = haversine(o.lat, o.lng, d.lat, d.lng);
        const eta = Math.max(5, Math.round((km / 25) * 60 * (0.85 + Math.random() * 0.5)));
        const polyline = { type: 'LineString', coordinates: [[o.lng, o.lat], [d.lng, d.lat]] };
        return sendJSON(res, { distance_km: +km.toFixed(1), eta_minutes: eta, incidents: [], leave_by: eta < 90 ? 'Leave now' : 'Leave within 15 min', polyline, source: 'mock', departure_unix: depUnix });
      }

      return sendJSON(res, { error: 'missing_params' }, 400);
    }

    // Roadworks & traffic incidents (TomTom or TfL, else mock)
    if (pathname === '/incidents') {
      const lat = parseFloat(url.searchParams.get('lat'));
      const lng = parseFloat(url.searchParams.get('lng'));
      const radiusKm = parseFloat(url.searchParams.get('radius_km') || '5');
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return sendJSON(res, { error: 'missing_params' }, 400);
      }

      const tomtom = process.env.TOMTOM_API_KEY;
      const tflId = process.env.TFL_APP_ID, tflKey = process.env.TFL_APP_KEY;
      const box = bboxAround(lat, lng, radiusKm);

      // Try TomTom first
      if (tomtom) {
        try {
          const u = `https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${box.top},${box.left},${box.bottom},${box.right}&fields=%7Bincidents%7Btype%2CiconCategory%2CstartTime%2CendTime%2Cfrom%2Cto%2CroadNumbers%2Cpolyline%2CprobabilityOfOccurrence%2CdelaySeconds%7D%7D&key=${tomtom}`;
          const r = await fetch(u);
          const j = await r.json();
          const items = (j.incidents || []).map((i) => ({
            type: i.type, icon: i.iconCategory, from: i.from, to: i.to,
            start: i.startTime, end: i.endTime, delay_s: i.delaySeconds || 0,
            polyline: i.polyline || null, road: (i.roadNumbers || [])[0] || null
          }));
          return sendJSON(res, { source: 'tomtom', count: items.length, items });
        } catch (e) {
          // fall through
        }
      }

      // If within London area and TfL creds present, try TfL
      const inLondon = lat > 51.28 && lat < 51.7 && lng > -0.5 && lng < 0.3;
      if (inLondon && tflId && tflKey) {
        try {
          const u = `https://api.tfl.gov.uk/Road/All/Disruption?app_id=${tflId}&app_key=${tflKey}`;
          const r = await fetch(u);
          const j = await r.json();
          const items = (Array.isArray(j) ? j : []).filter(d => d.category || d.severity).slice(0, 100).map(d => ({
            category: d.category, severity: d.severity, start: d.startDateTime, end: d.endDateTime,
            road: d.roadName || d.roadNumber || null, location: d.location || d.comments || null
          }));
          return sendJSON(res, { source: 'tfl', count: items.length, items });
        } catch (e) {
          // fall through
        }
      }

      // Mock fallback
      const mock = [
        { category: 'Roadworks', severity: 'moderate', start: new Date().toISOString(), end: null, road: 'A3212', location: 'Temporary lane closure' },
        { category: 'Congestion', severity: 'minor', start: new Date().toISOString(), end: null, road: 'Battersea Bridge', location: 'Peak-time congestion' }
      ];
      return sendJSON(res, { source: 'mock', count: mock.length, items: mock });
    }

    // Parking/building/safety — supports date awareness
    if (pathname === '/parking') {
      const id = url.searchParams.get('address_id') || '';
      const when = url.searchParams.get('when'); // ISO/unix (not strictly used in mock but kept for future)
      const rules = {
        cust_1: { cpz: 'Westminster CPZ A', restrictions: ['No loading 7–10am (Mon–Fri)'], red_route: false, bus_lane: true, bay_types: ['Pay & Display'], waiver_required: true, notes: 'Apply for waiver 24h prior.' },
        cust_2: { cpz: 'CPZ B', restrictions: ['P&D 8–18:30 (Mon–Sat)'], red_route: false, bus_lane: false, bay_types: ['Pay & Display'], waiver_required: false },
        cust_3: { cpz: 'Private estate', restrictions: ['Loading dock managed'], red_route: false, bus_lane: false, bay_types: ['Loading Bay'], waiver_required: false }
      };
      return sendJSON(res, rules[id] || {});
    }
    if (pathname === '/building') {
      const id = url.searchParams.get('address_id') || '';
      const meta = {
        cust_1: { building_type: 'Terraced house', floors: 3, lift: false, stairs: true, door_width_cm: 85, stair_width_cm: 90, rear_access: false },
        cust_2: { building_type: 'Flat above shop', floors: 4, lift: false, stairs: true, door_width_cm: 80, stair_width_cm: 85, rear_access: false },
        cust_3: { building_type: 'High-rise', floors: 50, lift: true, stairs: true, door_width_cm: 90, stair_width_cm: 110, rear_access: true }
      };
      return sendJSON(res, meta[id] || {});
    }
    if (pathname === '/safety') {
      const id = url.searchParams.get('address_id') || '';
      const hazards = {
        cust_1: { width_restriction: '2.0m', one_way: true, crime_risk: 'Medium', notes: 'Narrow street; consider smaller vehicle or winger removal.' },
        cust_2: { width_restriction: null, one_way: false, crime_risk: 'Low' },
        cust_3: { width_restriction: '2.4m', one_way: true, crime_risk: 'Low', notes: 'Estate security for access to loading bay.' }
      };
      return sendJSON(res, hazards[id] || {});
    }

    // Weather (live via Open-Meteo, no key required)
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

    // Calendar (.ics download) for planning
    if (pathname === '/calendar') {
      // expects POST with { title, start_iso, duration_minutes, location, notes }
      if (req.method !== 'POST') return sendJSON(res, { error: 'method_not_allowed' }, 405);
      const { title = 'Move Job', start_iso, duration_minutes = 120, location = '', notes = '' } = await readBody(req);
      const dtStart = new Date(start_iso || Date.now());
      if (isNaN(dtStart.getTime())) return sendJSON(res, { error: 'invalid_start' }, 400);
      const dtEnd = new Date(dtStart.getTime() + duration_minutes * 60000);

      function fmt(d) {
        const pad = (n) => String(n).padStart(2, '0');
        return d.getUTCFullYear() +
          pad(d.getUTCMonth() + 1) +
          pad(d.getUTCDate()) + 'T' +
          pad(d.getUTCHours()) +
          pad(d.getUTCMinutes()) +
          pad(d.getUTCSeconds()) + 'Z';
      }
      const ics =
`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Moving Pre-Survey//EN
BEGIN:VEVENT
UID:${Date.now()}@moving-pre-survey
DTSTAMP:${fmt(new Date())}
DTSTART:${fmt(dtStart)}
DTEND:${fmt(dtEnd)}
SUMMARY:${title.replace(/\n/g, ' ')}
LOCATION:${(location || '').replace(/\n/g, ' ')}
DESCRIPTION:${(notes || '').replace(/\n/g, ' ')}
END:VEVENT
END:VCALENDAR`;

      res.statusCode = 200;
      res.setHeader('content-type', 'text/calendar; charset=utf-8');
      res.setHeader('content-disposition', 'attachment; filename="move-job.ics"');
      return res.end(ics);
    }

    // AI: all endpoints via /api/ai/<name>
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
          analyse: {
            pricing: { current_rate: 95, competitor_avg_rate: 88.5, recommended_rate: 89.6, change_pct: -5.7, rationale: 'High demand premium' },
            lead_score: { score: 78, tier: 'A-' },
            marketing: { channels: ['LSAs', 'Meta', 'GMB posts'], budget_hint_gbp: 350 },
            competitor_watch: [{ name: 'Speedy Move', strength: 'price', risk: 'medium' }, { name: 'Canary Movers', strength: 'brand', risk: 'low' }],
            access_summary: 'Narrow terraced street, morning loading restrictions, consider smaller vehicle or waiver.'
          }
        };
        return sendJSON(res, mocks[name] ?? { error: 'unknown_ai_endpoint' }, mocks[name] ? 200 : 404);
      }

      const sys =
`You are an expert access & operations assistant for a moving company in London.
Given JSON context (origin, destination, route, incidents, parking, building, safety, weather, datetime),
return STRICT JSON with actionable insights and clear recommendations.`;

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
