import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpsPilot: AI operations inbox",
  description: "An AI agent that triages, drafts and routes small-business operations work, with a human in the loop.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <nav className="flex items-center gap-6 border-b bg-white px-6 py-3">
          <Link href="/" className="font-semibold text-indigo-700">
            OpsPilot
          </Link>
          <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">
            Board
          </Link>
          <Link href="/customers" className="text-sm text-slate-600 hover:text-slate-900">
            Customers
          </Link>
          <Link href="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">
            Dashboard
          </Link>
          <span className="ml-auto text-xs text-slate-400">Demo · synthetic data</span>
        </nav>
        {children}
      </body>
    </html>
  );
}
