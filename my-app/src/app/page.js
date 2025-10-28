'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAccount, useSignTypedData, useConnect } from 'wagmi';
import { base } from 'wagmi/chains';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { getDefaultWallets } from '@rainbow-me/rainbowkit';
import { WalletConnectModal } from '@walletconnect/modal';
import { CoinbaseWalletSDK } from '@coinbase/wallet-sdk';

export const dynamic = 'force-dynamic'; // No prerender

export default function Home() {
  const router = useRouter();
  const { address, isConnected, isConnecting } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { connectAsync } = useConnect();
  const [error, setError] = useState(null);
  const [hasSigned, setHasSigned] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [walletOptions, setWalletOptions] = useState([]);

  // FIX: getDefaultWallets client-side
  useEffect(() => {
    const projectId = '8e4f39df88b73f8ff1e701f88b4fea0c';
    const { connectors } = getDefaultWallets({
      appName: 'Vibe.Market',
      projectId,
      chains: [base],
    });

    // Inizializza SDK per QR popup
    const coinbaseSDK = new CoinbaseWalletSDK({
      appName: 'Vibe.Market',
      appLogoUrl: 'https://your-logo.com/logo.png', // Opzionale
      darkMode: false,
    });

    const options = [
      {
        id: 'phantom',
        name: 'Phantom',
        icon: 'https://raw.githubusercontent.com/solana-labs/phantom-wallet-assets/main/assets/images/phantom-logo-icon.png',
        connector: connectors.find(c => c.id === 'phantom'),
        link: 'https://phantom.app/download',
      },
      {
        id: 'rainbow',
        name: 'Rainbow',
        icon: 'https://raw.githubusercontent.com/rainbow-me/rainbowkit/master/packages/assets/src/logos/rainbow.png',
        connector: connectors.find(c => c.id === 'rainbow'),
        link: 'rainbow://connect?uri=wc%3A...', // Deep-link QR Rainbow
      },
      {
        id: 'metamask',
        name: 'MetaMask',
        icon: 'https://raw.githubusercontent.com/MetaMask/metamask-extension/master/images/icon-128x128.png',
        connector: connectors.find(c => c.id === 'io.metamask'),
        link: 'https://metamask.io/download/',
      },
      {
        id: 'coinbase',
        name: 'Coinbase Wallet',
        icon: 'https://seeklogo.com/images/C/coinbase-wallet-logo-F0B7A2A20E-seeklogo.com.png',
        sdk: coinbaseSDK, // SDK per QR popup Coinbase
        link: 'https://www.coinbase.com/wallet',
      },
      {
        id: 'walletconnect',
        name: 'WalletConnect',
        icon: 'https://walletconnect.com/_next/static/media/walletconnect-logo.8f9f2e4f.svg',
        modal: WalletConnectModal, // Modal per QR WC popup
        link: 'https://walletconnect.com/',
      },
    ];

    setWalletOptions(options);
  }, []);

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
        setError('Unlock MetaMask (enter password) before signing.');
      } else {
        setError('Error signing: ' + err.message);
      }
      setHasSigned(true);
    }
  };

  // Handler click wallet (manual detection per popup estensione, QR popup per non-installed)
  const handleWalletClick = async (wallet) => {
    try {
      // Manual detection for installed (apre popup estensione)
      if (wallet.id === 'metamask' && window.ethereum) {
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        setShowModal(false);
        return;
      }
      if (wallet.id === 'phantom' && window.solana) {
        await window.solana.connect();
        setShowModal(false);
        return;
      }
      if (wallet.connector) {
        // Fallback Wagmi for other connectors
        const provider = await wallet.connector.getProvider();
        if (provider) {
          await connectAsync({ connector: wallet.connector, chainId: base.id });
          setShowModal(false);
          return;
        }
      }
      // QR popup specifico per non-installed
      if (wallet.modal) {
        // WalletConnect QR popup
        const wcModal = new wallet.modal({ projectId: '8e4f39df88b73f8ff1e701f88b4fea0c' });
        await wcModal.openModal();
        wcModal.subscribeEvents();
        wcModal.on('modal_close', () => wcModal.closeModal());
        setShowModal(false);
      } else if (wallet.sdk) {
        // Coinbase QR popup
        const coinbaseProvider = wallet.sdk.makeWeb3Provider('https://base-mainnet.public.blastapi.io', 1);
        await coinbaseProvider.enable(); // Apre QR popup Coinbase
        setShowModal(false);
      } else if (wallet.link) {
        // Rainbow deep-link QR o fallback download
        window.open(wallet.link, '_blank');
        setShowModal(false);
      }
    } catch (err) {
      console.error('Connection error:', err); // Log per debug
      setError('Connection error: ' + err.message);
      if (wallet.link) window.open(wallet.link, '_blank'); // Fallback redirect
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
                      Connecting...
                    </button>
                  );
                }

                if (!connected) {
                  return (
                    <div className="flex flex-col items-center space-y-2">
                      <button
                        onClick={() => setShowModal(true)}
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

      {/* Custom Modal centrato (gradevole, griglia, QR popup) */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl border border-gray-200">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Connect a Wallet</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">
                &times;
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-6">Select a wallet to connect to Vibe.Market</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {walletOptions.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={() => handleWalletClick(wallet)}
                  className="flex flex-col items-center space-y-2 p-4 rounded-lg border border-gray-200 hover:border-emerald-500 hover:bg-emerald-50 transition-all group"
                >
                  <img
                    src={wallet.icon}
                    alt={wallet.name}
                    onError={(e) => { e.target.style.display = 'none'; }} // FIX: Placeholder se fallisce (nascondi, o aggiungi SVG inline)
                    className="w-10 h-10 object-contain rounded-lg group-hover:scale-110 transition-transform"
                  />
                  <span className="text-sm font-medium text-gray-900">{wallet.name}</span>
                  {!wallet.connector && <span className="text-xs text-gray-500">Get app</span>}
                </button>
              ))}
            </div>
            <div className="text-center">
              <a
                href="https://ethereum.org/en/wallets/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-emerald-600 hover:underline"
              >
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
