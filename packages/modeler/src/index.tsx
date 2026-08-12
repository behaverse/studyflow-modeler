import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { migrateLegacyKeys } from '@core/storage';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '#assets/css/app.css';
import favicon from '#assets/img/favicon.png';
import { App } from '@modeler/app/App';
import '@modeler/testHooks';

migrateLegacyKeys();

// The static favicon href in the HTML only resolves in the built site; dev serves
// repo-level assets through the module graph, so re-point it here.
document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', favicon);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
