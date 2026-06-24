import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata = {
  title: "Desainer Itqan | AI Quality Control",
  description: "Aplikasi web bertenaga AI untuk memastikan kesesuaian gambar desain dengan brief yang diberikan.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id" className={`${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
