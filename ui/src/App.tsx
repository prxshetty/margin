import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import NewChapter from './pages/NewChapter'
import Workshop from './pages/Workshop'
import Characters from './pages/Characters'
import Styles from './pages/Styles'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewChapter />} />
        <Route path="/workshop" element={<Workshop />} />
        <Route path="/characters" element={<Characters />} />
        <Route path="/styles" element={<Styles />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
