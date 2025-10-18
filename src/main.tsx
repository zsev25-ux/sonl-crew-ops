import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";

import Profiles from "./pages/crew/Profiles";
import ProfileDetail from "./pages/crew/ProfileDetail";
import Leaderboards from "./pages/crew/Leaderboards";
import Awards from "./pages/crew/Awards";

function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <h1 className="text-2xl font-bold text-amber-300">SONL Crew Ops</h1>
      <p className="mt-2 text-slate-300">Quick links:</p>
      <ul className="list-disc ml-6 mt-2">
        <li><a className="underline text-amber-300" href="/crew/profiles">Crew Profiles</a></li>
        <li><a className="underline text-amber-300" href="/crew/leaderboards">Leaderboards</a></li>
        <li><a className="underline text-amber-300" href="/crew/awards">Season Awards</a></li>
      </ul>
    </div>
  );
}

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/crew/profiles", element: <Profiles /> },
  { path: "/crew/profiles/:userId", element: <ProfileDetail /> },
  { path: "/crew/leaderboards", element: <Leaderboards /> },
  { path: "/crew/awards", element: <Awards /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
