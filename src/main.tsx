import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// The ONE import of the global stylesheets, ahead of App so they come first
// in the cascade (before any page or component CSS). Don't re-import them in
// App.tsx or a page.
import "./theme.css";
import "./index.css";
import App from "./App";
import { registerServiceWorker } from "./lib/pwa";



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
