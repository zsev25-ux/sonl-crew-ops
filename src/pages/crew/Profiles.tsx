import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import type { CrewUser } from "../../lib/crew";
const mock: CrewUser[] = [
  { id: "u1", displayName: "Luke", role: "crew", stats: { kudos: 10, bonuses: 4, onTimePct: 96 } },
  { id: "u2", displayName: "Grant", role: "crew", stats: { kudos: 7, bonuses: 6, onTimePct: 91 } },
];
export default function Profiles() {
  const [q, setQ] = useState("");
  const data = useMemo(() => mock.filter(u => u.displayName.toLowerCase().includes(q.toLowerCase())), [q]);
  return (
    <div className="px-4 pb-24 pt-4 text-slate-100">
      <h1 className="text-2xl font-semibold text-amber-300 mb-3">Crew Profiles</h1>
      <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search crew..."
        className="w-full rounded-xl bg-slate-800 px-3 py-2 mb-3 outline-none ring-1 ring-slate-700 focus:ring-amber-400" />
      <div className="grid grid-cols-2 gap-3">
        {data.map(u => (
          <Link key={u.id} to={`/crew/profiles/${u.id}`} className="bg-slate-800 rounded-2xl p-4 hover:bg-slate-700">
            <div className="text-lg font-medium">{u.displayName}</div>
            <div className="text-xs text-slate-400">{u.role}</div>
            <div className="mt-2 text-xs text-slate-300">
              Kudos: {u.stats?.kudos ?? 0} • Bonuses: {u.stats?.bonuses ?? 0} • On-time: {u.stats?.onTimePct ?? 0}%
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
