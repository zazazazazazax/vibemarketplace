'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSignTypedData } from 'wagmi';
import { base } from 'wagmi/chains';

export function useWalletSignature(address) {
  const [hasSigned, setHasSigned] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false); // Flag per evitare re-trigger

  const { signTypedDataAsync } = useSignTypedData();

  const handleSignature = useCallback(async () => {
    if (!address) return;

    setIsSigning(true);
    setError(null);

    try {
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
        primaryType: 'Message',
      });

      localStorage.setItem('walletAddress', address.toLowerCase()); // Salva sempre lowercase
      localStorage.setItem('walletSignature', signature);
      localStorage.setItem('walletNonce', nonce.toString());
      localStorage.setItem('walletTimestamp', Date.now().toString());
      localStorage.setItem('walletInitialized', 'true');  // Persist flag

      setHasSigned(true);
      setIsInitialized(true); // Flag post-sign
      setIsSigning(false);
    } catch (err) {
      setIsSigning(false);  // Fix: Force reset on ANY error/pending (no hang)
      if (err.message.includes('User rejected') || err.message.includes('password') || err.message.includes('already pending')) {
        setError('Signature pending or rejected – try again.');  // Handle "already pending"
      } else {
        setError('Error signing: ' + err.message);
      }
      setHasSigned(true); // Skip further prompts even on error
      setIsInitialized(true); // Flag anche su error per bloccare spam
      localStorage.setItem('walletInitialized', 'true');  // Persist anche su error
    }
  }, [address, signTypedDataAsync]);

  const resetSignature = useCallback(() => {
    setHasSigned(false);
    setError(null);
    setIsInitialized(false);
    setIsSigning(false);  // Fix: Reset isSigning too
    localStorage.removeItem('walletInitialized');  // Reset flag
    localStorage.removeItem('walletAddress');
    localStorage.removeItem('walletSignature');
    localStorage.removeItem('walletNonce');
    localStorage.removeItem('walletTimestamp');
  }, []);

  // Unico useEffect: check + verify + trigger (sequenziale, no race)
  useEffect(() => {
    if (!address) return;

    const storedInitialized = localStorage.getItem('walletInitialized');
    const ts = localStorage.getItem('walletTimestamp');
    const storedAddress = localStorage.getItem('walletAddress')?.toLowerCase(); // Case-insensitive
    const isValidTimestamp = ts && Date.now() - parseInt(ts) < 24 * 60 * 60 * 1000;
    const addressMatch = storedAddress === address.toLowerCase(); // Case-insensitive

    if (storedInitialized === 'true' && isValidTimestamp && addressMatch) {
      setHasSigned(true);
      setIsInitialized(true);
    } else {
      setHasSigned(false);
      // Fix Stuck / Pending: Delay 3s per WC return lag
      const timer = setTimeout(() => {
        handleSignature();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [address, handleSignature]); // No isInitialized dependency (check storage diretto)

  // Safety Net: Force reset isSigning after 10s if stuck (WC lag)
  useEffect(() => {
    if (isSigning) {
      const safetyTimer = setTimeout(() => {
        setIsSigning(false);
      }, 10000);
      return () => clearTimeout(safetyTimer);
    }
  }, [isSigning]);

  return { hasSigned, isSigning, error, handleSignature, resetSignature };
}