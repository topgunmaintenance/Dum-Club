import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Topgun AI — AI Maintenance Intelligence for Aviation",
  description:
    "Search aircraft manuals, maintenance records, and parts data in one place. Source-cited answers for faster troubleshooting.",
  applicationName: "Topgun AI",
  authors: [{ name: "Topgun AI" }],
};

export const viewport: Viewport = {
  themeColor: "#07090d",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gunmetal-950 text-ink-100 antialiased">
        {children}
      </body>
    </html>
  );
}
