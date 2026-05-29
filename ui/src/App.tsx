import { BrowserRouter, Routes, Route } from 'react-router-dom'
import NewChapter from './pages/NewChapter'
import Workshop from './pages/Workshop'
import SimpleEditor from './pages/SimpleEditor'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Workshop />} />
        <Route path="/new" element={<NewChapter />} />
        <Route path="/workshop" element={<Workshop />} />
        <Route path="/simple" element={<SimpleEditor />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
