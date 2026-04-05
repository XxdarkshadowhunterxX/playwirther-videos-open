// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Playwirther — AI Video Editor",
    template: "%s | Playwirther",
  },
  description:
    "Edit your videos with AI. Automatic captions, silence removal, B-roll, and more in seconds.",
  keywords: ["video editor", "AI captions", "subtitles", "b-roll", "video editing"],
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: process.env.NEXT_PUBLIC_APP_URL,
    title: "Playwirther — AI Video Editor",
    description: "Edit your videos with AI in seconds.",
    siteName: "Playwirther",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="bg-surface-bg text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
