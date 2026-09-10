import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { migrateLegacyKeys } from '@core/storage';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '#assets/css/app.css';
import { App } from '@modeler/app/App';
import '@modeler/testHooks';

// The desktop app (`studyflow edit`, packages/desktop) is a window of its own: assets/css/desktop.css styles it as the system's.
document.documentElement.classList.toggle('desktop', matchMedia('(display-mode: standalone)').matches);

migrateLegacyKeys();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
