import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Chat } from './Chat';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}

createRoot(root).render(
  <StrictMode>
    <Chat />
  </StrictMode>,
);
