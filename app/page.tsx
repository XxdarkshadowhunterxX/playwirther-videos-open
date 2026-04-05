// app/page.tsx — Landing page
import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-surface-bg flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-brand-accent rounded-lg flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          </div>
          <span className="font-display font-black text-xl text-text-primary">
            Playwirther
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="px-4 py-2 bg-brand-accent hover:bg-brand-accent-hover text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-brand-accent/30 bg-brand-accent/10 text-brand-accent text-xs font-medium mb-8">
          <span className="w-1.5 h-1.5 bg-brand-accent rounded-full animate-pulse-soft" />
          Beta — Free access during this period
        </div>

        <h1 className="text-5xl md:text-7xl font-display font-black text-text-primary leading-tight max-w-4xl">
          Edit videos with{" "}
          <span className="gradient-text">AI</span>{" "}
          in seconds
        </h1>

        <p className="mt-6 text-lg text-text-secondary max-w-2xl leading-relaxed">
          Upload your video and get automatic captions, silence removal,
          B-roll, hook titles and more — powered by AI.
          No editing skills required.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
          <Link
            href="/login"
            className="px-8 py-4 bg-brand-accent hover:bg-brand-accent-hover text-white font-bold rounded-xl transition-all hover:scale-105 hover:shadow-lg hover:shadow-brand-accent/25 text-base"
          >
            Start editing for free
          </Link>
          <span className="text-sm text-text-muted">
            No credit card required
          </span>
        </div>
      </section>

      {/* Features */}
      <section className="px-8 py-20 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto w-full">
        {[
          {
            icon: "✨",
            title: "AI Captions",
            desc: "Word-by-word captions with 98%+ accuracy in Portuguese and 100+ languages.",
          },
          {
            icon: "✂️",
            title: "Silence Removal",
            desc: "Auto-remove silences and bad takes in 3 speed modes.",
          },
          {
            icon: "🎬",
            title: "AI B-Roll",
            desc: "AI searches and inserts contextual B-roll from Pexels automatically.",
          },
        ].map((f) => (
          <div
            key={f.title}
            className="p-6 rounded-2xl border border-border-subtle bg-surface-card hover:border-border-default transition-colors"
          >
            <span className="text-3xl">{f.icon}</span>
            <h3 className="mt-4 font-semibold text-text-primary">{f.title}</h3>
            <p className="mt-2 text-sm text-text-secondary">{f.desc}</p>
          </div>
        ))}
      </section>

      <footer className="text-center py-8 text-xs text-text-muted border-t border-border-subtle">
        © 2026 Playwirther. All rights reserved.
      </footer>
    </main>
  );
}
