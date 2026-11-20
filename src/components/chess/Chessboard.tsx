import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chess, Color, PieceSymbol, Square } from 'chess.js';
import { Minus, Plus } from 'lucide-react';
import {
  BOARD_SIZE_STEPS,
  BOARD_THEMES,
  FILES,
  RANKS,
  getPremoveDestinations,
  gridCoordsToSquare,
  normalizeBoardSizePx,
  parseFenPieces,
  squareToGridCoords,
} from '../../lib/chessUtils';
import {
  BoardOrientation,
  BoardSize,
  CoordinateDisplay,
} from '../../types/chess';
import { useApp } from '../../context/AppContext';
import { ChessPiece } from './ChessPiece';

export type SquareHighlightType =
  | 'correct'
  | 'wrong'
  | 'selected'
  | 'target'
  | 'visited'
  | 'hint';

export interface PremoveData {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
}

export interface ChessboardProps {
  fen?: string;
  orientation?: BoardOrientation;
  size?: BoardSize;
  coordinates?: CoordinateDisplay;
  hidePieces?: boolean;
  interactive?: boolean;
  lastMove?: { from: Square; to: Square } | null;
  squareHighlights?: Partial<Record<Square, SquareHighlightType>>;
  customMarkers?: Partial<Record<Square, string | number>>;
  onMove?: (from: Square, to: Square, promotion?: PieceSymbol) => boolean | void;
  onSquareClick?: (square: Square) => void;
  disabled?: boolean;
  allowPremoves?: boolean;
  playerColor?: BoardOrientation;
  isOpponentTurn?: boolean;
  resetKey?: string | number;
  showResizeControls?: boolean;
  bottomReservePx?: number;
}

interface RenderedPiece {
  uid: string;
  square: Square;
  type: PieceSymbol;
  color: Color;
  instant: boolean;
}

interface ActiveDragSession {
  pointerId: number;
  from: Square;
  piece: { type: PieceSymbol; color: Color };
  startX: number;
  startY: number;
  hasDragged: boolean;
  wasAlreadySelected: boolean;
  mode: 'move' | 'premove';
}

const HIGHLIGHT_STYLES: Record<SquareHighlightType, string> = {
  correct: 'bg-[#39FF88]/45 ring-2 ring-inset ring-[#39FF88]',
  wrong: 'bg-rose-500/55 ring-2 ring-inset ring-rose-400',
  selected: 'bg-amber-400/45',
  target: 'bg-sky-500/45 ring-2 ring-inset ring-sky-400',
  visited: 'bg-[#39FF88]/25',
  hint: 'bg-amber-400/35 ring-2 ring-inset ring-amber-300',
};

export function computeViewportBoardCap(params: {
  viewportWidth: number;
  viewportHeight: number;
  boardTopPx: number;
  outsideCoordinates: boolean;
  hasResizeControls: boolean;
  bottomReservePx?: number;
}): number {
  const outsidePad = params.outsideCoordinates ? 20 : 0;
  const resizeReserve = params.hasResizeControls ? 40 : 0;
  const bottomReserve = params.bottomReservePx ?? 66;
  const safeTop = Math.max(0, Math.min(params.boardTopPx, params.viewportHeight * 0.65));
  const maxByHeight = params.viewportHeight - safeTop - outsidePad - resizeReserve - bottomReserve;
  const horizontalMargin = params.viewportWidth < 640 ? 60 : 76;
  const maxByWidth = params.viewportWidth - horizontalMargin - outsidePad;
  return Math.max(240, Math.floor(Math.min(maxByHeight, maxByWidth)));
}

