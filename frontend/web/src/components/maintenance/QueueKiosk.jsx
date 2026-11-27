import React, { useEffect, useRef } from 'react';
import './queueKiosk.css';

const TILE_COUNT = 12;
const MESSAGES = ['NOW SERVING', 'DESK PAUSED', 'BACK SOON', 'QUEUE SAVED'];
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CYCLE_MS = 3000;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const showChar = (el, ch) => {
  el.dataset.ch = ch;
  el.textContent = ch === ' ' ? ' ' : ch;
};

/**
 * Flips one split-flap tile through a few random glyphs before landing on `ch`.
 * Falls back to an instant swap when the Web Animations API is unavailable
 * (jsdom) or the user prefers reduced motion.
 */
const flipTile = (el, ch, remaining, reduced) => {
  if (!el) return;
  if (reduced || typeof el.animate !== 'function') {
    showChar(el, ch);
    return;
  }
  const next = remaining > 0 ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : ch;
  const down = el.animate(
    [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }],
    { duration: 55, easing: 'ease-in' }
  );
  down.onfinish = () => {
    showChar(el, next);
    const up = el.animate(
      [{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }],
      { duration: 55, easing: 'ease-out' }
    );
    up.onfinish = () => {
      if (remaining > 0) flipTile(el, ch, remaining - 1, reduced);
      else showChar(el, ch);
    };
  };
};

/**
 * QueueKiosk
 *
 * Decorative "now serving" kiosk shown on the maintenance screen. A split-flap
 * board cycles through queue messages while the kiosk prints a maintenance
 * ticket, tears it off and prints it again. Purely presentational: it is hidden
 * from assistive tech because the surrounding card carries the real message.
 */
export default function QueueKiosk() {
  const tileRefs = useRef([]);

  useEffect(() => {
    const reduced = prefersReducedMotion();
    const timeouts = [];
    let index = 0;

    const setMessage = (message) => {
      const padded = message.padEnd(TILE_COUNT, ' ');
      tileRefs.current.forEach((el, i) => {
        if (!el || el.dataset.ch === padded[i]) return;
        if (reduced) {
          showChar(el, padded[i]);
          return;
        }
        timeouts.push(
          setTimeout(() => flipTile(el, padded[i], 2 + Math.floor(Math.random() * 3), reduced), i * 45)
        );
      });
    };

    setMessage(MESSAGES[0]);
    const interval = reduced
      ? null
      : setInterval(() => {
          index = (index + 1) % MESSAGES.length;
          setMessage(MESSAGES[index]);
        }, CYCLE_MS);

    return () => {
      if (interval) clearInterval(interval);
      timeouts.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="flex flex-col items-center" aria-hidden="true" data-testid="queue-kiosk">
      <div className="qk-kiosk">
        <div className="qk-top">
          <span>Service Desk</span>
          <span className="qk-status">
            <span className="qk-led" />
            Maintenance
          </span>
        </div>
        <div className="qk-board">
          {Array.from({ length: TILE_COUNT }, (_, i) => (
            <span
              key={i}
              className="qk-flap"
              data-ch=" "
              ref={(el) => {
                tileRefs.current[i] = el;
              }}
            >
              {' '}
            </span>
          ))}
        </div>
        <div className="qk-meta">
          <span>
            Desk <b>Paused</b>
          </span>
          <span>
            Queue <b>Saved</b>
          </span>
        </div>
        <div className="qk-slot" />
      </div>

      <div className="qk-ticket-wrap">
        <div className="qk-ticket">
          <span className="qk-ticket-eyebrow">Maintenance notice</span>
          <span className="qk-ticket-number">SBSI-MNT</span>
          <div className="qk-ticket-row">
            <span>Your tickets</span>
            <b>Saved</b>
          </div>
          <div className="qk-ticket-row">
            <span>New tickets</span>
            <b>Paused</b>
          </div>
          <div className="qk-perf" />
          <div className="qk-barcode" />
        </div>
      </div>
    </div>
  );
}
