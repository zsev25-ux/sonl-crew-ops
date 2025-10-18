import { useParams, Link } from "react-router-dom";

export default function ProfileDetail() {
  const { userId } = useParams();
  return (
    <div className="px-4 pb-24 pt-4 text-slate-100">
      <h1 className="text-2xl font-semibold text-amber-300 mb-3">Profile</h1>
      <div className="text-slate-300 mb-4">User ID: {userId}</div>
      <div className="flex gap-3">
        <label className="bg-slate-800 px-3 py-2 rounded-xl cursor-pointer">
          <input type="file" className="hidden" aria-label="Upload avatar" />
          Upload avatar
        </label>
        <button className="bg-slate-800 px-3 py-2 rounded-xl">Edit bio</button>
      </div>
      <div className="mt-6 text-sm text-slate-400">
        <Link to="/crew/profiles" className="underline text-amber-300">Back to Profiles</Link>
      </div>
    </div>
  );
}
