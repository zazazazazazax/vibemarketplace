import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'Vibe.Market',
  projectId: '8e4f39df88b73f8ff1e701f88b4fea0c',
  chains: [base],
  ssr: true, // Obbligatorio per Next.js SSR
});
