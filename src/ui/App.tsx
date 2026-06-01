// App.tsx
// Router shell. MVP routes per R71 §3.4 / docs/ui_design.md §7.

import { Routes, Route, Navigate } from 'react-router-dom';
import SignIn from './SignIn';
import Backdoor from './Backdoor';
import AuthCallback from './AuthCallback';
import ImagePage from './Image';
import CreatorPage from './Creator';
import ProfilePage from './Profile';
import CollectionPage from './Collection';
import DeedPage from './Deed';
import AdminReviewsPage from './AdminReviews';

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/backdoor" element={<Backdoor />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/creator" element={<CreatorPage />} />
      <Route path="/creator/profile" element={<ProfilePage />} />
      <Route path="/collection" element={<CollectionPage />} />
      <Route path="/admin/reviews" element={<AdminReviewsPage />} />
      <Route path="/:imageId/deed" element={<DeedPage />} />
      <Route path="/:imageId" element={<ImagePage />} />
      <Route path="/" element={<Navigate to="/signin" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card bg-base-200 shadow-sm">
        <div className="card-body">
          <h2 className="card-title">Not found</h2>
        </div>
      </div>
    </main>
  );
}
