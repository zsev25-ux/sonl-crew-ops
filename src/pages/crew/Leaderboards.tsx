import { useState } from "react";
import { defaultCategories } from "../../lib/crew";
const mockUsers = [
  { id: "u1", name: "Luke",   stats: { bonuses: 4, kudos: 10, onTimePct: 96 } },
  { id: "u2", name: "Grant",  stats: { bonuses: 6, kudos: 7,  onTimePct: 91 } },
  { id: "u3", name: "Madden", stats: { bonuses: 3, kudos: 12, onTimePct: 88 } },
];
export default function Leaderboards() {
  const [active, setActive] = useState(defaultCategories[0]);
  const ranked = [...mockUsers].sort((a,b)=> {
    const av = get(a, active.field) ?? 0; const bv = get(b, active.field) ?? 0;
    return active.higherIsBetter ? bv - av : av - bv;
  });
  const top3 = ranked.slice(0,3); const rest = ranked.slice(3);
  return (
    <div className="px-4 pb-24 pt-4 text-slate-100">
      <h1 className="text-2xl font-semibold text-amber-300 mb-3">Leaderboards</h1>
      <div className="flex gap-2 mb-4">
        {defaultCategories.map(c=>(
          <button key={c.key} onClick={()=>setActive(c)}
            className={`px-3 py-1 rounded-full text-sm ${active.key===c.key ? "bg-amber-500 text-slate-900" : "bg-slate-800 text-slate-200"}`}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 items-end h-56 mb-4">
        {top3.map((p,i)=>(
          <div key={p.id} className="flex flex-col items-center">
            <div className="w-20 bg-amber-600 rounded-t-2xl shadow-lg" style={{ height: [120,160,100][i] }} />
            <div className="mt-2 text-sm text-center">
              {p.name}
              <div className="text-amber-300 text-xs">{get(p, active.field) ?? 0}</div>
            </div>
          </div>
        ))}
      </div>
      <ul className="divide-y divide-slate-800 rounded-xl overflow-hidden">
        {rest.map((p, idx)=>(
          <li key={p.id} className="flex items-center justify-between bg-slate-900 px-3 py-2">
            <span className="text-slate-400 text-sm">#{idx+4}</span>
            <span className="flex-1 ml-3">{p.name}</span>
            <span className="text-amber-300">{get(p, active.field) ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
function get(obj:any, path:string){ return path.split(".").reduce((acc,k)=>(acc?acc[k]:undefined), obj); }
