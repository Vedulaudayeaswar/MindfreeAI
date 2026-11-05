import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SASTRA MindCare AI | Student Well-Being",
  description: "Voluntary student well-being check-ins, supportive activities, and pathways to human support at SASTRA."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
