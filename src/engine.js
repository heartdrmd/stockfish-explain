// engine.js — Stockfish WASM worker wrapper with UCI protocol parsing.
// Emits "thinking" and "bestmove" events. Tracks per-iteration history
// for confidence detection. Supports 3 engine flavors:
//   - lite-single: 7 MB, single-thread, works from file://
//   - lite:        7 MB, multi-thread (needs COOP/COEP headers)
//   - full:      108 MB, full NNUE, multi-thread (strongest)

export const ENGINE_FLAVORS = {
  // ─── Fast-boot: lichess-org/stockfish-web + smallnet ───
  // Boots with the 6 MB small NNUE (external file, not embedded),
  // swaps to the 75 MB big NNUE in the background once it's cached.
  // ~1-2 s cold boot vs 10-60 s for embedded 108 MB variants.
  'sf-fast': {
    js: 'assets/stockfish-web/sf_18.js',
    label: '★ Fast — lichess stockfish-web (smallnet → bignet hot-swap)',
    size: '6 MB (boot) + 75 MB (background)',
    threaded: true,
    externalNnue: {
      small: 'assets/nnue/small.nnue',
      big:   'assets/nnue/big.nnue',
    },
  },

  // ─── Stock (no source patches) ───
  'lite-single': {
    js: 'assets/stockfish/stockfish-18-lite-single.js',
    label: 'Stock Lite (single-thread)',
    size: '7 MB',
    threaded: false,
  },
  'lite': {
    js: 'assets/stockfish/stockfish-18-lite.js',
    label: 'Stock Lite (multi-thread)',
    size: '7 MB',
    threaded: true,
  },
  'full': {
    js: 'assets/stockfish/stockfish-18.js',
    label: 'Stock Full (multi-thread)',
    size: '108 MB',
    threaded: true,
  },

  // ─── Lite (7 MB) variants with custom SEE values ───
  'kaufman-lite-single': {
    js: 'assets/stockfish/stockfish-kaufman-lite-single.js',
    label: 'Kaufman (lite) — P=208 N=676 B=676 R=1040 Q=2028',
    size: '7 MB', threaded: false, custom: true,
  },
  'classical-lite-single': {
    js: 'assets/stockfish/stockfish-classical-lite-single.js',
    label: 'Classical 1/3/3/5/9 (lite) — N=B=624 R=1040 Q=1872',
    size: '7 MB', threaded: false, custom: true,
  },
  'alphazero-lite-single': {
    js: 'assets/stockfish/stockfish-alphazero-lite-single.js',
    label: 'AlphaZero (lite) — N=634 B=693 R=1171 Q=1976',
    size: '7 MB', threaded: false, custom: true,
  },
  'avrukh-lite-single': {
    js: 'assets/stockfish/stockfish-avrukh-lite-single.js',
    label: 'Avrukh (lite) — bishops nudged (B=720)',
    size: '7 MB', threaded: false, custom: true,
  },
  'avrukhplus-lite-single': {
    js: 'assets/stockfish/stockfish-avrukhplus-lite-single.js',
    label: '★ Avrukh+ (lite, single) — Avrukh values + bishop-pair SEE patch',
    size: '7 MB', threaded: false, custom: true, patched: true,
  },
  'avrukhplus-lite': {
    js: 'assets/stockfish/stockfish-avrukhplus-lite.js',
    label: '★ Avrukh+ (lite, MULTI-THREAD) — Avrukh values + SEE patch',
    size: '7 MB', threaded: true, custom: true, patched: true,
  },

  // ─── Full (108 MB) variants ───
  'stock-single': {
    js: 'assets/stockfish/stockfish-stock-single.js',
    label: 'Stock Full (single-thread, file://-safe)',
    size: '108 MB', threaded: false, custom: true,
  },
  'kaufman-single': {
    js: 'assets/stockfish/stockfish-kaufman-single.js',
    label: 'Kaufman (full 108 MB) — P=208 N=676 B=676 R=1040 Q=2028',
    size: '108 MB', threaded: false, custom: true,
  },
  'classical-single': {
    js: 'assets/stockfish/stockfish-classical-single.js',
    label: 'Classical 1/3/3/5/9 (full 108 MB)',
    size: '108 MB', threaded: false, custom: true,
  },
  'alphazero-single': {
    js: 'assets/stockfish/stockfish-alphazero-single.js',
    label: 'AlphaZero (full 108 MB)',
    size: '108 MB', threaded: false, custom: true,
  },
  'avrukh-single': {
    js: 'assets/stockfish/stockfish-avrukh-single.js',
    label: 'Avrukh (full 108 MB) — bishops nudged',
    size: '108 MB', threaded: false, custom: true,
  },
  'avrukhplus-single': {
    js: 'assets/stockfish/stockfish-avrukhplus-single.js',
    label: '★ Avrukh+ (full 108 MB, single) — Avrukh values + SEE pair patch',
    size: '108 MB', threaded: false, custom: true, patched: true,
  },

  // ─── Full (108 MB) MULTI-THREADED variants — strongest possible ───
  'kaufman': {
    js: 'assets/stockfish/stockfish-kaufman.js',
    label: 'Kaufman (full 108 MB, MULTI-THREAD)',
    size: '108 MB', threaded: true, custom: true,
  },
  'classical': {
    js: 'assets/stockfish/stockfish-classical.js',
    label: 'Classical 1/3/3/5/9 (full 108 MB, MULTI-THREAD)',
    size: '108 MB', threaded: true, custom: true,
  },
  'alphazero': {
    js: 'assets/stockfish/stockfish-alphazero.js',
    label: 'AlphaZero (full 108 MB, MULTI-THREAD)',
    size: '108 MB', threaded: true, custom: true,
  },
  'avrukh': {
    js: 'assets/stockfish/stockfish-avrukh.js',
    label: 'Avrukh (full 108 MB, MULTI-THREAD) — bishops nudged',
    size: '108 MB', threaded: true, custom: true,
  },
  'avrukhplus': {
    js: 'assets/stockfish/stockfish-avrukhplus.js',
    label: '★ Avrukh+ (full 108 MB, MULTI-THREAD) — values + SEE pair patch',
    size: '108 MB', threaded: true, custom: true, patched: true,
  },
};

