// Rendered for both an unknown id and a key whose sharing is turned off.
// The two cases must be indistinguishable — a different message for "exists but
// unshared" would turn this page into an oracle for which ids are real.
export const metadata = {
  title: "Link not available",
  robots: { index: false, follow: false },
};

export default function PublicKeyNotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-2 px-4 text-center">
      <span className="material-symbols-outlined text-[28px] text-text-muted">link_off</span>
      <h1 className="text-base font-semibold text-text-main">This link is not available</h1>
      <p className="text-xs text-text-muted">
        It may have been turned off, or it may never have existed. Ask whoever gave you the link for a current one.
      </p>
    </main>
  );
}
