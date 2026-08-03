import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'

// Register the service worker for PWA support
registerSW()

// Simple placeholder app — replace with your actual App component
const App = () => (
  <div className="h-full flex items-center justify-center bg-gray-900 text-white">
    <div className="text-center">
      <h1 className="text-4xl font-bold mb-4">ตู้กับข้าวบ้านยาย & Siam Blend Bar</h1>
      <p className="text-xl">Loading...</p>
    </div>
  </div>
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

