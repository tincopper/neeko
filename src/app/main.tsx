/* eslint-disable check-file/filename-naming-convention */
import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { bootstrap } from './bootstrap';
import { ErrorBoundary } from './components/ErrorBoundary';
import '../styles/index.css';
import '../styles/nerd-font.css';
import '../styles/jetbrains-mono.css';

bootstrap();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
