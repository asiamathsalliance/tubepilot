import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { VideoPreviewProvider } from './context/VideoPreviewProvider'
import { AppShell } from './components/layout/AppShell'
import { ProjectWorkflowLayout } from './components/layout/ProjectWorkflowLayout'
import { Dashboard } from './pages/Dashboard'
import { StartNewProject } from './pages/StartNewProject'
import { Input } from './pages/Input'
import { VideoBasicInfo } from './pages/VideoBasicInfo'
import { EndScreen } from './pages/EndScreen'
import { EditorClipfarm } from './pages/EditorClipfarm'
import { ReviewPage1 } from './pages/ReviewPage1'
import { ReviewPage2 } from './pages/ReviewPage2'
import { NotFound } from './pages/NotFound'

export default function App() {
  return (
    <BrowserRouter>
      <VideoPreviewProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects/new" element={<StartNewProject />} />
            <Route path="/projects/:id" element={<ProjectWorkflowLayout />}>
              <Route path="input" element={<Input />} />
              <Route path="video-info" element={<VideoBasicInfo />} />
              <Route path="end-screen" element={<EndScreen />} />
              <Route path="editor" element={<EditorClipfarm />} />
              <Route path="review-1" element={<ReviewPage1 />} />
              <Route path="review-2" element={<ReviewPage2 />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </VideoPreviewProvider>
    </BrowserRouter>
  )
}
