import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// 全域重置 + 背景，避免手機上出現白邊
const style = document.createElement("style");
style.textContent =
  "*{margin:0;padding:0;box-sizing:border-box}html,body,#root{min-height:100%}body{background:#F5F3EF;-webkit-tap-highlight-color:transparent}";
document.head.appendChild(style);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
