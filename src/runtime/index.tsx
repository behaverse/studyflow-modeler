import { createRoot } from 'react-dom/client';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '@/assets/css/app.css';
import { Executor } from './Executor';

createRoot(document.getElementById('root')!).render(<Executor />);
