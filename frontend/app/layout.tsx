import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProviders } from "../components/AppProviders";
import { Navbar } from "../components/Navbar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DUM Club — Launch AI Projects on Solana",
  description:
    "Describe an idea, launch it on-chain. AI generates the project, token, and live market instantly.",
  openGraph: {
    title: "DUM Club — Launch AI Projects on Solana",
    description:
      "Describe an idea, launch it on-chain. AI generates the project, token, and live market instantly.",
    siteName: "DUM Club",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DUM Club — Launch AI Projects on Solana",
    description:
      "Describe an idea, launch it on-chain. AI generates the project, token, and live market instantly.",
  },
};

const commitSha = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || "";
const isPreview = process.env.VERCEL_ENV === "preview";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-zinc-950 text-white min-h-screen`}>
        <AppProviders>
          <Navbar />
          {children}
          {/* Deploy indicator — low-visibility, bottom-right */}
          {commitSha && (
            <div
              className="fixed bottom-2 right-2 z-[9999] flex items-center gap-1.5 rounded-md bg-zinc-950/80 px-2 py-1 font-mono text-[9px] text-zinc-700 backdrop-blur-sm"
              title={`Deploy: ${commitSha}${isPreview ? " (preview)" : ""}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${isPreview ? "bg-amber-500" : "bg-emerald-500/60"}`} />
              {commitSha.slice(0, 7)}
              {isPreview && <span className="text-amber-500">preview</span>}
            </div>
          )}
        </AppProviders>
      </body>
    </html>
  );
}