export const Chessboard: React.FC<ChessboardProps> = ({
  fen = '8/8/8/8/8/8/8/8 w - - 0 1',
  orientation: orientationOverride,
  size: sizeOverride,
  coordinates: coordinatesOverride,
  hidePieces = false,
  interactive = true,
  lastMove = null,
  squareHighlights = {},
  customMarkers = {},
  onMove,
  onSquareClick,
  disabled = false,
  allowPremoves = false,
  playerColor: playerColorOverride,
  isOpponentTurn = false,
  resetKey,
  showResizeControls = true,
  bottomReservePx,
}) => {
  const { settings, updateSettings } = useApp();
  const boardSettings = settings.board;

  const orientation = orientationOverride ?? 'white';
  const effectivePlayerColor = playerColorOverride ?? orientation;
  const preferredBoardPx = normalizeBoardSizePx(sizeOverride ?? boardSettings.size);
  const coordinates = coordinatesOverride ?? boardSettings.coordinates;
  const pieceSet = boardSettings.pieceSet ?? 'merida';
  const theme = BOARD_THEMES[boardSettings.theme] ?? BOARD_THEMES.green;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [viewportCapPx, setViewportCapPx] = useState<number>(660);

  const recalcViewportCap = useCallback(() => {
    if (typeof window === 'undefined') return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = wrapperRef.current?.getBoundingClientRect();
    const docTop = rect ? rect.top + window.scrollY : vw >= 1024 ? 132 : 220;
    const cap = computeViewportBoardCap({
      viewportWidth: vw,
      viewportHeight: vh,
      boardTopPx: docTop,
      outsideCoordinates: coordinates === 'outside',
      hasResizeControls: showResizeControls && sizeOverride === undefined,
      bottomReservePx,
    });
    setViewportCapPx((prev) => (Math.abs(prev - cap) >= 2 ? cap : prev));
  }, [coordinates, showResizeControls, sizeOverride, bottomReservePx]);

  useLayoutEffect(() => {
    recalcViewportCap();
    const onResize = () => recalcViewportCap();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [recalcViewportCap, fen, resetKey]);

  const minBoardPx = Math.min(BOARD_SIZE_STEPS[0], viewportCapPx);
  const maxBoardPx = Math.min(BOARD_SIZE_STEPS[BOARD_SIZE_STEPS.length - 1], viewportCapPx);
  const boardSizePx = Math.min(preferredBoardPx, viewportCapPx);

  const stepBoardSize = (delta: -1 | 1) => {
    const rawNext =
      delta === -1
        ? Math.max(minBoardPx, Math.floor((boardSizePx - 40) / 10) * 10)
        : Math.min(maxBoardPx, Math.ceil((boardSizePx + 40) / 10) * 10);
    const clampedNext = Math.min(
      BOARD_SIZE_STEPS[BOARD_SIZE_STEPS.length - 1],
      Math.max(BOARD_SIZE_STEPS[0], rawNext)
    );
    if (rawNext === boardSizePx && clampedNext === preferredBoardPx) return;
    updateSettings((prev) => ({
      ...prev,
      board: { ...prev.board, size: clampedNext },
    }));
  };

  const boardRef = useRef<HTMLDivElement>(null);
  const floatingDragRef = useRef<HTMLDivElement>(null);
  const hoverOverlayRef = useRef<HTMLDivElement>(null);

  const dragSessionRef = useRef<ActiveDragSession | null>(null);
  const justDroppedMoveRef = useRef<string | null>(null);
  const moveLockRef = useRef<boolean>(false);
  const uidCounterRef = useRef<number>(1);
  const prevOrientationRef = useRef<BoardOrientation>(orientation);
  const prevResetKeyRef = useRef<string | number | undefined>(resetKey);

  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [draggingPiece, setDraggingPiece] = useState<{
    from: Square;
    type: PieceSymbol;
    color: Color;
  } | null>(null);
  const [premove, setPremove] = useState<PremoveData | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: Square;
    to: Square;
    color: Color;
    isPremove: boolean;
  } | null>(null);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);

  const pieceMap = useMemo(() => {
    if (hidePieces) return new Map<Square, { type: PieceSymbol; color: Color }>();
    return parseFenPieces(fen);
  }, [fen, hidePieces]);

  // Persistent piece identities for smooth 140ms CSS transform sliding (no flicker / no flying across puzzles)
  const [renderedPieces, setRenderedPieces] = useState<RenderedPiece[]>(() => {
    if (hidePieces) return [];
    const initial: RenderedPiece[] = [];
    parseFenPieces(fen).forEach((p, sq) => {
      initial.push({
        uid: `p-${uidCounterRef.current++}`,
        square: sq,
        type: p.type,
        color: p.color,
        instant: true,
      });
    });
    return initial;
  });

  useLayoutEffect(() => {
    const orientationChanged = prevOrientationRef.current !== orientation;
    prevOrientationRef.current = orientation;

    const resetChanged = prevResetKeyRef.current !== resetKey;
    prevResetKeyRef.current = resetKey;

    if (hidePieces) {
      setRenderedPieces([]);
      return;
    }

    const droppedKey = justDroppedMoveRef.current;
    justDroppedMoveRef.current = null;

    setRenderedPieces((prev) => {
      const targetMap = parseFenPieces(fen);

      if (resetChanged || orientationChanged || prev.length === 0) {
        const fresh: RenderedPiece[] = [];
        targetMap.forEach((p, sq) => {
          fresh.push({
            uid: `p-${uidCounterRef.current++}`,
            square: sq,
            type: p.type,
            color: p.color,
            instant: true,
          });
        });
        return fresh;
      }

      const nextList: RenderedPiece[] = [];
      const matchedTargetSquares = new Set<Square>();
      const disappeared: RenderedPiece[] = [];

      // 1. Keep stationary identical pieces
      for (const oldP of prev) {
        const current = targetMap.get(oldP.square);
        if (current && current.type === oldP.type && current.color === oldP.color) {
          nextList.push({ ...oldP, instant: false });
          matchedTargetSquares.add(oldP.square);
        } else {
          disappeared.push(oldP);
        }
      }

      const appeared: Array<{ square: Square; type: PieceSymbol; color: Color }> = [];
      targetMap.forEach((p, sq) => {
        if (!matchedTargetSquares.has(sq)) {
          appeared.push({ square: sq, type: p.type, color: p.color });
        }
      });

      // Only animate transitions that look like a real move (1-2 pieces moving, e.g., normal/capture/castling/ep)
      const shouldAnimateMove =
        boardSettings.animatePieces && appeared.length <= 2 && disappeared.length <= 2;

      const usedOldUids = new Set<string>();

      for (const app of appeared) {
        let matchedOld: RenderedPiece | undefined;

        if (shouldAnimateMove) {
          // Exact type & color match first
          matchedOld = disappeared.find(
            (d) => !usedOldUids.has(d.uid) && d.color === app.color && d.type === app.type
          );

          // Handle pawn promotion (pawn disappears on rank 7/2, Q/R/B/N appears on rank 8/1)
          if (!matchedOld && app.type !== 'p') {
            matchedOld = disappeared.find(
              (d) =>
                !usedOldUids.has(d.uid) &&
                d.color === app.color &&
                d.type === 'p' &&
                ((app.color === 'w' && app.square[1] === '8') ||
                  (app.color === 'b' && app.square[1] === '1'))
            );
          }
        }

        if (matchedOld) {
          usedOldUids.add(matchedOld.uid);
          const wasDroppedHere = droppedKey === `${matchedOld.square}-${app.square}`;
          nextList.push({
            uid: matchedOld.uid,
            square: app.square,
            type: app.type,
            color: app.color,
            instant: wasDroppedHere,
          });
        } else {
          nextList.push({
            uid: `p-${uidCounterRef.current++}`,
            square: app.square,
            type: app.type,
            color: app.color,
            instant: true,
          });
        }
      }

      return nextList;
    });
  }, [fen, hidePieces, orientation, resetKey, boardSettings.animatePieces]);

  // Clear local UI state on resetKey or disabled transitions
  useEffect(() => {
    setSelectedSquare(null);
    setPendingPromotion(null);
    setPremove(null);
    setDraggingPiece(null);
    dragSessionRef.current = null;
  }, [resetKey]);

  useEffect(() => {
    if (disabled) {
      setSelectedSquare(null);
      setPendingPromotion(null);
      setPremove(null);
      setDraggingPiece(null);
      dragSessionRef.current = null;
    }
  }, [disabled]);

  // Execute or cancel premove automatically when player's turn arrives
  useEffect(() => {
    if (!allowPremoves || isOpponentTurn || disabled || !premove || !onMove || !chess) {
      return;
    }

    const playerTurnCode: Color = effectivePlayerColor === 'white' ? 'w' : 'b';
    if (chess.turn() !== playerTurnCode) {
      return;
    }

    const queued = premove;
    setPremove(null);
    setSelectedSquare(null);

    try {
      const legalMoves = chess.moves({ square: queued.from, verbose: true });
      const matching = legalMoves.filter((m) => m.to === queued.to);
      if (matching.length === 0) {
        // Premove became illegal after opponent's move -> cancel cleanly without penalty
        return;
      }

      const promoMove = queued.promotion
        ? matching.find((m) => m.promotion === queued.promotion)
        : matching.find((m) => m.promotion === 'q') ?? matching[0];

      if (!promoMove) return;

      moveLockRef.current = true;
      try {
        onMove(
          queued.from,
          queued.to,
          (queued.promotion ?? promoMove.promotion) as PieceSymbol | undefined
        );
      } finally {
        window.setTimeout(() => {
          moveLockRef.current = false;
        }, 0);
      }
    } catch {
      // Cancel cleanly on any chess.js check failure
    }
  }, [fen, isOpponentTurn, disabled, allowPremoves, premove, onMove, chess, effectivePlayerColor]);

  // Compute legal destinations (normal move OR premove targets)
  const legalDestinations = useMemo(() => {
    const map = new Map<Square, boolean>();
    if (!onMove || !boardSettings.highlightLegalMoves) return map;
    const activeSquare = draggingPiece?.from ?? selectedSquare;
    if (!activeSquare) return map;

    if (allowPremoves && isOpponentTurn) {
      const targets = getPremoveDestinations(fen, activeSquare);
      for (const sq of targets) {
        map.set(sq, pieceMap.has(sq));
      }
      return map;
    }

    if (!chess) return map;
    try {
      const moves = chess.moves({ square: activeSquare, verbose: true });
      for (const m of moves) {
        map.set(m.to, Boolean(m.captured));
      }
    } catch {
      // Ignore invalid FEN states
    }
    return map;
  }, [
    chess,
    fen,
    pieceMap,
    selectedSquare,
    draggingPiece,
    onMove,
    boardSettings.highlightLegalMoves,
    allowPremoves,
    isOpponentTurn,
  ]);

  const isPromotionMove = useCallback(
    (from: Square, to: Square): boolean => {
      const piece = pieceMap.get(from);
      if (!piece || piece.type !== 'p') return false;
      const targetRank = to[1];
      return (piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1');
    },
    [pieceMap]
  );

  const commitPremove = useCallback(
    (from: Square, to: Square, promotion?: PieceSymbol) => {
      if (from === to) return;
      const validTargets = getPremoveDestinations(fen, from);
      if (!validTargets.includes(to)) {
        setPremove(null);
        setSelectedSquare(null);
        return;
      }

      if (!promotion && isPromotionMove(from, to)) {
        const piece = pieceMap.get(from);
        if (piece) {
          setPendingPromotion({ from, to, color: piece.color, isPremove: true });
          setSelectedSquare(null);
          return;
        }
      }

      setPremove({ from, to, promotion });
      setSelectedSquare(null);
    },
    [fen, isPromotionMove, pieceMap]
  );

  const attemptMove = useCallback(
    (from: Square, to: Square) => {
      if (!onMove || from === to || moveLockRef.current) return;

      try {
        const legalMoves = chess ? chess.moves({ square: from, verbose: true }) : [];
        const matching = legalMoves.filter((m) => m.to === to);
        if (matching.length === 0) {
          // Let caller handle wrong/non-standard move rejection cleanly without stuck selection
          moveLockRef.current = true;
          try {
            const res = onMove(from, to);
            if (res === false) {
              justDroppedMoveRef.current = null;
            }
            setSelectedSquare(null);
          } finally {
            window.setTimeout(() => {
              moveLockRef.current = false;
            }, 0);
          }
          return;
        }

        if (isPromotionMove(from, to) && matching.some((m) => m.promotion)) {
          const piece = pieceMap.get(from);
          if (piece) {
            setPendingPromotion({ from, to, color: piece.color, isPremove: false });
            setSelectedSquare(null);
            return;
          }
        }

        moveLockRef.current = true;
        try {
          const res = onMove(from, to);
          if (res === false) {
            justDroppedMoveRef.current = null;
          }
          setSelectedSquare(null);
        } finally {
          window.setTimeout(() => {
            moveLockRef.current = false;
          }, 0);
        }
      } catch {
        const res = onMove(from, to);
        if (res === false) {
          justDroppedMoveRef.current = null;
        }
        setSelectedSquare(null);
      }
    },
    [chess, isPromotionMove, onMove, pieceMap]
  );

  const getSquareFromPointer = useCallback(
    (clientX: number, clientY: number): Square | null => {
      const el = boardRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return null;
      }
      const col = Math.min(7, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * 8)));
      const row = Math.min(7, Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * 8)));
      return gridCoordsToSquare(row, col, orientation);
    },
    [orientation]
  );

  const updateFloatingPosition = useCallback((clientX: number, clientY: number, squareSize: number) => {
    const floatEl = floatingDragRef.current;
    if (!floatEl) return;
    const sizePx = squareSize * 0.94;
    const x = clientX - sizePx * 0.5;
    const y = clientY - sizePx * 0.5;
    floatEl.style.width = `${sizePx}px`;
    floatEl.style.height = `${sizePx}px`;
    floatEl.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.06)`;
  }, []);

  const updateHoverOverlay = useCallback(
    (square: Square | null, origin: Square | null) => {
      const overlay = hoverOverlayRef.current;
      if (!overlay) return;
      if (!square || square === origin) {
        overlay.style.opacity = '0';
        return;
      }
      const { row, col } = squareToGridCoords(square, orientation);
      overlay.style.opacity = '1';
      overlay.style.transform = `translate3d(${col * 100}%, ${row * 100}%, 0)`;
    },
    [orientation]
  );

  // Clean up window drag listeners on unmount
  const windowMoveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const windowUpHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);

  const cleanupWindowListeners = useCallback(() => {
    if (windowMoveHandlerRef.current) {
      window.removeEventListener('pointermove', windowMoveHandlerRef.current);
      windowMoveHandlerRef.current = null;
    }
    if (windowUpHandlerRef.current) {
      window.removeEventListener('pointerup', windowUpHandlerRef.current);
      window.removeEventListener('pointercancel', windowUpHandlerRef.current);
      windowUpHandlerRef.current = null;
    }
  }, []);

  useEffect(() => cleanupWindowListeners, [cleanupWindowListeners]);

  const handleBoardPointerDown = (e: React.PointerEvent) => {
    if (disabled || !interactive || pendingPromotion) return;

    // Right click cancels premove & selection immediately
    if (e.button === 2) {
      if (premove) setPremove(null);
      setSelectedSquare(null);
      return;
    }

    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const square = getSquareFromPointer(e.clientX, e.clientY);
    if (!square) return;

    // Non-move boards (Coordinate Training, Knight Training, Blindfold Training) keep clean click-only behavior
    if (!onMove) {
      return;
    }

    // Prevent touch scrolling/selection on active chess move interactions
    if (e.pointerType === 'touch') {
      e.preventDefault();
    }

    const canPremoveNow = Boolean(allowPremoves && isOpponentTurn);
    const activeTurn: Color = chess ? chess.turn() : 'w';
    const playerTurnCode: Color = effectivePlayerColor === 'white' ? 'w' : 'b';
    const selectableColor: Color = canPremoveNow ? playerTurnCode : activeTurn;
    const piece = pieceMap.get(square);

    // If a square is already selected and user taps a legal destination (or valid premove target), execute immediately
    if (selectedSquare && selectedSquare !== square) {
      if (canPremoveNow) {
        const premoveTargets = getPremoveDestinations(fen, selectedSquare);
        if (premoveTargets.includes(square)) {
          commitPremove(selectedSquare, square);
          return;
        }
      } else if (!isOpponentTurn && chess) {
        const legal = chess.moves({ square: selectedSquare, verbose: true });
        if (legal.some((m) => m.to === square)) {
          attemptMove(selectedSquare, square);
          return;
        }
      }
    }

    // Clicking the source square of an active premove cancels the premove
    if (canPremoveNow && premove && premove.from === square && !piece) {
      setPremove(null);
      setSelectedSquare(null);
      return;
    }

    // If user didn't tap one of their movable pieces, cancel selection/premove
    if (!piece || piece.color !== selectableColor) {
      if (canPremoveNow && premove) {
        setPremove(null);
      }
      setSelectedSquare(null);
      if (onSquareClick) onSquareClick(square);
      return;
    }

    // Clicking the origin square of a queued premove while it's still occupied by that piece:
    // Start a drag session; if it turns out to be a tap (<=4px) and was already premoved or selected, handle on pointerup.
    const wasAlreadySelected = selectedSquare === square;
    const rect = boardRef.current?.getBoundingClientRect();
    const squareSize = rect ? rect.width / 8 : 60;

    cleanupWindowListeners();

    const session: ActiveDragSession = {
      pointerId: e.pointerId,
      from: square,
      piece,
      startX: e.clientX,
      startY: e.clientY,
      hasDragged: false,
      wasAlreadySelected,
      mode: canPremoveNow ? 'premove' : 'move',
    };
    dragSessionRef.current = session;

    // Show selection highlight immediately on press (zero flicker)
    if (!wasAlreadySelected) {
      setSelectedSquare(square);
    }

    const handleWindowPointerMove = (moveEvent: PointerEvent) => {
      const active = dragSessionRef.current;
      if (!active || moveEvent.pointerId !== active.pointerId) return;

      const dist = Math.hypot(moveEvent.clientX - active.startX, moveEvent.clientY - active.startY);
      if (!active.hasDragged && dist > 4) {
        active.hasDragged = true;
        setDraggingPiece({
          from: active.from,
          type: active.piece.type,
          color: active.piece.color,
        });
        setSelectedSquare(active.from);
      }

      if (active.hasDragged) {
        updateFloatingPosition(moveEvent.clientX, moveEvent.clientY, squareSize);
        const hoverSq = getSquareFromPointer(moveEvent.clientX, moveEvent.clientY);
        updateHoverOverlay(hoverSq, active.from);
      }
    };

    const handleWindowPointerUp = (upEvent: PointerEvent) => {
      const active = dragSessionRef.current;
      if (!active || upEvent.pointerId !== active.pointerId) return;

      cleanupWindowListeners();
      dragSessionRef.current = null;
      updateHoverOverlay(null, null);

      if (active.hasDragged) {
        setDraggingPiece(null);
        const targetSquare =
          upEvent.type === 'pointerup'
            ? getSquareFromPointer(upEvent.clientX, upEvent.clientY)
            : null;

        if (targetSquare && targetSquare !== active.from) {
          if (active.mode === 'premove') {
            commitPremove(active.from, targetSquare);
          } else {
            justDroppedMoveRef.current = `${active.from}-${targetSquare}`;
            attemptMove(active.from, targetSquare);
          }
        } else if (targetSquare !== active.from) {
          // Dropped outside board
          setSelectedSquare(null);
        }
      } else {
        // Tap / click release within threshold
        if (canPremoveNow && premove && premove.from === active.from) {
          setPremove(null);
          setSelectedSquare(null);
        } else if (active.wasAlreadySelected) {
          setSelectedSquare(null);
        }
      }
    };

    windowMoveHandlerRef.current = handleWindowPointerMove;
    windowUpHandlerRef.current = handleWindowPointerUp;
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
  };

  const handleSquareClickFallback = (square: Square) => {
    if (disabled || !interactive || pendingPromotion) return;
    if (!onMove && onSquareClick) {
      onSquareClick(square);
    }
  };

  const orderedFiles = orientation === 'white' ? FILES : [...FILES].reverse();
  const orderedRanks = orientation === 'white' ? RANKS : [...RANKS].reverse();

  return (
    <div ref={wrapperRef} style={{ maxWidth: `${boardSizePx}px` }} className="w-full select-none mx-auto">
      <div className="relative">
        <div
          className={`flex items-stretch ${
            coordinates === 'outside' ? 'pl-5 pb-5' : ''
          }`}
        >
          {coordinates === 'outside' && (
            <div className="absolute left-0 top-0 bottom-5 w-5 flex flex-col justify-around items-center text-[11px] font-mono-tabular text-slate-400 pointer-events-none">
              {orderedRanks.map((r) => (
                <span key={r}>{r}</span>
              ))}
            </div>
          )}

          {/* 8x8 Board Surface */}
          <div
            ref={boardRef}
            onPointerDown={handleBoardPointerDown}
            onContextMenu={(e) => {
              if (onMove) {
                e.preventDefault();
                setPremove(null);
                setSelectedSquare(null);
              }
            }}
            className="relative w-full aspect-square grid grid-cols-8 grid-rows-8 rounded-xl overflow-hidden shadow-lg border border-slate-300 dark:border-[#263D5C] touch-none"
            role="grid"
            aria-label={`Chessboard (${orientation} orientation)`}
          >
            {Array.from({ length: 64 }).map((_, idx) => {
              const row = Math.floor(idx / 8);
              const col = idx % 8;
              const square = gridCoordsToSquare(row, col, orientation);
              const isLight = (row + col) % 2 === 0;
              const bgColor = isLight ? theme.light : theme.dark;
              const coordColor = isLight ? theme.coordLight : theme.coordDark;

              const piece = pieceMap.get(square);
              const isSelected = selectedSquare === square;
              const isPremoveSq = premove && (premove.from === square || premove.to === square);
              const isLastMove =
                boardSettings.highlightLastMove &&
                lastMove &&
                (lastMove.from === square || lastMove.to === square);
              const customHighlight = squareHighlights[square];
              const legalCapture = legalDestinations.get(square);
              const isLegalTarget = legalDestinations.has(square);
              const marker = customMarkers[square];

              const showRankLabel = coordinates === 'inside' && col === 0;
              const showFileLabel = coordinates === 'inside' && row === 7;
              const rankChar = square[1];
              const fileChar = square[0];

              return (
                <div
                  key={`${row}-${col}`}
                  data-square={square}
                  onClick={() => handleSquareClickFallback(square)}
                  style={{ backgroundColor: bgColor }}
                  className={`relative flex items-center justify-center ${
                    interactive && !disabled ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  {/* Last move tint */}
                  {isLastMove && (
                    <div className="absolute inset-0 bg-amber-300/35 pointer-events-none" />
                  )}

                  {/* Premove tint (Lichess-style sky highlight) */}
                  {isPremoveSq && (
                    <div className="absolute inset-0 bg-sky-500/40 ring-2 ring-inset ring-sky-400/80 pointer-events-none" />
                  )}

                  {/* Selected square tint */}
                  {isSelected && (
                    <div className="absolute inset-0 bg-amber-400/45 pointer-events-none" />
                  )}

                  {/* Custom highlight overlay */}
                  {customHighlight && (
                    <div
                      className={`absolute inset-0 pointer-events-none ${HIGHLIGHT_STYLES[customHighlight]}`}
                    />
                  )}

                  {/* Inside coordinates */}
                  {showRankLabel && (
                    <span
                      style={{ color: coordColor }}
                      className="absolute top-0.5 left-1 text-[10px] font-semibold leading-none pointer-events-none font-mono-tabular"
                    >
                      {rankChar}
                    </span>
                  )}
                  {showFileLabel && (
                    <span
                      style={{ color: coordColor }}
                      className="absolute bottom-0.5 right-1 text-[10px] font-semibold leading-none pointer-events-none font-mono-tabular"
                    >
                      {fileChar}
                    </span>
                  )}

                  {/* Custom text/step marker */}
                  {marker !== undefined && !piece && (
                    <span className="z-10 text-[11px] font-bold font-mono-tabular text-slate-900 bg-white/80 px-1.5 py-0.5 rounded">
                      {marker}
                    </span>
                  )}

                  {/* Legal Move / Premove Indicator */}
                  {isLegalTarget && !legalCapture && (
                    <div
                      className={`w-[28%] h-[28%] rounded-full z-20 pointer-events-none ${
                        allowPremoves && isOpponentTurn ? 'bg-sky-500/45' : 'bg-black/25'
                      }`}
                    />
                  )}
                  {isLegalTarget && legalCapture && (
                    <div
                      className={`absolute inset-1 rounded-full border-[5px] z-20 pointer-events-none ${
                        allowPremoves && isOpponentTurn ? 'border-sky-500/45' : 'border-black/25'
                      }`}
                    />
                  )}
                </div>
              );
            })}

            {/* Zero-rerender Drag Target Hover Highlight */}
            <div
              ref={hoverOverlayRef}
              style={{ opacity: 0 }}
              className="pointer-events-none absolute top-0 left-0 w-[12.5%] h-[12.5%] z-10 ring-2 ring-inset ring-white/75 bg-white/15 transition-opacity duration-75"
            />

            {/* Smooth Animated Piece Layer */}
            {!hidePieces && (
              <div className="pointer-events-none absolute inset-0 z-10">
                {renderedPieces.map((p) => {
                  const { row, col } = squareToGridCoords(p.square, orientation);
                  const isDragged = draggingPiece?.from === p.square;
                  return (
                    <div
                      key={p.uid}
                      style={{
                        transform: `translate3d(${col * 100}%, ${row * 100}%, 0)`,
                        opacity: isDragged ? 0 : 1,
                        transition: p.instant
                          ? 'none'
                          : 'transform 135ms cubic-bezier(0.2, 0.8, 0.2, 1)',
                        willChange: 'transform',
                      }}
                      className="absolute top-0 left-0 w-[12.5%] h-[12.5%] flex items-center justify-center"
                    >
                      <div className="w-[84%] h-[84%]">
                        <ChessPiece type={p.type} color={p.color} pieceSet={pieceSet} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Inline Pawn Promotion Picker */}
            {pendingPromotion && (
              <div className="absolute inset-0 z-30 bg-[#080F1E]/75 backdrop-blur-[1px] flex items-center justify-center p-4">
                <div className="bg-[#14233A] border border-[#263D5C] rounded-2xl p-4 shadow-2xl">
                  <p className="text-sm sm:text-base font-bold text-[#F1F5F9] mb-3 text-center">
                    {pendingPromotion.isPremove
                      ? 'Choose Premove Promotion'
                      : 'Choose Promotion Piece'}
                  </p>
                  <div className="flex items-center gap-2.5">
                    {(['q', 'r', 'b', 'n'] as PieceSymbol[]).map((promo) => (
                      <button
                        key={promo}
                        type="button"
                        onClick={() => {
                          if (pendingPromotion.isPremove) {
                            setPremove({
                              from: pendingPromotion.from,
                              to: pendingPromotion.to,
                              promotion: promo,
                            });
                          } else {
                            onMove?.(pendingPromotion.from, pendingPromotion.to, promo);
                          }
                          setPendingPromotion(null);
                        }}
                        className="w-14 h-14 p-2 rounded-xl bg-[#101B30] hover:bg-[#39FF88]/15 border border-[#263D5C] hover:border-[#39FF88]/60 transition-colors cursor-pointer"
                        aria-label={`Promote to ${promo}`}
                      >
                        <ChessPiece
                          type={promo}
                          color={pendingPromotion.color}
                          pieceSet={pieceSet}
                          lightContrastForDarkBg={pendingPromotion.color === 'b'}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {coordinates === 'outside' && (
            <div className="absolute left-5 right-0 bottom-0 h-5 flex justify-around items-center text-[11px] font-mono-tabular text-slate-400 pointer-events-none">
              {orderedFiles.map((f) => (
                <span key={f}>{f}</span>
              ))}
            </div>
          )}
        </div>

        {/* Bottom-Right Corner Board Resizer (works live during active sessions without resetting state) */}
        {showResizeControls && sizeOverride === undefined && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="relative z-[25] mt-1.5 flex items-center justify-end"
          >
            <div
              role="group"
              aria-label="Resize chessboard"
              className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100/95 dark:bg-[#101B30]/95 border border-slate-200 dark:border-[#263D5C] shadow-sm"
            >
              <button
                type="button"
                onClick={() => stepBoardSize(-1)}
                disabled={boardSizePx <= minBoardPx}
                aria-label="Decrease board size"
                title="Decrease board size"
                className="w-7 h-7 inline-flex items-center justify-center rounded-lg bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] text-slate-700 dark:text-[#F1F5F9] hover:border-emerald-500 dark:hover:border-[#39FF88] hover:text-emerald-600 dark:hover:text-[#39FF88] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => stepBoardSize(1)}
                disabled={boardSizePx >= maxBoardPx}
                aria-label="Increase board size"
                title="Increase board size"
                className="w-7 h-7 inline-flex items-center justify-center rounded-lg bg-white dark:bg-[#14233A] border border-slate-200 dark:border-[#263D5C] text-slate-700 dark:text-[#F1F5F9] hover:border-emerald-500 dark:hover:border-[#39FF88] hover:text-emerald-600 dark:hover:text-[#39FF88] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Zero-rerender GPU-accelerated Floating Dragged Piece */}
      <div
        ref={floatingDragRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          zIndex: 9999,
          display: draggingPiece ? 'block' : 'none',
          willChange: 'transform',
          filter: 'drop-shadow(0 8px 14px rgba(0, 0, 0, 0.4))',
        }}
      >
        {draggingPiece && (
          <ChessPiece
            type={draggingPiece.type}
            color={draggingPiece.color}
            pieceSet={pieceSet}
          />
        )}
      </div>
    </div>
  );
};
