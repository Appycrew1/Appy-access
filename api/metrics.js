
import { SAMPLE } from '../lib/sample.js';
export default async function handler(req,res){
  const code = (req.query.area_code||'').toUpperCase();
  const a = SAMPLE.areas.find(x=>x.code===code);
  if(!a) return res.status(404).json({ error:'unknown_area' });
  const competitor_avg_rate = 88.5;
  const current_rate = 95;
  const recommended_rate = +(current_rate * (a.demand_index/100)).toFixed(1);
  const change_pct = +(((recommended_rate-current_rate)/current_rate)*100).toFixed(1);
  const rationale = a.demand_index>70 ? 'High demand — modest premium sustainable.' : 'Moderate demand — align closer to competitor rates.';
  res.json({ area: a, current_rate, competitor_avg_rate, recommended_rate, change_pct, rationale });
}
