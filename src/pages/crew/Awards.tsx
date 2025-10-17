const rules = [
  { key: "dab_pen_chronicle", title: "The Chronicle" },
  { key: "early_buzz_champ",  title: "Early Buzz Champion" },
  { key: "latte_lawd",        title: "Latte Lawd" },
  { key: "titty_tuesday",     title: "Titty Tuesday" },
  { key: "upperdecky_whore",  title: "Upperdecky Whore" },
];
export default function Awards() {
  return (
    <div className="px-4 pb-24 pt-4 text-slate-100">
      <h1 className="text-2xl font-semibold text-amber-300 mb-3">Season Awards</h1>
      <div className="text-slate-400 text-sm mb-4">Season: 2025 (example)</div>
      <div className="grid grid-cols-2 gap-3">
        {rules.map(r=>(
          <div key={r.key} className="bg-slate-800 rounded-2xl p-4">
            <div className="text-lg font-medium">{r.title}</div>
            <div className="text-xs text-slate-400 mt-1">Tap to view criteria</div>
          </div>
        ))}
      </div>
    </div>
  );
}
