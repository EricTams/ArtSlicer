import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

import { Home } from './Home'
import { SoloPlay } from './solo/SoloPlay'
import { ClientApp } from './client/ClientApp'
import { EditorPlayground } from './editor/EditorPlayground'
import { HostApp } from './host/HostApp'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')

createRoot(root).render(
  <StrictMode>
    {/* Hash routing: GitHub Pages has no rewrite rules, so a deep link like
        /ArtSlicer/join/ABCD would 404. #/join/ABCD always resolves. */}
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host" element={<HostApp />} />
        <Route path="/join/:code" element={<ClientApp />} />
        <Route path="/join" element={<ClientApp />} />
        <Route path="/solo" element={<SoloPlay />} />
        {/* Standalone editor for developing the build tools without a lobby. */}
        <Route path="/editor" element={<EditorPlayground />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
)
