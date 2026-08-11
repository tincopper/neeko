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

// 心跳由 App.tsx 内的 useHeartbeat() 驱动（App 崩溃即停跳，后端据此超时 reload 恢复）
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
