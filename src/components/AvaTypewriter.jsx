/**
 * AvaTypewriter — cycling typewriter animation for the homepage Ava
 * assistant card (session 9 / task 14 / CLAUDE.md §49).
 *
 * State machine, per phrase:
 *   typing  → characters appear one by one (~60ms each)
 *   holding → fully typed phrase shown for ~2500ms (give the reader time)
 *   erasing → characters removed one by one (~30ms each — faster than type)
 *   pausing → 300ms blank before the next phrase starts
 *   …then advance to next phrase and repeat indefinitely.
 *
 * Cleanup: clearTimeout on unmount. No external deps.
 *
 * Props:
 *   - phrases: string[]                   — the cycle list (required, ≥1)
 *   - onActivePhraseChange?: (s) => void  — called when a NEW phrase starts
 *                                           typing. Parent uses this to track
 *                                           the active intent for click → chat
 *                                           pre-fill.
 *
 * The blinking cursor and pulsing "thinking dots" are CSS-only (see
 * src/index.css — .ava-cursor / .ava-thinking-dots). This component
 * renders only the displayed text inside a <span>.
 */

import { useEffect, useRef, useState } from 'react';

const TYPE_MS = 60;
const ERASE_MS = 30;
const HOLD_MS = 2500;
const PAUSE_MS = 300;

export default function AvaTypewriter({ phrases, onActivePhraseChange }) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [displayed, setDisplayed] = useState('');
  const [phase, setPhase] = useState('typing');
  const timeoutRef = useRef(null);

  // Defensive: snapshot phrases length on first render. If the parent
  // mutates the phrases array on every render, the modulo math still
  // works at the current length.
  const len = Array.isArray(phrases) ? phrases.length : 0;
  const currentPhrase = len > 0 ? phrases[phraseIdx % len] : '';

  // Notify parent of the active intent whenever phraseIdx advances.
  // The parent's pre-fill handler reads activeAvaPhrase synchronously
  // on click — keeping this in sync with the phrase being TYPED (not
  // the one being erased) matches what the reader sees first.
  useEffect(() => {
    if (typeof onActivePhraseChange === 'function' && currentPhrase) {
      onActivePhraseChange(currentPhrase);
    }
    // intentionally not depending on onActivePhraseChange — parent
    // re-creates the function each render but we only want to fire
    // on phrase change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phraseIdx, currentPhrase]);

  // Drive the state machine.
  useEffect(() => {
    if (!currentPhrase) return undefined;

    const schedule = (ms, fn) => {
      timeoutRef.current = setTimeout(fn, ms);
    };

    if (phase === 'typing') {
      if (displayed.length < currentPhrase.length) {
        schedule(TYPE_MS, () => {
          setDisplayed(currentPhrase.slice(0, displayed.length + 1));
        });
      } else {
        schedule(HOLD_MS, () => setPhase('erasing'));
      }
    } else if (phase === 'erasing') {
      if (displayed.length > 0) {
        schedule(ERASE_MS, () => {
          setDisplayed(displayed.slice(0, -1));
        });
      } else {
        schedule(PAUSE_MS, () => {
          setPhraseIdx((i) => (i + 1) % Math.max(1, len));
          setPhase('typing');
        });
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [phase, displayed, currentPhrase, len]);

  // Reset when phrases prop changes identity (rare; usually stable).
  useEffect(() => {
    setPhraseIdx(0);
    setDisplayed('');
    setPhase('typing');
  }, [phrases]);

  return <span aria-live="polite">{displayed}</span>;
}
