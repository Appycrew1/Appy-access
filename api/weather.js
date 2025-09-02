
export default async function handler(req,res){
  const { lat, lng } = req.query;
  if(!lat||!lng) return res.status(400).json({ error:'missing_params' });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation,wind_speed_10m&current_weather=true`, { cache: 'no-store' });
  const j = await r.json(); const cw = j.current_weather||{};
  const temp = cw.temperature, wind = cw.windspeed;
  const cond = ([0,1].includes(cw.weathercode)) ? 'Clear' : 'Cloudy';
  const precip = cond==='Clear' ? 10 : 50;
  res.json({ date: new Date().toISOString().slice(0,10), condition: cond, temp_c: temp, wind_kmh: wind, precip_chance_pct: precip, source:'live' })
}
