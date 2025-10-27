'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAccount, useSignTypedData, useConnect } from 'wagmi'; // Aggiunto useConnect per custom
import { base } from 'wagmi/chains';
import { ConnectButton } from '@rainbow-me/rainbowkit'; // Mantieni per logica base, ma custom per UI
import { getDefaultWallets } from '@rainbow-me/rainbowkit'; // Per icone/connectors
import { configureChains } from 'wagmi';
import { publicProvider } from 'wagmi/providers/public'; // Per chains

export const dynamic = 'force-dynamic'; // No prerender

// Config chains/connectors (da providers, ma qui per custom)
const { chains } = configureChains([base], [publicProvider()]);
const projectId = '8e4f39df88b73f8ff1e701f88b4fea0c';
const { connectors } = getDefaultWallets({
  appName: 'Vibe.Market',
  projectId,
  chains,
});

// Mappa wallet per custom UI (icona, nome, link se non installed)
const walletOptions = [
  { id: 'phantom', name: 'Phantom', icon: 'https://avatars.githubusercontent.com/u/72074320?s=200&v=4', installed: true, connect: connectors.find(c => c.id === 'phantom')?.connect },
  { id: 'rainbow', name: 'Rainbow', icon: 'https://avatars.githubusercontent.com/u/72074320?s=200&v=4', installed: false, qr: true }, // Esempio QR
  { id: 'metaMask', name: 'MetaMask', icon: 'https://avatars.githubusercontent.com/u/11744531?s=200&v=4', installed: window.ethereum, link: 'https://metamask.io/download/' },
  { id: 'coinbase', name: 'Coinbase Wallet', icon: 'https://avatars.githubusercontent.com/u/1386422?s=200&v=4', installed: false, link: 'https://www.coinbase.com/wallet' },
  { id: 'walletConnect', name: 'WalletConnect', icon: 'https://avatars.githubusercontent.com/u/11744531?s=200&v=4', installed: false, qr: true },
  // Aggiungi altri se vuoi (es. Argent, Ledger)
];

export default function Home() {
  const router = useRouter();
  const { address, isConnected, isConnecting } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { connectAsync } = useConnect(); // Per custom connect
  const [error, setError] = useState(null);
  const [hasSigned, setHasSigned] = useState(false);
  const [showModal, setShowModal] = useState(false); // State per custom modal

  useEffect(() => {
    if (isConnected && address && !hasSigned) {
      handleSignatureAndRedirect();
    }
  }, [isConnected, address, hasSigned]);

  const handleSignatureAndRedirect = async () => {
    if (!address) return;

    try {
      setError(null);
      const domain = {
        name: 'Vibe.Marketplace',
        version: '1',
        chainId: base.id,
        verifyingContract: '0x0000000000000000000000000000000000000000'
      };
      const types = {
        Message: [
          { name: 'content', type: 'string' },
          { name: 'nonce', type: 'uint256' }
        ]
      };
      const nonce = Math.floor(Date.now() / 1000 / 3600);
      const message = {
        content: 'Sign to persist your Vibe.Marketplace session for 24 hours.',
        nonce: nonce
      };

      const signature = await signTypedDataAsync({ 
        domain, 
        types, 
        message, 
        primaryType: 'Message' 
      });

      localStorage.setItem('walletAddress', address);
      localStorage.setItem('walletSignature', signature);
      localStorage.setItem('walletNonce', nonce.toString());
      localStorage.setItem('walletTimestamp', Date.now().toString());

      setHasSigned(true);
      setTimeout(() => router.push('/inventory'), 500);
    } catch (err) {
      if (err.message.includes('User rejected') || err.message.includes('password')) {
        setError('Sblocca MetaMask (inserisci password) prima di firmare.');
      } else {
        setError('Error signing: ' + err.message);
      }
      setHasSigned(true);
    }
  };

  // Handler custom per wallet click
  const handleWalletClick = async (wallet) => {
    if (wallet.connect) {
      try {
        await wallet.connect();
        setShowModal(false);
      } catch (err) {
        setError('Errore connessione: ' + err.message);
      }
    } else if (wallet.qr) {
      // Apri QR per WalletConnect/Rainbow
      window.open('https://walletconnect.com/', '_blank');
    } else if (wallet.link) {
      // Redirect a download
      window.open(wallet.link, '_blank');
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <h1 className="text-4xl font-bold mb-8">Home Page</h1>
      <ConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openChainModal,
          openConnectModal,
          mounted,
        }) => {
          const ready = mounted;
          const connected = ready && account && chain;

          return (
            <div
              className={`
                ${ready ? 'opacity-100' : 'opacity-0'}
                flex flex-col items-center justify-center space-y-2
              `}
            >
              {(() => {
                if (isConnecting) {
                  return (
                    <button
                      disabled
                      className="bg-blue-500 text-white px-6 py-3 rounded-lg inline-flex items-center space-x-2"
                    >
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Connessione in corso...
                    </button>
                  );
                }

                if (!connected) {
                  return (
                    <div className="flex flex-col items-center space-y-2">
                      <button
                        onClick={() => setShowModal(true)} // FIX: Trigger custom modal invece di default
                        type="button"
                        className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors"
                      >
                        Connect Wallet
                      </button>
                      <a
                        href="https://ethereum.org/en/wallets/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-gray-500 hover:text-gray-700"
                      >
                        What is a wallet?
                      </a>
                    </div>
                  );
                }

                if (chain.unsupported) {
                  return (
                    <button onClick={openChainModal} type="button" className="text-red-500">
                      Switch to Base
                    </button>
                  );
                }

                return (
                  <div className="flex flex-col items-center space-y-2">
                    <button
                      onClick={openChainModal}
                      type="button"
                      className="text-sm text-gray-500"
                    >
                      {chain.name}
                    </button>
                    <button
                      onClick={openAccountModal}
                      type="button"
                      className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600"
                    >
                      {account.displayName || `${address.slice(0, 6)}...${address.slice(-4)}`}
                    </button>
                  </div>
                );
              })()}
            </div>
          );
        }}
      </ConnectButton.Custom>

      {/* FIX: Custom Modal centrato con griglia 4xN */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[80vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Connect a Wallet</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-700">
                ×
              </button>
            </div>
            <div className="text-sm text-gray-600 mb-4">
              Select a wallet to connect to Vibe.Market
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4"> {/* FIX: Griglia 2 su mobile, 4 su desktop */}
              {walletOptions.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={() => handleWalletClick(wallet)}
                  className="flex flex-col items-center space-y-2 p-3 rounded-lg border border-gray-200 hover:border-blue-500 transition-colors text-left"
                >
                  <img
                    src={wallet.icon}
                    alt={wallet.name}
                    className="w-10 h-10 object-contain" // FIX: 40px fissa, contain per no schiacciamento
                  />
                  <span className="text-sm font-medium">{wallet.name}</span>
                  {!wallet.installed && <span className="text-xs text-gray-500">Install</span>}
                </button>
              ))}
            </div>
            <div className="mt-4 text-center">
              <a href="https://ethereum.org/en/wallets/" target="_blank" rel="noopener noreferrer" className="text-sm text-blue-500 hover:underline">
                New to Ethereum wallets? Learn more
              </a>
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-red-500 mt-4">{error}</p>}
      {isConnected && !hasSigned && <p className="text-green-500 mt-4">Signing session...</p>}
      {isConnected && hasSigned && <p className="text-green-500 mt-4">Connected: {address?.slice(0, 6)}...{address?.slice(-4)}</p>}
    </main>
  );
}
