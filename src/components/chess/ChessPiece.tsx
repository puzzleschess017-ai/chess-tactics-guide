import React from 'react';
import { Color, PieceSymbol } from 'chess.js';
import { PieceSet } from '../../types/chess';

export interface PieceSetMeta {
  id: PieceSet;
  name: string;
  description: string;
}

export const PIECE_SETS: PieceSetMeta[] = [
  {
    id: 'merida',
    name: 'Merida',
    description: 'Traditional tournament vectors',
  },
  {
    id: 'classic',
    name: 'Classic',
    description: 'Timeless Staunton silhouettes',
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'Clean geometric contours',
  },
  {
    id: 'minimalist',
    name: 'Minimalist',
    description: 'Sleek Bauhaus-inspired shapes',
  },
  {
    id: 'elegant',
    name: 'Elegant',
    description: 'Ivory & obsidian gold trim',
  },
  {
    id: 'alpha',
    name: 'Bold Alpha',
    description: 'High-contrast speed silhouettes',
  },
];

interface ChessPieceProps {
  type: PieceSymbol;
  color: Color;
  pieceSet?: PieceSet;
  className?: string;
  lightContrastForDarkBg?: boolean;
}

/**
 * Renders the selected chess piece set (Merida SVG files or custom geometric/tournament SVG sets).
 */