export class Engine extends EventTarget {
  constructor() {
    super();
    this.worker     = null;
    this.ready      = false;
    this.searching  = false;
    this.scriptPath = null;
    this.flavor     = null;
    this.multipv    = 3;
    this.skill      = 20;
    this.threads    = 1;
    this.hashMB     = 256;      // transposition-table size, MB

    // Capture the UCI banner (`id name …`) so callers can prove which engine is loaded.
    this.uciId      = null;

    this.history    = [];
    this.topMoves   = new Map();
  }

  async boot({ flavor = 'auto' } = {}) {
    // Pick flavor
    const threadable = typeof SharedArrayBuffer !== 'undefined'
                    && typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
    // Default to Avrukh 108 MT (user-preferred) when threadable,
    // Avrukh-single otherwise. 'Strongest' without caveats is 'avrukh'
    // per user testing — the stock 'full' variant has been flaky for
    // this user. Falls back through the main.js chain on crash.
    if (flavor === 'auto') flavor = threadable ? 'avrukh' : 'avrukh-single';
    if (!ENGINE_FLAVORS[flavor]) throw new Error(`Unknown flavor ${flavor}`);
    const spec = ENGINE_FLAVORS[flavor];
    if (spec.threaded && !threadable) {
      throw new Error(`${spec.label} needs COOP/COEP headers (crossOriginIsolated). Use the Python dev server, or switch to Lite (single-thread).`);
    }

    this.flavor = flavor;
    this.scriptPath = spec.js;
    // Default: 6 threads is the sweet spot for Stockfish on WASM.
    // Beyond ~8 threads the Elo curve flattens; beyond ~12 the UI
    // thread gets starved on macOS and the user gets click-lag when
    // playing against the engine. We still respect hw limits and the
    // 32-thread WASM pthread pool cap. User can crank higher via the
    // threads slider for pure analysis work.
    const hw = navigator.hardwareConcurrency || 4;
    const WASM_THREAD_CAP = 32;
    const DEFAULT_THREADS = 6;
    this.threads = spec.threaded
      ? Math.max(1, Math.min(hw - 2, DEFAULT_THREADS, WASM_THREAD_CAP))
      : 1;

    try {
      // lichess-org/stockfish-web ships an ES module (uses import.meta).
      // Our custom-built variants are classic scripts. Match the worker
      // type to the flavor — sf-fast (and any future external-NNUE
      // flavor) goes through as type:'module'.
      const workerOpts = spec.externalNnue ? { type: 'module' } : undefined;
      this.worker = workerOpts
        ? new Worker(this.scriptPath, workerOpts)
        : new Worker(this.scriptPath);
    } catch (err) {
      console.error('Engine worker failed to start:', err);
      throw err;
    }

    // Strict lifecycle flags (lichess pattern):
    //   uciokReceived — gates _send(); anything before uciok is dropped
    //   stopRequested — set by stop(); info lines from the old search
    //                   are ignored until bestmove arrives to re-arm.
    // Violating either of these is the documented cause of Stockfish
    // WASM "RuntimeError: unreachable" (assertion failure).
    this.uciokReceived = false;
    this.stopRequested = false;

    this.worker.onmessage = (e) => this._handleLine(e.data);
    this.worker.onerror   = (e) => {
      console.error('Stockfish worker error:', e);
      this.dispatchEvent(new CustomEvent('error', { detail: e }));
    };

    // Capture the 'id name' line during UCI handshake for later display
    const idCapture = (ev) => {
      const line = ev.data;
      if (typeof line === 'string' && line.startsWith('id name')) {
        this.uciId = line.slice(8).trim();
      }
    };
    this.worker.addEventListener('message', idCapture);

    this._send('uci');
    // Enforce a hard 15-second boot timeout. If the WASM never initialises
    // (e.g. bad build, browser incompat), surface a clear error instead of
    // leaving the UI stuck on "booting…".
    const bootTimeoutMs = 15000;
    let timedOut = false;
    const waitPromise = this._waitFor('uciok');
    const timeoutPromise = new Promise((_r, rej) => {
      setTimeout(() => { timedOut = true; rej(new Error(`UCI handshake timed out after ${bootTimeoutMs/1000}s — variant may be broken`)); }, bootTimeoutMs);
    });
    // Reject boot IMMEDIATELY on a worker-level crash (WASM unreachable,
    // bad bytes, etc.) instead of waiting out the full timeout. Lets
    // main.js's auto-fallback kick in within milliseconds.
    const crashPromise = new Promise((_r, rej) => {
      const prev = this.worker.onerror;
      this.worker.onerror = (e) => {
        if (typeof prev === 'function') prev(e);
        const msg = (e && (e.message || e.error?.message)) || 'Stockfish worker crashed';
        rej(new Error(`Engine '${flavor}' crashed: ${msg}`));
      };
    });
    try {
      await Promise.race([waitPromise, timeoutPromise, crashPromise]);
    } finally {
      this.worker.removeEventListener('message', idCapture);
    }
    if (timedOut) { this.terminate(); throw new Error(`Engine '${flavor}' failed to boot within ${bootTimeoutMs/1000}s`); }
    this._send(`setoption name MultiPV value ${this.multipv}`);
    this._send(`setoption name Threads value ${this.threads}`);
    this._send(`setoption name Hash value ${this.hashMB}`);  // transposition-table size
    this._send('setoption name UCI_AnalyseMode value true'); // cleaner analysis output
    this._send('setoption name Use NNUE value true');        // belt-and-braces
    this._send(`setoption name Skill Level value ${this.skill}`);

    // External-NNUE flavors (e.g. sf-fast using lichess stockfish-web):
    // load the smallnet IMMEDIATELY so the engine is usable fast, then
    // background-fetch the bignet and hot-swap via EvalFile setoption.
    if (spec.externalNnue) {
      this._send(`setoption name EvalFile value ${spec.externalNnue.small}`);
      this.activeNet = 'small';
      this._swapToBignetWhenReady(spec.externalNnue.big);
    }

    this._send('isready');
    await this._waitFor('readyok');
    this.ready = true;
    this.dispatchEvent(new CustomEvent('ready', {
      detail: { flavor, threaded: spec.threaded, threads: this.threads, activeNet: this.activeNet || null }
    }));
    return { flavor, threaded: spec.threaded, threads: this.threads };
  }

