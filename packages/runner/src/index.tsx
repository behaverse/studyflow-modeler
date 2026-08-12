import { createRoot } from 'react-dom/client';
import { migrateLegacyKeys } from '@core/storage';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '#assets/css/app.css';
import favicon from '#assets/img/favicon.png';
import { Runner } from '@runner/Runner';

// The modeler has to keep a handle on this tab to navigate it (see `openRunnerTab`), so it
// cannot pass `noopener`. Drop the back-reference here instead — nothing reads it.
window.opener = null;

migrateLegacyKeys();

// The static favicon href in the HTML only resolves in the built site; dev serves
// repo-level assets through the module graph, so re-point it here.
document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', favicon);

createRoot(document.getElementById('root')!).render(<Runner />);
