import { BrowserRouter, Routes, Route } from 'react-router-dom'
import NewChapter from './pages/NewChapter'
import Workshop from './pages/Workshop'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Workshop />} />
        <Route path="/new" element={<NewChapter />} />
        <Route path="/workshop" element={<Workshop />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