  /**
   * Background-fetch the big NNUE and hot-swap via UCI setoption.
   * Fire-and-forget — failure just means we keep using smallnet.
   */
  async _swapToBignetWhenReady(bigUrl) {
    try {
      // Prime the browser HTTP cache with a warm fetch so the engine's
      // subsequent open of EvalFile completes instantly. The actual
      // file load happens in the WASM worker when we post setoption.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort('timeout'), 5 * 60 * 1000);
      const resp = await fetch(bigUrl, { signal: ctrl.signal, priority: 'low' });
      clearTimeout(timer);
      if (!resp.ok) return;
      await resp.arrayBuffer().catch(() => {});
      // Only swap if we haven't been terminated in the meantime and
      // no search is in flight (switching EvalFile mid-search is a
      // UCI spec violation).
      if (!this.worker) return;
      if (this.searching) {
        // Defer until current search ends.
        const onDone = () => {
          this.removeEventListener('bestmove', onDone);
          if (this.worker && !this.searching) this._actuallySwapToBig(bigUrl);
        };
        this.addEventListener('bestmove', onDone);
        return;
      }
      this._actuallySwapToBig(bigUrl);
    } catch {}
  }

  _actuallySwapToBig(bigUrl) {
    this._send(`setoption name EvalFile value ${bigUrl}`);
    this._send('isready');
    this.activeNet = 'big';
    this.dispatchEvent(new CustomEvent('nnue-swapped', { detail: { activeNet: 'big' } }));
    console.log('[engine] hot-swapped to bignet');
  }

