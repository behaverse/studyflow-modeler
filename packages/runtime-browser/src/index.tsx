import { createRoot } from 'react-dom/client';
import '#assets/css/app.css';
import { Runner } from '@runner/Runner';

// The desktop app (`studyflow edit`, packages/desktop) is a window of its own: assets/css/desktop.css styles it as the system's.
document.documentElement.classList.toggle('desktop', matchMedia('(display-mode: standalone)').matches);

// The modeler keeps a handle on this tab to navigate it (`openRunnerTab`), so it cannot pass `noopener`;
// the back-reference is dropped here instead. Nothing reads it.
window.opener = null;

createRoot(document.getElementById('root')!).render(<Runner />);
