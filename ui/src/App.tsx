import { BrowserRouter, Routes, Route } from 'react-router-dom'
import SimpleEditor from './pages/SimpleEditor'
import { Toaster } from './components/Toaster'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SimpleEditor />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