export const ChessPiece: React.FC<ChessPieceProps> = ({
  type,
  color,
  pieceSet = 'merida',
  className = 'w-full h-full',
  lightContrastForDarkBg = false,
}) => {
  const isWhite = color === 'w';
  const useLightBlackContrast = lightContrastForDarkBg && !isWhite;

  if (pieceSet === 'merida') {
    const src = `/pieces/merida/${color}${type.toUpperCase()}.svg`;
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        style={
          useLightBlackContrast
            ? {
                filter:
                  'invert(0.88) contrast(1.1) brightness(1.06) drop-shadow(0 0 1.25px rgba(241, 245, 249, 0.55))',
              }
            : undefined
        }
        className={`${className} object-contain pointer-events-none select-none`}
      />
    );
  }

  const svgContrastStyle = useLightBlackContrast
    ? { filter: 'drop-shadow(0 0 1.2px rgba(241, 245, 249, 0.45))' }
    : undefined;

  if (pieceSet === 'modern') {
    const fill = isWhite ? '#f8fafc' : useLightBlackContrast ? '#dde5f0' : '#1e293b';
    const stroke = isWhite ? '#0f172a' : useLightBlackContrast ? '#0f172a' : '#020617';
    const detail = isWhite ? '#475569' : useLightBlackContrast ? '#334155' : '#94a3b8';

    switch (type) {
      case 'p':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <circle cx="22.5" cy="13.5" r="5" fill={fill} stroke={stroke} strokeWidth="1.8" />
            <path
              d="M17 20.5h11l3 11.5H14l3-11.5z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <rect x="11.5" y="33.5" width="22" height="5" rx="2.5" fill={fill} stroke={stroke} strokeWidth="1.8" />
          </svg>
        );
      case 'r':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M11 9h4.5v3.5h4.5V9h5v3.5h4.5V9H34v7.5l-3 3v12l2.5 3v4H11.5v-4l2.5-3v-12l-3-3V9z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M14.5 19.5h16M14.5 31.5h16" stroke={detail} strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        );
      case 'n':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M13 38.5h20v-4.5l-2.5-3c.4-9.5-2.8-18-10.5-21.5L18.5 7l-3 3.5C11.5 13 8.5 18 8 22.5c-.2 2.2 1.6 3.5 3.8 3.2l5.7-1.7c.8 2.8-2.2 5.4-4.5 7v7.5z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <circle cx="15.5" cy="16" r="1.3" fill={detail} />
          </svg>
        );
      case 'b':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <circle cx="22.5" cy="7.5" r="2.3" fill={fill} stroke={stroke} strokeWidth="1.6" />
            <path
              d="M22.5 10.5c-6.5 4.5-8.5 11.5-5.5 17.5l-3.5 4.5v5h18v-5L28 28c3-6 1-13-5.5-17.5z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M18.5 22.5l8-7.5M22.5 25v-6" stroke={detail} strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        );
      case 'q':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <circle cx="7.5" cy="13" r="2.2" fill={fill} stroke={stroke} strokeWidth="1.5" />
            <circle cx="15" cy="9.5" r="2.2" fill={fill} stroke={stroke} strokeWidth="1.5" />
            <circle cx="22.5" cy="8" r="2.4" fill={fill} stroke={stroke} strokeWidth="1.5" />
            <circle cx="30" cy="9.5" r="2.2" fill={fill} stroke={stroke} strokeWidth="1.5" />
            <circle cx="37.5" cy="13" r="2.2" fill={fill} stroke={stroke} strokeWidth="1.5" />
            <path
              d="M9 16l6.5 9.5L16.5 12l6 12.5 6-12.5 1 13.5L36 16l-3 15.5 2 3.5v3.5H10V35l2-3.5L9 16z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.75"
              strokeLinejoin="round"
            />
            <path d="M13 33.5h19" stroke={detail} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        );
      case 'k':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path d="M22.5 5.5v6.5M19.5 8.5h6" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
            {!isWhite && <path d="M22.5 5.5v6.5M19.5 8.5h6" stroke={detail} strokeWidth="1.1" strokeLinecap="round" />}
            <path
              d="M12.5 38.5h20v-4l-2-3.5c5.5-3.5 7-10.5 3.5-14.5-3.2-3.5-8.2-2.2-11.5 2.5-3.3-4.7-8.3-6-11.5-2.5-3.5 4-2 11 3.5 14.5l-2 3.5v4z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M14.5 33h16" stroke={detail} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        );
    }
  }

  if (pieceSet === 'minimalist') {
    const fill = isWhite ? '#ffffff' : useLightBlackContrast ? '#e2e8f0' : '#111827';
    const stroke = isWhite ? '#111827' : useLightBlackContrast ? '#0f172a' : '#030712';
    const accent = isWhite ? '#334155' : useLightBlackContrast ? '#334155' : '#e2e8f0';

    switch (type) {
      case 'p':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <circle cx="22.5" cy="14" r="5.5" fill={fill} stroke={stroke} strokeWidth="2" />
            <path
              d="M14 37.5c0-6.5 3.5-11.5 8.5-11.5s8.5 5 8.5 11.5H14z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'r':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M12 10h5v4h3.5v-4h4v4H28v-4h5v8h-3v14h2.5v5.5h-20V32H15V18h-3v-8z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'n':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M13 37.5h20v-4c0-11-4.5-19-12-23.5L18 7l-2.5 4.5-6.5 8.5 2.5 4 7.5-2.5c.8 3.8-2 7-6 9.5v6.5z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="16" cy="16.5" r="1.4" fill={accent} />
          </svg>
        );
      case 'b':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M22.5 8l8.5 11.5c1.8 2.5 1 6.5-2 9l2.5 4v5h-18v-5l2.5-4c-3-2.5-3.8-6.5-2-9L22.5 8z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M19 21.5l7-6.5" stroke={accent} strokeWidth="2" strokeLinecap="round" />
          </svg>
        );
      case 'q':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M8.5 14l7.5 10.5L22.5 9l6.5 15.5L36.5 14l-3.5 18.5v5H12v-5L8.5 14z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="22.5" cy="27.5" r="2.2" fill={accent} />
          </svg>
        );
      case 'k':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path d="M22.5 6.5v7M19 10h7" stroke={isWhite ? '#111827' : '#e2e8f0'} strokeWidth="2.4" strokeLinecap="round" />
            <path
              d="M12.5 37.5h20v-5l2.5-8.5c1.2-4-2-8-6.5-7.5-2.8.3-4.8 2-6 4.2-1.2-2.2-3.2-3.9-6-4.2-4.5-.5-7.7 3.5-6.5 7.5l2.5 8.5v5z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        );
    }
  }

  if (pieceSet === 'elegant') {
    const fill = isWhite ? '#fdf6e3' : useLightBlackContrast ? '#dde5f0' : '#18181b';
    const stroke = isWhite ? '#45321e' : useLightBlackContrast ? '#1e293b' : '#09090b';
    const trim = isWhite ? '#a16207' : useLightBlackContrast ? '#f59e0b' : '#eab308';

    switch (type) {
      case 'p':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M22.5 9.5a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zm-4 9.5c-2.2 2-2.2 5-.4 7-3.4 1.6-6.1 5.8-6.1 12h21c0-6.2-2.7-10.4-6.1-12 1.8-2 1.8-5-.4-7h-8z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.65"
              strokeLinejoin="round"
            />
            <path d="M16 34.5h13" stroke={trim} strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        );
      case 'r':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M11.5 9.5h4v2.5h4.5V9.5h5V12h4.5V9.5h4v6l-2.5 2.5v12.5l3 3V38h-23v-4.5l3-3V18l-2.5-2.5v-6z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.65"
              strokeLinejoin="round"
            />
            <path d="M14 17.5h17M14 30.5h17M12.5 34.5h20" stroke={trim} strokeWidth="1.25" strokeLinecap="round" />
          </svg>
        );
      case 'n':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M13 38h20v-4l-1.5-2.5c.8-11-3-19-11.5-22l-2-3-2.5 3.5c-4 2.5-7 7.5-7.5 11.5-.2 2 1 3.2 3.2 2.8 1.8-.3 4-1.2 5.8-2.2.8 3-2 6.2-4 8.5V38z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.65"
              strokeLinejoin="round"
            />
            <circle cx="15.2" cy="15.5" r="1.2" fill={trim} />
            <path d="M24 12.5c5.5 2.5 8 8.5 8 20" fill="none" stroke={trim} strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        );
      case 'b':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <circle cx="22.5" cy="7.5" r="2.2" fill={trim} stroke={stroke} strokeWidth="1.3" />
            <path
              d="M22.5 10.5c-7 4-8.5 12-4.8 17.5-1.5 1.8-2.2 3.5-2.2 5l-3.5 3v2h21v-2l-3.5-3c0-1.5-.7-3.2-2.2-5 3.7-5.5 2.2-13.5-4.8-17.5z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.65"
              strokeLinejoin="round"
            />
            <path d="M18.5 23l8-8M22.5 24.5V17M16 32.5h13" stroke={trim} strokeWidth="1.35" strokeLinecap="round" />
          </svg>
        );
      case 'q':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            {[7.5, 14.5, 22.5, 30.5, 37.5].map((cx, i) => (
              <circle
                key={cx}
                cx={cx}
                cy={i === 2 ? 7.5 : i === 1 || i === 3 ? 9 : 12}
                r="2.1"
                fill={trim}
                stroke={stroke}
                strokeWidth="1.2"
              />
            ))}
            <path
              d="M9 14.5l6.5 10.5L16 11l6.5 13.5L29 11l.5 14L36 14.5 32.5 31l1.5 3.5V38H11v-3.5l1.5-3.5L9 14.5z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M12.5 32.5h20M12 35.2h21" stroke={trim} strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        );
      case 'k':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path d="M22.5 5v6.5M19.5 8h6" stroke={trim} strokeWidth="2.1" strokeLinecap="round" />
            <path
              d="M12 38h21v-4l-1.5-3c5.8-3.8 7.5-10.5 3.5-14.5-3.2-3.2-8.2-1.8-12.5 3.2-4.3-5-9.3-6.4-12.5-3.2-4 4-2.3 10.7 3.5 14.5l-1.5 3V38z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.65"
              strokeLinejoin="round"
            />
            <path d="M13.5 32.5h18M13 35.2h19" stroke={trim} strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        );
    }
  }

  if (pieceSet === 'alpha') {
    const fill = isWhite ? '#f8fafc' : useLightBlackContrast ? '#dce4ef' : '#111827';
    const stroke = isWhite ? '#0f172a' : useLightBlackContrast ? '#0f172a' : '#030712';
    const inner = isWhite ? '#0f172a' : useLightBlackContrast ? '#1e293b' : '#f1f5f9';

    switch (type) {
      case 'p':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M22.5 8.5a5.5 5.5 0 0 0-3.2 9.9c-2.6 1.6-4.3 4.3-4.3 7.6 0 1.4.4 2.7 1.1 3.8-3.2 1.6-5.1 4.6-5.1 8.7h23c0-4.1-1.9-7.1-5.1-8.7.7-1.1 1.1-2.4 1.1-3.8 0-3.3-1.7-6-4.3-7.6a5.5 5.5 0 0 0-3.2-9.9z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        );
      case 'r':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M9.5 39h26v-5l-3-3V18.5l3-3.5V9h-5v3.5h-4.5V9h-7v3.5h-4.5V9h-5v6l3 3.5V31l-3 3v5z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M13 33.5h19" stroke={inner} strokeWidth="1.5" opacity="0.65" />
          </svg>
        );
      case 'n':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M11 39h24v-4.5c0-11.5-4.5-20.5-13.5-24.5L20 6.5l-3.5 4.5C11 13.5 7.5 18.5 7 23c-.3 2.5 1.8 4 4.5 3.3l5.5-1.8c.5 3.5-2.5 6.8-6 9.5V39z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="15" cy="16" r="1.4" fill={inner} />
          </svg>
        );
      case 'b':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <circle cx="22.5" cy="7.5" r="2.8" fill={fill} stroke={stroke} strokeWidth="1.8" />
            <path
              d="M22.5 10.5c-8 4.8-10 13-5.2 19l-5.3 4.5v5h21v-5L27.7 29.5c4.8-6 2.8-14.2-5.2-19z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M17.5 23.5l10-9" stroke={inner} strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        );
      case 'q':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path
              d="M7 13l7 11.5L15 10l7.5 13L30 10l1 14.5L38 13l-3.5 18.5 2 3.5V39h-28v-4l2-3.5L7 13z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="7" cy="11.5" r="2.3" fill={fill} stroke={stroke} strokeWidth="1.6" />
            <circle cx="15" cy="8.5" r="2.3" fill={fill} stroke={stroke} strokeWidth="1.6" />
            <circle cx="22.5" cy="7.5" r="2.5" fill={fill} stroke={stroke} strokeWidth="1.6" />
            <circle cx="30" cy="8.5" r="2.3" fill={fill} stroke={stroke} strokeWidth="1.6" />
            <circle cx="38" cy="11.5" r="2.3" fill={fill} stroke={stroke} strokeWidth="1.6" />
            <path d="M11.5 34h22" stroke={inner} strokeWidth="1.6" opacity="0.65" />
          </svg>
        );
      case 'k':
        return (
          <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
            <path d="M22.5 5v7M19 8.5h7" stroke={isWhite ? '#0f172a' : '#f1f5f9'} strokeWidth="2.6" strokeLinecap="round" />
            <path
              d="M10.5 39h24v-4.5c5.5-3.5 7-11 3-15.5-3.5-4-9.5-2.5-15 3.5-5.5-6-11.5-7.5-15-3.5-4 4.5-2.5 12 3 15.5V39z"
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M12 34h21" stroke={inner} strokeWidth="1.6" opacity="0.65" />
          </svg>
        );
    }
  }

  // Classic Staunton fallback
  const fill = isWhite ? '#ffffff' : useLightBlackContrast ? '#e2e8f0' : '#1b1e24';
  const stroke = isWhite ? '#1b1e24' : useLightBlackContrast ? '#0f172a' : '#0b0d11';
  const innerStroke = isWhite ? '#1b1e24' : useLightBlackContrast ? '#334155' : '#d6dbe4';

  switch (type) {
    case 'p':
      return (
        <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
          <path
            d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"
            fill={fill}
            stroke={stroke}
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          {!isWhite && (
            <path
              d="M15.5 36.5h14"
              stroke={innerStroke}
              strokeWidth="1.1"
              strokeLinecap="round"
              opacity="0.55"
            />
          )}
        </svg>
      );

    case 'r':
      return (
        <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
          <g fill={fill} stroke={stroke} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5" />
            <path d="M34 14l-3 3H14l-3-3" />
            <path d="M31 17v12.5H14V17" />
            <path d="M31 29.5l1.5 2.5h-20l1.5-2.5" />
            <path d="M11 14h23" />
          </g>
          {!isWhite && (
            <g stroke={innerStroke} strokeWidth="1.1" fill="none" opacity="0.65">
              <path d="M14 17h17M14 29.5h17M12.5 32h20" />
            </g>
          )}
        </svg>
      );

    case 'n':
      return (
        <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
          <g fill={fill} stroke={stroke} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" />
            <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" />
          </g>
          <circle cx="15" cy="15.5" r="1" fill={innerStroke} />
          {!isWhite && (
            <path
              d="M24.5 11.5c6.5 2 10 8.5 10.2 24.5"
              fill="none"
              stroke={innerStroke}
              strokeWidth="1.1"
              strokeLinecap="round"
              opacity="0.55"
            />
          )}
        </svg>
      );

    case 'b':
      return (
        <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
          <g fill={fill} stroke={stroke} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.354.49-2.323.47-3-.5 1.354-1.94 3-2 3-2z" />
            <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" />
            <circle cx="22.5" cy="8" r="2.5" />
          </g>
          <path
            d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5"
            stroke={innerStroke}
            strokeWidth="1.4"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );

    case 'q':
      return (
        <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
          <g fill={fill} stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="12" r="2.6" />
            <circle cx="14" cy="9" r="2.6" />
            <circle cx="22.5" cy="8" r="2.6" />
            <circle cx="31" cy="9" r="2.6" />
            <circle cx="39" cy="12" r="2.6" />
            <path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5 9 26z" />
            <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" />
          </g>
          <path
            d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0"
            stroke={innerStroke}
            strokeWidth="1.25"
            fill="none"
            opacity={isWhite ? 0.85 : 0.7}
          />
        </svg>
      );

    case 'k':
      return (
        <svg viewBox="0 0 45 45" className={className} style={svgContrastStyle} aria-hidden="true">
          <g fill="none" stroke={stroke} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22.5 11.63V6M20 8h5" stroke={isWhite ? '#1b1e24' : '#e2e8f0'} strokeWidth="1.8" />
            <path
              d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5"
              fill={fill}
            />
            <path
              d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z"
              fill={fill}
            />
            <path
              d="M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0"
              stroke={innerStroke}
              strokeWidth="1.25"
              opacity={isWhite ? 0.85 : 0.7}
            />
          </g>
        </svg>
      );
  }
};
