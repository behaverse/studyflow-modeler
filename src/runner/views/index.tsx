import { createRoot } from 'react-dom/client';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '@/assets/css/app.css';
import { Runner } from '@/runner/views/Runner';

createRoot(document.getElementById('root')!).render(<Runner />);
