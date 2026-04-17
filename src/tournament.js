// tournament.js — engine-vs-engine self-play. Two Stockfish variants play
// N games against each other; we count wins, draws, average eval swings, and
// flag positions where they disagree most.

import { Engine, ENGINE_FLAVORS } from './engine.js';
import { Chess } from '../vendor/chess.js/chess.js';

export class Tournament extends EventTarget {
  constructor({ flavorA, flavorB, games = 10, limit = { depth: 12 },
                startFen, openingUci = [], openingName = '' }) {
    super();
    this.flavorA = flavorA;
    this.flavorB = flavorB;
    this.games   = games;
    this.limit   = limit;
    this.startFen    = startFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    this.openingUci  = openingUci;            // UCI moves that led to startFen
    this.openingName = openingName;
    this.running = false;
    this.abortFlag = false;

    this.results = {
      aWins: 0, bWins: 0, draws: 0,
      gamesPlayed: 0,
      games: [],              // [{pgn, result, plyCount, evalSwings: [{ply, a, b, diff}]}]
    };
  }

  async run() {
    this.running = true;
    this.abortFlag = false;
    this._emit('started', this.results);

    // Boot both engines
    const ea = new Engine();
    const eb = new Engine();
    ea.multipv = 1; eb.multipv = 1;
    try {
      await ea.boot({ flavor: this.flavorA });
      await eb.boot({ flavor: this.flavorB });
    } catch (err) {
      this.running = false;
      this._emit('error', { error: err.message });
      return;
    }

    // Emit proof that two distinct engines are running:
    // UCI "id name" string + the WASM script path each Worker loaded from.
    this._emit('engines-ready', {
      a: { id: ea.uciId, script: ea.scriptPath, flavor: ea.flavor },
      b: { id: eb.uciId, script: eb.scriptPath, flavor: eb.flavor },
    });

    for (let g = 0; g < this.games; g++) {
      if (this.abortFlag) break;
      // Alternate who plays White so A and B both get equal colors
      const whiteFlavor = g % 2 === 0 ? 'A' : 'B';
      const result = await this._playOneGame(ea, eb, whiteFlavor);
      this.results.games.push(result);
      this._tallyResult(result, whiteFlavor);
      this._emit('game-done', {
        gameNum: g + 1,
        result,
        standings: this._standings(),
      });
    }

    ea.terminate();
    eb.terminate();
    this.running = false;
    this._emit('finished', { standings: this._standings(), results: this.results });
  }

  abort() {
    this.abortFlag = true;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async _playOneGame(ea, eb, whiteFlavor) {
    const chess = new Chess(this.startFen);
    const moves = [];
    const evalSwings = [];
    let plyCount = 0;

    const uciMoves = [];
    while (!chess.isGameOver() && plyCount < 200) {
      if (this.abortFlag) break;
      const turn = chess.turn();
      const isWhite = turn === 'w';
      const engineLetter = (isWhite === (whiteFlavor === 'A')) ? 'A' : 'B';
      const engine = engineLetter === 'A' ? ea : eb;

      // Get the move
      const bestmove = await this._askForMove(engine, chess.fen(), this.limit);
      if (!bestmove || bestmove === '(none)') break;
      try {
        const mv = chess.move({
          from: bestmove.slice(0, 2),
          to:   bestmove.slice(2, 4),
          promotion: bestmove.length > 4 ? bestmove[4] : undefined,
        });
        if (!mv) break;
        moves.push(mv.san);
        uciMoves.push(bestmove);
      } catch (e) { break; }

      plyCount++;
      this._emit('move', {
        gameNum: this.results.games.length + 1,
        ply: plyCount,
        san: moves[moves.length - 1],
        fen: chess.fen(),
        playedBy: engineLetter,
      });
    }

    const result = this._gameResult(chess, plyCount);
    // Prefix the opening moves so replays show the full game from move 1
    const fullUci = [...(this.openingUci || []), ...uciMoves];
    return {
      pgn: this._toPgn(moves),
      result,
      plyCount,
      moves,
      uciMoves: fullUci,     // opening + game moves
      whiteFlavor,
      finalFen: chess.fen(),
      openingName: this.openingName,
    };
  }

  _askForMove(engine, fen, limit) {
    return new Promise((resolve) => {
      const onBest = (e) => {
        engine.removeEventListener('bestmove', onBest);
        clearTimeout(safety);
        resolve(e.detail.best);
      };
      engine.addEventListener('bestmove', onBest);
      engine.start(fen, limit);
      // Safety timeout — 3× the movetime, or 60s for depth searches
      const timeoutMs = limit.movetime ? limit.movetime * 3 : 60000;
      const safety = setTimeout(() => {
        engine.removeEventListener('bestmove', onBest);
        engine.stop();
        resolve(null);
      }, timeoutMs);
    });
  }

  _gameResult(chess, plyCount) {
    if (chess.isCheckmate()) return chess.turn() === 'w' ? '0-1' : '1-0';
    if (chess.isStalemate() || chess.isDraw() || chess.isThreefoldRepetition()
        || chess.isInsufficientMaterial()) return '1/2-1/2';
    if (plyCount >= 200) return '1/2-1/2 (move-limit)';
    return '*';
  }

  _tallyResult(game, whiteFlavor) {
    this.results.gamesPlayed++;
    if (game.result === '1-0') {
      if (whiteFlavor === 'A') this.results.aWins++;
      else                     this.results.bWins++;
    } else if (game.result === '0-1') {
      if (whiteFlavor === 'A') this.results.bWins++;
      else                     this.results.aWins++;
    } else {
      this.results.draws++;
    }
  }

  _standings() {
    const { aWins, bWins, draws, gamesPlayed } = this.results;
    // Elo differential from win rate (standard formula)
    const aScore = aWins + draws / 2;
    const p = gamesPlayed ? aScore / gamesPlayed : 0.5;
    const eloDiff = (p > 0 && p < 1)
      ? Math.round(-400 * Math.log10(1/p - 1))
      : (p >= 1 ? 999 : -999);
    return {
      aWins, bWins, draws, gamesPlayed,
      aScorePct: gamesPlayed ? Math.round(100 * aScore / gamesPlayed) : 0,
      eloDiff,
    };
  }

  _toPgn(moves) {
    let pgn = '';
    for (let i = 0; i < moves.length; i++) {
      if (i % 2 === 0) pgn += `${Math.floor(i/2) + 1}. `;
      pgn += moves[i] + ' ';
    }
    return pgn.trim();
  }
}
