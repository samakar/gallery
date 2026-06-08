// App.tsx
// Router shell. MVP routes per R71 §3.4 / docs/ui_design.md §7.

import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import SignIn from './SignIn';
import Backdoor from './Backdoor';
import AuthCallback from './AuthCallback';
import LegalPage from './LegalPage';
import CreatorPublicPage from './CreatorPublic';

// Canonical creator URL: /c/<handle>. Bare `/<slug>` still works for
// backward-compat -- if the slug isn't a 5-char base-36 image_id, we
// redirect to the canonical /c/ path. image_id is exactly 5 chars of
// lowercase base-36 per the image_id_generator contract.
const IMAGE_ID_PATTERN = /^[a-z0-9]{5}$/;
function SlugRouter() {
  const { slug } = useParams();
  if (slug && IMAGE_ID_PATTERN.test(slug)) {
    return <ImagePage imageId={slug} />;
  }
  // Legacy bare-handle URL -- redirect to canonical /c/<handle>.
  return <Navigate to={`/c/${slug ?? ''}`} replace />;
}
import ImagePage from './Image';
import CreatorPage from './Creator';
import ProfilePage from './Profile';
import CollectionPage from './Collection';
import DeedPage from './Deed';
import AdminReviewsPage from './AdminReviews';
import YoutubeVerifyPage from './YoutubeVerify';
import SignCmaPage from './SignCma';
import RecoveryKey from './RecoveryKey';

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/backdoor" element={<Backdoor />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/tos" element={<LegalPage docType="TOS" title="Terms of Service" />} />
      <Route path="/privacy" element={<LegalPage docType="PRIVACY" title="Privacy Policy" />} />
      <Route path="/creator" element={<CreatorPage />} />
      <Route path="/creator/profile" element={<ProfilePage />} />
      {/* YouTube OAuth gate (identity.md §2.8). Both /connect and /callback
          render the same component -- it switches on `?code=` in the URL. */}
      <Route path="/creator/youtube/connect" element={<YoutubeVerifyPage />} />
      <Route path="/creator/youtube/callback" element={<YoutubeVerifyPage />} />
      {/* CMA signing (identity.md §2.7 + creator_onboarding_wsd.md step 6). */}
      <Route path="/creator/sign-cma" element={<SignCmaPage />} />
      <Route path="/collection" element={<CollectionPage />} />
      <Route path="/recovery-key" element={<RecoveryKey />} />
      <Route path="/admin/reviews" element={<AdminReviewsPage />} />
      {/* /<image_id>/deed stays imageId-specific (deeds always belong to images) */}
      <Route path="/:imageId/deed" element={<DeedPage />} />
      {/* Canonical creator page. */}
      <Route path="/c/:handle" element={<CreatorPublicPage />} />
      {/* Legacy bare slug: dispatch to ImagePage or redirect to /c/<handle>. */}
      <Route path="/:slug" element={<SlugRouter />} />
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
