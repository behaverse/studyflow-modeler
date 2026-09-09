import { createRoot } from 'react-dom/client';
import { migrateLegacyKeys } from '@runner/storage';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '#assets/css/app.css';
import { Runner } from '@runner/Runner';

// The modeler needs a handle on this tab
window.opener = null;

migrateLegacyKeys();

createRoot(document.getElementById('root')!).render(<Runner />);
