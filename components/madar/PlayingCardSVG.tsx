'use client';

import React from 'react';
import type { Suit } from '@/lib/hokm-engine';

interface PlayingCardSVGProps {
  suit: Suit;
  rank: number; // 2..14 (11=J, 12=Q, 13=K, 14=A)
  size?: 'xs' | 'sm' | 'md' | 'lg';
  isTrump?: boolean;
  playable?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

const RANK_TEXT: Record<number, string> = {
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

const RANK_FA: Record<number, string> = {
  11: 'سرباز',
  12: 'بی‌بی',
  13: 'شاه',
  14: 'تک',
};

const SUIT_FA: Record<Suit, string> = {
  spades: 'پیک',
  hearts: 'دل',
  diamonds: 'خشت',
  clubs: 'گشنیز',
};

// Classic pip coordinate grid (x in 0..100, y in 0..140, flip for bottom half)
const PIP_LAYOUTS: Record<number, [number, number, boolean?][]> = {
  2: [[50, 32], [50, 108, true]],
  3: [[50, 30], [50, 70], [50, 110, true]],
  4: [[32, 34], [68, 34], [32, 106, true], [68, 106, true]],
  5: [[32, 34], [68, 34], [50, 70], [32, 106, true], [68, 106, true]],
  6: [[32, 32], [68, 32], [32, 70], [68, 70], [32, 108, true], [68, 108, true]],
  7: [[32, 30], [68, 30], [50, 50], [32, 70], [68, 70], [32, 110, true], [68, 110, true]],
  8: [[32, 30], [68, 30], [50, 48], [32, 70], [68, 70], [50, 92, true], [32, 110, true], [68, 110, true]],
  9: [[32, 28], [68, 28], [32, 56], [68, 56], [50, 70], [32, 84, true], [68, 84, true], [32, 112, true], [68, 112, true]],
  10: [[32, 26], [68, 26], [50, 42], [32, 58], [68, 58], [32, 82, true], [68, 82, true], [50, 98, true], [32, 114, true], [68, 114, true]],
};

function SuitGlyph({ suit, cx, cy, scale = 1, flip = false }: { suit: Suit; cx: number; cy: number; scale?: number; flip?: boolean }) {
  const color = suit === 'hearts' || suit === 'diamonds' ? '#dc2626' : '#0f172a';
  const transform = `translate(${cx}, ${cy}) scale(${scale}) ${flip ? 'rotate(180)' : ''}`;

  if (suit === 'hearts') {
    return (
      <path
        transform={transform}
        fill={color}
        d="M 0 11 C -1 9 -11 2 -11 -4.5 C -11 -9 -7.5 -11.5 -4 -11.5 C -1.5 -11.5 0 -9.5 0 -8 C 0 -9.5 1.5 -11.5 4 -11.5 C 7.5 -11.5 11 -9 11 -4.5 C 11 2 1 9 0 11 Z"
      />
    );
  }
  if (suit === 'diamonds') {
    return (
      <path
        transform={transform}
        fill={color}
        d="M 0 -12.5 L 9.5 0 L 0 12.5 L -9.5 0 Z"
      />
    );
  }
  if (suit === 'spades') {
    return (
      <g transform={transform} fill={color}>
        <path d="M 0 -12 C 1 -9.5 11 -1.5 11 4.2 C 11 8 8 10 4.5 10 C 2.2 10 0.8 8.8 0 7.5 C -0.8 8.8 -2.2 10 -4.5 10 C -8 10 -11 8 -11 4.2 C -11 -1.5 -1 -9.5 0 -12 Z" />
        <path d="M -2.2 6.5 L 2.2 6.5 L 4.4 12.5 L -4.4 12.5 Z" />
      </g>
    );
  }
  // Clubs
  return (
    <g transform={transform} fill={color}>
      <circle cx="0" cy="-6" r="4.8" />
      <circle cx="-5.5" cy="2" r="4.8" />
      <circle cx="5.5" cy="2" r="4.8" />
      <path d="M -2 2 L 2 2 L 4.5 12.2 L -4.5 12.2 Z" />
    </g>
  );
}

const SIZE_CLASSES = {
  xs: 'w-12 h-[68px]',
  sm: 'w-16 h-[92px]',
  md: 'w-[74px] h-[106px] sm:w-[86px] sm:h-[122px]',
  lg: 'w-24 h-[136px]',
};

export function PlayingCardBackSVG({ size = 'sm', className = '' }: { size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <div className={`${SIZE_CLASSES[size]} relative select-none shrink-0 ${className}`}>
      <svg viewBox="0 0 100 140" className="w-full h-full drop-shadow-[0_6px_14px_rgba(2,6,23,0.65)]">
        <defs>
          <linearGradient id="madarBackGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0f173d" />
            <stop offset="50%" stopColor="#1e124d" />
            <stop offset="100%" stopColor="#08203c" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="96" height="136" rx="9" fill="#0b1126" stroke="#38bdf8" strokeOpacity="0.45" strokeWidth="1.5" />
        <rect x="7" y="7" width="86" height="126" rx="6" fill="url(#madarBackGrad)" stroke="#f59e0b" strokeOpacity="0.55" strokeWidth="1" />
        {/* Cosmic Astrolabe Geometry */}
        <circle cx="50" cy="70" r="28" fill="none" stroke="#38bdf8" strokeOpacity="0.4" strokeWidth="1" />
        <circle cx="50" cy="70" r="18" fill="none" stroke="#f59e0b" strokeOpacity="0.65" strokeWidth="1" strokeDasharray="3 3" />
        <path d="M 50 32 L 58 62 L 84 70 L 58 78 L 50 108 L 42 78 L 16 70 L 42 62 Z" fill="#38bdf8" fillOpacity="0.16" stroke="#c084fc" strokeOpacity="0.55" strokeWidth="0.9" />
        <circle cx="50" cy="70" r="5" fill="#f59e0b" fillOpacity="0.85" />
        {/* Corner stars */}
        <circle cx="15" cy="15" r="2" fill="#38bdf8" fillOpacity="0.7" />
        <circle cx="85" cy="15" r="2" fill="#38bdf8" fillOpacity="0.7" />
        <circle cx="15" cy="125" r="2" fill="#38bdf8" fillOpacity="0.7" />
        <circle cx="85" cy="125" r="2" fill="#38bdf8" fillOpacity="0.7" />
      </svg>
    </div>
  );
}

export default function PlayingCardSVG({
  suit,
  rank,
  size = 'md',
  isTrump = false,
  playable = false,
  selected = false,
  disabled = false,
  onClick,
  className = '',
}: PlayingCardSVGProps) {
  const isRed = suit === 'hearts' || suit === 'diamonds';
  const ink = isRed ? '#dc2626' : '#0f172a';
  const rankStr = RANK_TEXT[rank] || String(rank);
  const isCourt = rank >= 11 && rank <= 13;
  const isAce = rank === 14;
  const pips = PIP_LAYOUTS[rank] || [];

  const interactiveClasses = onClick
    ? playable && !disabled
      ? 'cursor-pointer hover:-translate-y-2.5 active:scale-95 transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'
      : 'cursor-not-allowed opacity-50 grayscale-[35%]'
    : '';

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick, disabled: disabled || !playable } : {})}
      aria-label={`کارت ${RANK_FA[rank] || rank} ${SUIT_FA[suit]}`}
      className={`relative select-none shrink-0 rounded-xl ${SIZE_CLASSES[size]} ${interactiveClasses} ${
        selected ? '-translate-y-3 ring-2 ring-amber-400' : ''
      } ${className}`}
    >
      <svg
        viewBox="0 0 100 140"
        className={`w-full h-full rounded-xl ${
          playable && !disabled
            ? 'drop-shadow-[0_10px_18px_rgba(34,211,238,0.28)]'
            : 'drop-shadow-[0_6px_12px_rgba(2,6,23,0.55)]'
        }`}
      >
        <defs>
          <linearGradient id={`cardFace_${suit}_${rank}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#eef2f7" />
          </linearGradient>
        </defs>

        {/* Card Base */}
        <rect
          x="1.5"
          y="1.5"
          width="97"
          height="137"
          rx="9"
          fill={`url(#cardFace_${suit}_${rank})`}
          stroke={isTrump ? '#f59e0b' : playable ? '#38bdf8' : '#cbd5e1'}
          strokeWidth={isTrump ? '2.6' : '1.4'}
        />

        {/* Subtle Inner Filigree Frame */}
        <rect
          x="6"
          y="6"
          width="88"
          height="128"
          rx="6"
          fill="none"
          stroke={isTrump ? '#f59e0b' : '#94a3b8'}
          strokeOpacity={isTrump ? '0.45' : '0.22'}
          strokeWidth="0.8"
        />

        {/* Top-Left Corner Index */}
        <text
          x="14"
          y="23"
          textAnchor="middle"
          fontSize="15"
          fontWeight="800"
          fontFamily="ui-monospace, monospace"
          fill={ink}
        >
          {rankStr}
        </text>
        <SuitGlyph suit={suit} cx={14} cy={34} scale={0.44} />

        {/* Bottom-Right Mirrored Index */}
        <g transform="rotate(180 50 70)">
          <text
            x="14"
            y="23"
            textAnchor="middle"
            fontSize="15"
            fontWeight="800"
            fontFamily="ui-monospace, monospace"
            fill={ink}
          >
            {rankStr}
          </text>
          <SuitGlyph suit={suit} cx={14} cy={34} scale={0.44} />
        </g>

        {/* Center Art: Ace, Royal Court, or Authentic Pip Grid */}
        {isAce && (
          <g>
            <circle cx="50" cy="70" r="23" fill="none" stroke={isTrump ? '#f59e0b' : ink} strokeOpacity="0.22" strokeWidth="1.2" strokeDasharray="3 2" />
            <SuitGlyph suit={suit} cx={50} cy={70} scale={1.75} />
          </g>
        )}

        {isCourt && (
          <g>
            <rect
              x="24"
              y="26"
              width="52"
              height="88"
              rx="6"
              fill={isRed ? '#fef2f2' : '#f1f5f9'}
              stroke={isTrump ? '#f59e0b' : ink}
              strokeOpacity="0.35"
              strokeWidth="1.2"
            />
            {/* Royal Crown / Medallion */}
            <path
              d="M 35 52 L 40 40 L 50 47 L 60 40 L 65 52 Z"
              fill={rank === 13 ? '#f59e0b' : rank === 12 ? '#a855f7' : '#0284c7'}
            />
            <SuitGlyph suit={suit} cx={50} cy={73} scale={1.2} />
            <text
              x="50"
              y="104"
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill={ink}
            >
              {RANK_FA[rank]}
            </text>
          </g>
        )}

        {!isAce &&
          !isCourt &&
          pips.map(([x, y, flip], idx) => (
            <SuitGlyph key={idx} suit={suit} cx={x} cy={y} scale={0.62} flip={Boolean(flip)} />
          ))}

        {/* Gold Trump Corner Mark */}
        {isTrump && (
          <circle cx="85" cy="15" r="4" fill="#f59e0b" />
        )}
      </svg>
    </Wrapper>
  );
}
