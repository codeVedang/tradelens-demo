import React from "react";
import { createRoot } from "react-dom/client";
import Site from "./Account";
import "./styles.css";
import "./product.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Site />
  </React.StrictMode>,
);
