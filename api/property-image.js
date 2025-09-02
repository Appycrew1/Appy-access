
import { ADDR_BY_ID } from '../lib/sample.js';
export default async function handler(req,res){
  const { address_id, lat, lng } = req.query;
  const key = process.env.GOOGLE_API_KEY;
  if(address_id){
    const a = ADDR_BY_ID[address_id];
    if(!a) return res.status(400).json({ error:'unknown address' });
    if(key){
      return res.json({
        image_url:`https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${a.lat},${a.lng}&key=${key}`,
        satellite_url:`https://maps.googleapis.com/maps/api/staticmap?center=${a.lat},${a.lng}&zoom=18&size=320x180&maptype=satellite&key=${key}`,
        type_guess:a.type_guess, source:'live'
      });
    }
    return res.json({ image_url:a.image_url, satellite_url:a.satellite_url, type_guess:a.type_guess, source:'mock' });
  }
  if(lat && lng){
    if(!key) return res.json({ image_url:'https://placehold.co/640x360?text=Street+View', satellite_url:'https://placehold.co/320x180?text=Satellite', type_guess:null, source:'sandbox' });
    return res.json({
      image_url:`https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${lat},${lng}&key=${key}`,
      satellite_url:`https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=18&size=320x180&maptype=satellite&key=${key}`,
      type_guess:null, source:'live'
    });
  }
  res.status(400).json({ error:'missing_params' });
}
