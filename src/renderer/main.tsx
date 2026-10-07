import 'pixi.js/unsafe-eval';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerSmokeRun } from './smoke';
import './styles.css';

registerSmokeRun();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
