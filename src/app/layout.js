import { Plus_Jakarta_Sans, Playfair_Display } from "next/font/google";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const serif = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
});

export const metadata = {
  title: "Desainer Itqan | AI Quality Control",
  description: "Aplikasi web bertenaga AI untuk memastikan kesesuaian gambar desain dengan brief yang diberikan.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
