import { Suspense } from 'react';
import InventoryContent from './InventoryContent.jsx'; // Aggiunta .jsx per fix resolve

export const dynamic = 'force-dynamic'; // Forza dynamic: no prerendering, fix ReferenceError

export default function Inventory() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen flex-col items-center p-24">
        <h1 className="text-4xl font-bold mb-8">My Inventory on Vibe.Market</h1>
        <p>Loading...</p>
      </main>
    }>
      <InventoryContent />
    </Suspense>
  );
}
