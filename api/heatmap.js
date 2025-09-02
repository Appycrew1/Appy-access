
import { SAMPLE } from '../lib/sample.js';
export default async function handler(req,res){
  const features = SAMPLE.areas.map(a=>({ type:'Feature', properties:{ code:a.code, name:a.name, demand_index:a.demand_index }, geometry:{ type:'Point', coordinates:[a.centroid[1], a.centroid[0]] } }));
  res.json({ type:'FeatureCollection', features });
}
