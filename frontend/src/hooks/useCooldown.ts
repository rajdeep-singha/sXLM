import { useEffect, useState } from 'react';
import { describeLedgers, readCooldownLedgers } from '../lib/stellarNetwork';

/**
 * The vault's withdrawal cooldown in words, read from the contract. Null
 * until loaded or if the read fails, so the UI never shows a made-up figure.
 */
export function useCooldown(): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    readCooldownLedgers()
      .then((ledgers) => live && setText(describeLedgers(ledgers)))
      .catch(() => live && setText(null));
    return () => {
      live = false;
    };
  }, []);
  return text;
}
