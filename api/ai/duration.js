
export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const payload = req.body||{};

  if(!key){
    const mocks = {
      duration: { estimated_minutes:180, confidence_pct:78, breakdown:{loading:70,drive:40,unloading:60,buffer:10} },
      crew: { crew_size:3, vehicle:'Luton van', equipment:['dollies','blankets','straps'] },
      quote: { price_gbp:420, line_items:[{label:'Base move',amount:330},{label:'Fuel',amount:40},{label:'Materials',amount:50}], terms:['50% deposit','48h reschedule'] },
      risk: { risk_level:'medium', flags:['Stairs','One-way','Bus lane'], checklist:[{item:'Waiver',status:'pending'}] },
      message: { channels:['Email','SMS'], sms_eta:'Hi, your movers are on the way.' },
      analyse: { pricing:{current_rate:95,competitor_avg_rate:88.5,recommended_rate:89.6,change_pct:-5.7,rationale:'High demand premium'}, lead_score:{score:78, tier:'A-'}, marketing:{channels:['LSAs','Meta','GMB posts'], budget_hint_gbp:350}, competitor_watch:[{name:'Speedy Move', strength:'price', risk:'medium'},{name:'Canary Movers', strength:'brand', risk:'low'}] }
    };
    return res.json(mocks['duration']);
  }

  const sys = 'You are an expert operations assistant for a London moving company. Return STRICT JSON.';
  const user = JSON.stringify(payload?.context||{});
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model, temperature:0.2, response_format:{type:'json_object'}, messages:[{role:'system',content:sys},{role:'user',content:user}] })
  });
  const j = await r.json();
  const content = j.choices?.[0]?.message?.content;
  try{ res.setHeader('content-type','application/json'); res.send(content) }catch{ res.status(502).json({ error:'openai_bad_json', raw:j }) }
}
