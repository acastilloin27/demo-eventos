import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import Admin from "./AdminPanel"
import "./index.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname.replace(/\/$/, "") === "/admin" ? <Admin /> : <App />}
  </React.StrictMode>,
)
