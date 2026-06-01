// main.tsx
// Vite entry point. Mounts the React app with BrowserRouter; the lofi theme
// is applied via `data-theme="lofi"` on <html> in index.html
// (R71 §3.2 / docs/ui_design.md §1).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <App />
    </BrowserRouter>
  </StrictMode>
);
