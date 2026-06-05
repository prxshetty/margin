import { BrowserRouter, Routes, Route } from 'react-router-dom'
import SimpleEditor from './pages/SimpleEditor'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SimpleEditor />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
