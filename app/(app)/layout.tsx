// app/(app)/layout.tsx — App layout with navbar
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/lib/auth";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-50 glass border-b border-border-subtle px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 bg-brand-accent rounded-lg flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            </div>
            <span className="font-display font-black text-base text-text-primary">
              Playwirther
            </span>
          </Link>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/dashboard"
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded-lg transition-colors"
            >
              Projects
            </Link>
            <Link
              href="/media"
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded-lg transition-colors"
            >
              Media
            </Link>
            <Link
              href="/magic-clips"
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded-lg transition-colors"
            >
              Magic Clips
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* Credits badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-elevated text-xs text-text-secondary">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-brand-accent">
              <circle cx="12" cy="12" r="10" />
            </svg>
            Beta
          </div>

          {/* User avatar */}
          <div className="relative group">
            <button className="flex items-center gap-2 p-1 rounded-full hover:bg-surface-elevated transition-colors">
              {session.user?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt={session.user.name ?? "User"}
                  className="w-8 h-8 rounded-full"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-brand-accent flex items-center justify-center text-white text-sm font-bold">
                  {session.user?.name?.[0] ?? "U"}
                </div>
              )}
            </button>

            {/* Dropdown */}
            <div className="absolute right-0 mt-1 w-48 hidden group-focus-within:block glass rounded-xl p-1 shadow-xl">
              <div className="px-3 py-2 border-b border-border-subtle mb-1">
                <p className="text-sm font-medium text-text-primary truncate">
                  {session.user?.name}
                </p>
                <p className="text-xs text-text-muted truncate">
                  {session.user?.email}
                </p>
              </div>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button
                  type="submit"
                  className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded-lg transition-colors"
                >
                  Sair
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
