/* eslint-disable check-file/filename-naming-convention */
import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { registerGlobalErrorHandlers } from './registerGlobalErrorHandlers';
import '../styles/index.css';
import '../styles/nerd-font.css';

// 全局错误兜底：捕获 window error / unhandledrejection，避免崩溃后静默黑屏
registerGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
