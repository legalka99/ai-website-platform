import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app.js";
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);

// Keep browser chrome aligned with the single CSS background token.
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
if (themeColor) themeColor.content = getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim();
