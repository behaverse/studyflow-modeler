import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { migrateLegacyKeys } from '@runner/storage';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '#assets/css/app.css';
import { App } from '@modeler/app/App';
import '@modeler/testHooks';

migrateLegacyKeys();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
