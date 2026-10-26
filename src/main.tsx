import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import { backend } from "./lib/backend";
const App=lazy(()=>backend=== "local" ? import("./local-app/LocalCatalogApp").then(m=>({default:m.LocalCatalogApp})) : import("./App").then(m=>({default:m.App})));
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("The application root is missing.");
}

createRoot(root).render(<StrictMode><Suspense fallback={<p>正在载入控制台…</p>}><App /></Suspense></StrictMode>);