  /** Tear down the worker — for switching engine flavor. */
  terminate() {
    this.stop();
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.ready = false;
  }

  setMultiPV(n) {
    this.multipv = n;
    if (this.ready) this._send(`setoption name MultiPV value ${n}`);
  }

  setSkill(level) {
    this.skill = level;
    if (this.ready) this._send(`setoption name Skill Level value ${level}`);
  }

  setThreads(n) {
    this.threads = n;
    if (this.ready) this._send(`setoption name Threads value ${n}`);
  }

  /** Resize Stockfish's transposition table ("hash"). Unit = MB. */
  setHash(mb) {
    this.hashMB = Math.max(1, +mb | 0);
    if (this.ready) this._send(`setoption name Hash value ${this.hashMB}`);
  }

  /** Clear the transposition table — forgets all previously-analysed
   *  positions. Sent as UCI `ucinewgame` which Stockfish treats as
   *  "new game, wipe cache". */
  clearHash() {
    if (!this.ready) return;
    this._send('ucinewgame');
    this._send('isready');
  }

  _send(cmd) {
    if (!this.worker) return;
    // Pre-uciok gate: was blocking LEGITIMATE commands in practice when
    // a clear uciok-reset path exists. The narrower, safer guard: drop
    // only commands issued before we've even posted 'uci' (worker not
    // yet attempting handshake). Once 'uci' has been sent, Stockfish's
    // own handshake handles queued commands fine.
    if (this.uciSent && !this.uciokReceived && cmd !== 'uci') {
      // Worker is still in the narrow handshake window. It's safe to
      // queue setoption/position/go — Stockfish buffers them and
      // processes after uciok. Only block 'stop' which can actually
      // trip an assertion if received mid-init.
      if (cmd === 'stop') { console.log('[engine] dropped pre-uciok stop'); return; }
    }
    if (cmd === 'uci') this.uciSent = true;
    this.worker.postMessage(cmd);
  }

  _waitFor(token) {
    return new Promise((resolve) => {
      const wrapped = (e) => {
        const line = e.data;
        if (typeof line === 'string' && line.includes(token)) {
          this.worker.removeEventListener('message', wrapped);
          resolve();
        }
      };
      this.worker.addEventListener('message', wrapped);
    });
  }

  /**
   * @param {string} fen
   * @param {{depth?:number, movetime?:number, searchmoves?:string[]}} opts
   */
  start(fen, opts = {}) {
    if (!this.ready) return;
    if (this.searching) this.stop();

    this.history  = [];
    this.topMoves = new Map();
    this.searching = true;
    // Track the FEN currently under search so downstream consumers
    // (eval cache, explainers) can pair events with the right position
    // even if the live board moves on while we're searching.
    this.currentFen = fen;

    this._send(`position fen ${fen}`);

    const bits = ['go'];
    if (opts.infinite) {
      bits.push('infinite');
    } else {
      if (opts.depth)    bits.push('depth', String(opts.depth));
      if (opts.movetime) bits.push('movetime', String(opts.movetime));
      if (!opts.depth && !opts.movetime) bits.push('depth', '18');
    }
    if (opts.searchmoves && opts.searchmoves.length)
      bits.push('searchmoves', ...opts.searchmoves);
    this._send(bits.join(' '));
  }

