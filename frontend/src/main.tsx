import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './i18n'
import './main.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <>
      <App />
      <Toaster richColors position="bottom-right" />
    </>
  </StrictMode>,
)
