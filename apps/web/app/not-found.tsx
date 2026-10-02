import Link from "next/link";

export default function NotFound(): React.ReactElement {
  return (
    <main className="page" style={{ maxWidth: 560 }}>
      <div className="scard" style={{ marginTop: 48 }}>
        <div className="eyebrow">Page not found</div>
        <h1 className="home-title" style={{ marginTop: 6 }}>This page does not exist</h1>
        <p className="home-sub" style={{ marginTop: 8 }}>
          The link may be old, or the lab it pointed to was destroyed. Pick one of these instead.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <Link href="/" className="btn primary">Go to Home</Link>
          <Link href="/labs" className="btn">Your labs</Link>
          <Link href="/templates" className="btn">Templates</Link>
        </div>
      </div>
    </main>
  );
}