  stop() {
    if (!this.worker) return;
    // Set stopRequested BEFORE sending stop so any info line in the
    // worker's outbound queue that arrives after we post stop is
    // ignored. Cleared when bestmove arrives (in _handleLine).
    if (this.searching) this.stopRequested = true;
    this._send('stop');
    this.searching = false;
  }

  /** Analyse one specific move. Used for the "why not X?" feature. */
  analyseMove(fen, uciMove, depth = 14) {
    return new Promise((resolve) => {
      if (!this.ready) return resolve(null);
      if (this.searching) this.stop();

      const originalMultiPV = this.multipv;
      this._send('setoption name MultiPV value 1');

      this.topMoves = new Map();
      this.history  = [];
      this.searching = true;

      const onBest = (ev) => {
        this.removeEventListener('bestmove', onBest);
        this._send(`setoption name MultiPV value ${originalMultiPV}`);
        resolve(ev.detail);
      };
      this.addEventListener('bestmove', onBest);

      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth} searchmoves ${uciMove}`);
    });
  }

  _handleLine(line) {
    if (typeof line !== 'string') return;

    // First, latch uciok as early as possible so subsequent _send()
    // calls stop being blocked by the pre-uciok gate.
    if (line.startsWith('uciok')) this.uciokReceived = true;

    if (line.startsWith('info')) {
      // Drop info lines that arrive AFTER we've asked to stop. They
      // belong to the old search; using them mutates state under a
      // position the UI has moved on from.
      if (this.stopRequested) return;
      const info = parseInfo(line);
      if (!info || info.pv == null) return;

      this.topMoves.set(info.multipv, info);

      if (info.multipv === 1) {
        this.history.push({
          depth:     info.depth,
          score:     info.score,
          scoreKind: info.scoreKind,
          best:      info.pv[0],
          pv:        info.pv,
          time:      info.time,
          nodes:     info.nodes,
          nps:       info.nps,
        });
      }

      this.dispatchEvent(new CustomEvent('thinking', {
        detail: {
          info,
          topMoves: Array.from(this.topMoves.values())
                         .sort((a, b) => a.multipv - b.multipv),
          history:  this.history,
        }
      }));
    }
    else if (line.startsWith('bestmove')) {
      this.searching = false;
      // bestmove always clears the stop guard — a new search is safe
      // to start from this point.
      this.stopRequested = false;
      const m = line.match(/^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/);
      const detail = {
        best:     m ? m[1] : null,
        ponder:   m ? m[2] : null,
        topMoves: Array.from(this.topMoves.values())
                       .sort((a, b) => a.multipv - b.multipv),
        history:  this.history,
      };
      console.log('[engine] bestmove', detail.best);
      this.dispatchEvent(new CustomEvent('bestmove', { detail }));
    }
  }
}

export function parseInfo(line) {
  const tokens = line.split(/\s+/);
  if (tokens[0] !== 'info') return null;

  const out = {
    depth: 0, seldepth: 0, multipv: 1,
    score: 0, scoreKind: 'cp',
    nodes: 0, nps: 0, time: 0, pv: null,
  };

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t) {
      case 'depth':     out.depth    = +tokens[++i]; break;
      case 'seldepth':  out.seldepth = +tokens[++i]; break;
      case 'multipv':   out.multipv  = +tokens[++i]; break;
      case 'nodes':     out.nodes    = +tokens[++i]; break;
      case 'nps':       out.nps      = +tokens[++i]; break;
      case 'time':      out.time     = +tokens[++i]; break;
      case 'hashfull':  out.hashfull = +tokens[++i]; break;
      case 'tbhits':    out.tbhits   = +tokens[++i]; break;
      case 'score':
        out.scoreKind = tokens[++i];
        out.score     = +tokens[++i];
        if (tokens[i+1] === 'lowerbound' || tokens[i+1] === 'upperbound') {
          out.bound = tokens[++i];
        }
        break;
      case 'pv':
        out.pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
    }
  }

  if (!out.pv) return null;
  return out;
}
