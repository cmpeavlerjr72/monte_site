import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { registerServiceWorker } from "./lib/pwa";
import "./theme.css";
import "./index.css";



const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML = "<pre>Missing #root element in index.html</pre>";
  throw new Error("Missing #root element");
}

document.documentElement.classList.add("theme-blue-gold");


ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// App-shell service worker (production builds only — see src/sw.ts).
registerServiceWorker();
