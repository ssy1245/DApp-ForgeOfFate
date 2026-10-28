import React from 'react';
import ReactDOM from 'react-dom/client';
import { LanguageProvider } from './i18n';
import './style.css';
import './weaponCards.css';
import './materials.css';
const Page = React.lazy(() => window.location.pathname === '/deploy' ? import('./DeployApp') : import('./App'));
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><LanguageProvider><React.Suspense fallback={null}><Page/></React.Suspense></LanguageProvider></React.StrictMode>);
