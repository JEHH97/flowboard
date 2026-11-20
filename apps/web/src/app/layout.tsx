import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Flowboard — clear work, together",
  description: "A realtime collaborative board for focused teams.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
