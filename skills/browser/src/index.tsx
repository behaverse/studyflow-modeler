import { createRoot } from 'react-dom/client';
import { migrateLegacyKeys } from '@core/storage';
import '#assets/css/app.css';
import { Runner } from '@runner/Runner';

// The desktop app (`studyflow edit`, packages/desktop) is a window of its own: assets/css/desktop.css styles it as the system's.
document.documentElement.classList.toggle('desktop', matchMedia('(display-mode: standalone)').matches);

// The modeler needs a handle on this tab
window.opener = null;

migrateLegacyKeys();

createRoot(document.getElementById('root')!).render(<Runner />);
