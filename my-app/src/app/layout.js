import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from '../../providers'; // Da root (my-app/providers.js)

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://poorlydrawnbinders.vercel.app';
const miniAppEmbed = {
  version: '1',
  imageUrl: `${appUrl}/miniapp-embed.png`,
  button: {
    title: 'Open Poorly Drawn Binders',
    action: {
      type: 'launch_miniapp',
      name: 'Poorly Drawn Binders',
      url: appUrl,
      splashImageUrl: `${appUrl}/miniapp-splash.png`,
      splashBackgroundColor: '#000000',
    },
  },
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  metadataBase: new URL(appUrl),
  title: "Poorly Drawn Binders",
  description: "List and buy liquid trading cards.",
  other: {
    "fc:miniapp": JSON.stringify(miniAppEmbed),
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
