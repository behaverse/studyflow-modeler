import { createRoot } from 'react-dom/client';
import { migrateLegacyKeys } from '@/core/storage';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '@/assets/css/app.css';
import { Runner } from '@/runner/Runner';

// The modeler has to keep a handle on this tab to navigate it (see `openRunnerTab`), so it
// cannot pass `noopener`. Drop the back-reference here instead — nothing reads it.
window.opener = null;

migrateLegacyKeys();

createRoot(document.getElementById('root')!).render(<Runner />);
