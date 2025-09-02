
import { ADDR_BY_ID, DEPOT_BY_ID, haversine } from '../lib/sample.js';
export default async function handler(req,res){
  const { origin_id, dest_id, origin_lat, origin_lng, dest_lat, dest_lng } = req.query;
  const key = process.env.GOOGLE_API_KEY;

  if(origin_lat && origin_lng && dest_lat && dest_lng){
    if(key){
      const u = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin_lat},${origin_lng}&destination=${dest_lat},${dest_lng}&departure_time=now&traffic_model=best_guess&key=${key}`;
      const r = await fetch(u); const j = await r.json();
      if(j.status!=='OK') return res.status(502).json({ error:'directions_failed', hint:j.status });
      const leg = j.routes[0].legs[0];
      const eta = Math.round(((leg.duration_in_traffic||leg.duration).value)/60);
      const km = +(leg.distance.value/1000).toFixed(1);
      return res.json({ distance_km:km, eta_minutes:eta, incidents:[], leave_by:'Plan 10 min buffer', polyline:null, source:'live' });
    }
    const km = haversine(+origin_lat,+origin_lng,+dest_lat,+dest_lng);
    const eta = Math.max(5, Math.round((km/25)*60*(0.9+Math.random()*0.4)));
    const polyline = { type:'LineString', coordinates:[[+origin_lng,+origin_lat],[+dest_lng,+dest_lat]] };
    return res.json({ distance_km:+km.toFixed(1), eta_minutes:eta, incidents:[], leave_by:'Leave within 15 min', polyline, source:'sandbox' });
  }

  if(origin_id && dest_id){
    const o = DEPOT_BY_ID[origin_id]; const d = ADDR_BY_ID[dest_id];
    if(!o||!d) return res.status(400).json({ error:'unknown origin/dest' });
    const km = haversine(o.lat,o.lng,d.lat,d.lng);
    const eta = Math.max(5, Math.round((km/25)*60*(0.85+Math.random()*0.5)));
    const polyline = { type:'LineString', coordinates:[[o.lng,o.lat],[d.lng,d.lat]] };
    return res.json({ distance_km:+km.toFixed(1), eta_minutes:eta, incidents:[], leave_by:eta<90?'Leave now':'Leave within 15 min', polyline, source:'mock' });
  }

  res.status(400).json({ error:'missing_params' });
}
