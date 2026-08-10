import { createRoot } from 'react-dom/client';
import { migrateLegacyKeys } from '@/core/storage';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '@/assets/css/app.css';
import { Runner } from '@/runner/Runner';

migrateLegacyKeys();

createRoot(document.getElementById('root')!).render(<Runner />);
