
import { ADDR_BY_ID, DEPOT_BY_ID, sandboxGeocode } from '../lib/sample.js';
export default async function handler(req,res){
  if(req.method!=='POST'){ res.status(405).json({error:'method_not_allowed'}); return }
  const { customer_address_id, depot_id, customer_address_text, depot_address_text } = req.body || {};

  if(customer_address_id && depot_id){
    const o = DEPOT_BY_ID[depot_id]; const d = ADDR_BY_ID[customer_address_id];
    if(!o||!d) return res.status(400).json({ error:'unknown origin/dest' });
    return res.json({ origin:o, dest:d, mode:'mock_ids' });
  }

  if(customer_address_text && depot_address_text){
    const key = process.env.GOOGLE_API_KEY;
    if(!key){
      const o = sandboxGeocode(depot_address_text,51.472,-0.142);
      const d = sandboxGeocode(customer_address_text,51.515,-0.141);
      return res.json({ origin:o, dest:d, mode:'sandbox_text' });
    }
    const g = 'https://maps.googleapis.com/maps/api/geocode/json';
    const [rs, rc] = await Promise.all([
      fetch(`${g}?address=${encodeURIComponent(depot_address_text)}&key=${key}`),
      fetch(`${g}?address=${encodeURIComponent(customer_address_text)}&key=${key}`)
    ]);
    const [o,d] = [await rs.json(), await rc.json()];
    if(o.status!=='OK' || d.status!=='OK'){
      return res.status(502).json({ error:'geocode_failed', hint:`origin=${o.status} dest=${d.status}` });
    }
    const oo=o.results[0], dd=d.results[0];
    return res.json({ origin:{id:'live_origin',label:oo.formatted_address,lat:oo.geometry.location.lat,lng:oo.geometry.location.lng},
                      dest:{id:'live_dest',label:dd.formatted_address,lat:dd.geometry.location.lat,lng:dd.geometry.location.lng},
                      mode:'live_text' });
  }

  res.status(400).json({ error:'invalid_payload', hint:'Use mock IDs or free-text addresses.' });
}
