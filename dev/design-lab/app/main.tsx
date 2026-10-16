import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './app.css';

// dev/design-lab/app/main.tsx：设计试验台入口，保持与正式应用完全解耦。
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
