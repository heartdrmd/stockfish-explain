// openings.js — curated list of openings + variants for forced-start tournaments.
// Organized by main opening, with named sub-variations. Each entry stores a
// SAN move sequence that defines the starting position for the game.

export const OPENINGS = [
  {
    group: '— (no forced opening) —',
    items: [
      { name: 'No opening — start from move 1', moves: [] },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  1.e4 e5  — Open Games
  // ═══════════════════════════════════════════════════════════════════
  {
    group: 'Ruy Lopez / Spanish (1.e4 e5 2.Nf3 Nc6 3.Bb5)',
    items: [
      { name: 'Morphy Defense (3...a6)',                      moves: ['e4','e5','Nf3','Nc6','Bb5','a6'] },
      { name: 'Closed Main Line',                              moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6'] },
      { name: 'Closed · Breyer Defense',                       moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6','c3','O-O','h3','Nb8'] },
      { name: 'Closed · Chigorin Defense',                     moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6','c3','O-O','h3','Na5'] },
      { name: 'Closed · Zaitsev',                              moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6','c3','O-O','h3','Bb7'] },
      { name: 'Closed · Smyslov/Karpov',                       moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6','c3','O-O','h3','Nd7'] },
      { name: 'Marshall Attack',                               moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','O-O','c3','d5'] },
      { name: 'Anti-Marshall · 8.h3',                          moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','O-O','h3'] },
      { name: 'Anti-Marshall · 8.a4',                          moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','O-O','a4'] },
      { name: 'Berlin Defense (3...Nf6)',                      moves: ['e4','e5','Nf3','Nc6','Bb5','Nf6'] },
      { name: 'Berlin Wall · Classical Endgame',               moves: ['e4','e5','Nf3','Nc6','Bb5','Nf6','O-O','Nxe4','d4','Nd6','Bxc6','dxc6','dxe5','Nf5','Qxd8+','Kxd8'] },
      { name: 'Berlin · 4.d3',                                 moves: ['e4','e5','Nf3','Nc6','Bb5','Nf6','d3'] },
      { name: 'Open Defense (5...Nxe4)',                       moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Nxe4'] },
      { name: 'Open · Dilworth',                               moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Nxe4','d4','b5','Bb3','d5','dxe5','Be6','c3','Bc5','Nbd2','O-O','Bc2','Nxf2'] },
      { name: 'Exchange Variation (4.Bxc6)',                   moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Bxc6','dxc6'] },
      { name: 'Exchange · Alekhine',                           moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Bxc6','dxc6','O-O'] },
      { name: 'Steinitz Defense (3...d6)',                     moves: ['e4','e5','Nf3','Nc6','Bb5','d6'] },
      { name: 'Steinitz Deferred (4...d6)',                    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','d6'] },
      { name: 'Modern Steinitz (4...d6 5.c3)',                 moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','d6','c3'] },
      { name: 'Schliemann / Jaenisch (3...f5)',                moves: ['e4','e5','Nf3','Nc6','Bb5','f5'] },
      { name: 'Bird Defense (3...Nd4)',                        moves: ['e4','e5','Nf3','Nc6','Bb5','Nd4'] },
      { name: 'Classical Defense (3...Bc5)',                   moves: ['e4','e5','Nf3','Nc6','Bb5','Bc5'] },
      { name: 'Cozio Defense (3...Nge7)',                      moves: ['e4','e5','Nf3','Nc6','Bb5','Nge7'] },
      { name: 'Archangelsk (6...Bb7)',                          moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','b5','Bb3','Bb7'] },
      { name: 'Modern Archangelsk (6...Bc5)',                   moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','b5','Bb3','Bc5'] },
      { name: 'Worrall Attack (5.Qe2)',                          moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','Qe2'] },
    ],
  },
  {
    group: 'Italian Game (1.e4 e5 2.Nf3 Nc6 3.Bc4)',
    items: [
      { name: 'Giuoco Piano (3...Bc5)',                        moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5'] },
      { name: 'Giuoco Pianissimo',                              moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5','d3','Nf6','O-O','d6','c3'] },
      { name: 'Giuoco Piano · Main Line',                       moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5','c3','Nf6','d4','exd4','cxd4','Bb4+'] },
      { name: 'Evans Gambit (Accepted)',                        moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5','b4','Bxb4'] },
      { name: 'Evans Gambit Declined',                          moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5','b4','Bb6'] },
      { name: 'Two Knights Defense',                            moves: ['e4','e5','Nf3','Nc6','Bc4','Nf6'] },
      { name: 'Two Knights · Fried Liver',                      moves: ['e4','e5','Nf3','Nc6','Bc4','Nf6','Ng5','d5','exd5','Nxd5','Nxf7'] },
      { name: 'Two Knights · Traxler Counter',                  moves: ['e4','e5','Nf3','Nc6','Bc4','Nf6','Ng5','Bc5'] },
      { name: 'Two Knights · Modern (8...Na5)',                 moves: ['e4','e5','Nf3','Nc6','Bc4','Nf6','Ng5','d5','exd5','Na5'] },
      { name: 'Hungarian Defense (3...Be7)',                    moves: ['e4','e5','Nf3','Nc6','Bc4','Be7'] },
      { name: 'Scotch Game',                                     moves: ['e4','e5','Nf3','Nc6','d4','exd4','Nxd4'] },
      { name: 'Scotch · Classical (4...Bc5)',                   moves: ['e4','e5','Nf3','Nc6','d4','exd4','Nxd4','Bc5'] },
      { name: 'Scotch · Mieses (4...Nf6 5.Nxc6)',               moves: ['e4','e5','Nf3','Nc6','d4','exd4','Nxd4','Nf6','Nxc6','bxc6','e5'] },
      { name: 'Scotch · Schmidt',                                moves: ['e4','e5','Nf3','Nc6','d4','exd4','Nxd4','Nf6'] },
      { name: 'Scotch · Steinitz (4...Qh4)',                    moves: ['e4','e5','Nf3','Nc6','d4','exd4','Nxd4','Qh4'] },
      { name: 'Scotch Gambit',                                   moves: ['e4','e5','Nf3','Nc6','d4','exd4','Bc4'] },
      { name: 'Scotch Gambit · Möller',                          moves: ['e4','e5','Nf3','Nc6','d4','exd4','Bc4','Bc5','c3','Nf6','e5'] },
      { name: 'Ponziani (3.c3)',                                 moves: ['e4','e5','Nf3','Nc6','c3'] },
    ],
  },
  {
    group: 'Other Open Games (1.e4 e5)',
    items: [
      { name: 'Petroff · Classical',                             moves: ['e4','e5','Nf3','Nf6','Nxe5','d6','Nf3','Nxe4','d4'] },
      { name: 'Petroff · Main Line (6...Bd6)',                   moves: ['e4','e5','Nf3','Nf6','Nxe5','d6','Nf3','Nxe4','d4','d5','Bd3','Bd6'] },
      { name: 'Petroff · Nimzowitsch (5.Nc3)',                   moves: ['e4','e5','Nf3','Nf6','Nxe5','d6','Nf3','Nxe4','Nc3'] },
      { name: 'Four Knights · Spanish',                           moves: ['e4','e5','Nf3','Nc6','Nc3','Nf6','Bb5'] },
      { name: 'Four Knights · Italian',                           moves: ['e4','e5','Nf3','Nc6','Nc3','Nf6','Bc4'] },
      { name: 'Four Knights · Scotch',                            moves: ['e4','e5','Nf3','Nc6','Nc3','Nf6','d4'] },
      { name: 'Three Knights',                                    moves: ['e4','e5','Nf3','Nc6','Nc3'] },
      { name: "King's Gambit Accepted (KGA)",                    moves: ['e4','e5','f4','exf4'] },
      { name: "KGA · Kieseritzky (5.Ne5)",                       moves: ['e4','e5','f4','exf4','Nf3','g5','h4','g4','Ne5'] },
      { name: "KGA · Muzio (5.O-O)",                              moves: ['e4','e5','f4','exf4','Nf3','g5','Bc4','g4','O-O'] },
      { name: "KGA · Fischer Defense (3...d6)",                  moves: ['e4','e5','f4','exf4','Nf3','d6'] },
      { name: "KGA · Modern (3...d5)",                            moves: ['e4','e5','f4','exf4','Nf3','d5'] },
      { name: "KGD · Classical (2...Bc5)",                        moves: ['e4','e5','f4','Bc5'] },
      { name: "KGD · Falkbeer Counter",                           moves: ['e4','e5','f4','d5'] },
      { name: 'Vienna Game (2.Nc3)',                              moves: ['e4','e5','Nc3'] },
      { name: 'Vienna · Falkbeer',                                moves: ['e4','e5','Nc3','Nf6'] },
      { name: 'Vienna Gambit (3.f4)',                             moves: ['e4','e5','Nc3','Nf6','f4'] },
      { name: "Philidor Defense (2...d6)",                        moves: ['e4','e5','Nf3','d6'] },
      { name: 'Philidor · Hanham',                                moves: ['e4','e5','Nf3','d6','d4','Nd7'] },
      { name: 'Latvian Gambit',                                    moves: ['e4','e5','Nf3','f5'] },
      { name: 'Elephant Gambit',                                   moves: ['e4','e5','Nf3','d5'] },
      { name: 'Center Game',                                       moves: ['e4','e5','d4','exd4','Qxd4'] },
      { name: 'Danish Gambit',                                     moves: ['e4','e5','d4','exd4','c3'] },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  Sicilian Defense (1.e4 c5)
  // ═══════════════════════════════════════════════════════════════════
  {
    group: 'Sicilian · Najdorf (2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6)',
    items: [
      { name: 'English Attack (6.Be3)',                            moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Be3'] },
      { name: 'English Attack · 6.Be3 e5',                         moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Be3','e5'] },
      { name: 'English Attack · Perenyi Gambit',                   moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Be3','e6','g4','e5','Nf5'] },
      { name: '6.Bg5 (Main Line)',                                 moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Bg5'] },
      { name: '6.Bg5 · Polugaevsky',                                moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Bg5','e6','f4','b5'] },
      { name: '6.Bg5 · Poisoned Pawn',                              moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Bg5','e6','f4','Qb6'] },
      { name: '6.Be2 (Classical)',                                  moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Be2'] },
      { name: '6.Bc4 (Fischer-Sozin)',                              moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Bc4'] },
      { name: '6.f3 (Adams Attack)',                                moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','f3'] },
      { name: '6.h3 (Adams Modern)',                                moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','h3'] },
      { name: '6.f4 (Amsterdam)',                                    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','f4'] },
    ],
  },
  {
    group: 'Sicilian · Dragon / Accelerated',
    items: [
      { name: 'Dragon (5...g6)',                                     moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','g6'] },
      { name: 'Dragon · Yugoslav Attack',                            moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','g6','Be3','Bg7','f3','O-O','Qd2','Nc6','Bc4'] },
      { name: 'Dragon · Yugoslav · 9.Bc4',                           moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','g6','Be3','Bg7','f3','O-O','Qd2','Nc6','O-O-O'] },
      { name: 'Dragon · Classical (6.Be2)',                          moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','g6','Be2'] },
      { name: 'Accelerated Dragon',                                   moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','g6'] },
      { name: 'Accelerated · Maroczy Bind',                           moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','g6','c4'] },
      { name: 'Hyper-Accelerated Dragon (2...g6)',                   moves: ['e4','c5','Nf3','g6'] },
    ],
  },
  {
    group: 'Sicilian · Scheveningen / Keres / Kan / Taimanov',
    items: [
      { name: 'Scheveningen (5...e6)',                                moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','e6'] },
      { name: 'Keres Attack (6.g4)',                                  moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','e6','g4'] },
      { name: 'English Attack (6.Be3 e6)',                            moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','e6','Be3'] },
      { name: 'Taimanov (4...Nc6)',                                   moves: ['e4','c5','Nf3','e6','d4','cxd4','Nxd4','Nc6'] },
      { name: 'Taimanov · English Attack',                            moves: ['e4','c5','Nf3','e6','d4','cxd4','Nxd4','Nc6','Nc3','Qc7','Be3','a6','Qd2'] },
      { name: 'Kan (4...a6)',                                         moves: ['e4','c5','Nf3','e6','d4','cxd4','Nxd4','a6'] },
      { name: 'Kan · Maroczy Bind',                                   moves: ['e4','c5','Nf3','e6','d4','cxd4','Nxd4','a6','c4'] },
      { name: 'Four Knights (2...e6 3.Nc3 Nc6 4.Nf3)',                moves: ['e4','c5','Nf3','e6','Nc3','Nc6','d4','cxd4','Nxd4','Nf6'] },
      { name: 'Paulsen / Modern (2...e6)',                             moves: ['e4','c5','Nf3','e6'] },
    ],
  },
  {
    group: 'Sicilian · Classical / Sveshnikov',
    items: [
      { name: 'Classical (5...Nc6)',                                  moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','Nc6'] },
      { name: 'Classical · Richter-Rauzer',                           moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','Nc6','Bg5'] },
      { name: 'Sveshnikov (5...e5)',                                  moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','Nf6','Nc3','e5'] },
      { name: 'Sveshnikov · Chelyabinsk',                              moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','Nf6','Nc3','e5','Ndb5','d6','Bg5','a6','Na3','b5'] },
      { name: 'Kalashnikov (4...e5)',                                 moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','e5'] },
      { name: 'Lowenthal (4...e5 5.Nb5 a6)',                          moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','e5','Nb5','a6'] },
    ],
  },
  {
    group: 'Sicilian · Anti-Sicilian',
    items: [
      { name: 'Alapin (2.c3)',                                         moves: ['e4','c5','c3'] },
      { name: 'Alapin · 2...d5',                                       moves: ['e4','c5','c3','d5','exd5','Qxd5'] },
      { name: 'Alapin · 2...Nf6',                                      moves: ['e4','c5','c3','Nf6'] },
      { name: 'Closed Sicilian (2.Nc3)',                                moves: ['e4','c5','Nc3'] },
      { name: 'Closed · Grand Prix Attack',                             moves: ['e4','c5','Nc3','Nc6','f4'] },
      { name: 'Rossolimo (3.Bb5)',                                     moves: ['e4','c5','Nf3','Nc6','Bb5'] },
      { name: 'Moscow (3.Bb5+)',                                       moves: ['e4','c5','Nf3','d6','Bb5+'] },
      { name: 'Smith-Morra Gambit',                                    moves: ['e4','c5','d4','cxd4','c3'] },
      { name: "O'Kelly (2...a6)",                                      moves: ['e4','c5','Nf3','a6'] },
      { name: 'Nimzowitsch (2...Nf6)',                                 moves: ['e4','c5','Nf3','Nf6'] },
      { name: 'Wing Gambit',                                           moves: ['e4','c5','b4'] },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  1.e4 — Other Defenses
  // ═══════════════════════════════════════════════════════════════════
  {
    group: 'French Defense (1.e4 e6)',
    items: [
      { name: 'Main · 2.d4 d5',                                       moves: ['e4','e6','d4','d5'] },
      { name: 'Classical (3.Nc3 Nf6)',                                moves: ['e4','e6','d4','d5','Nc3','Nf6'] },
      { name: 'Classical · Steinitz (4.e5)',                          moves: ['e4','e6','d4','d5','Nc3','Nf6','e5','Nfd7'] },
      { name: 'Classical · Boleslavsky (4.Bg5)',                      moves: ['e4','e6','d4','d5','Nc3','Nf6','Bg5'] },
      { name: 'MacCutcheon (4.Bg5 Bb4)',                              moves: ['e4','e6','d4','d5','Nc3','Nf6','Bg5','Bb4'] },
      { name: 'Winawer (3...Bb4)',                                    moves: ['e4','e6','d4','d5','Nc3','Bb4'] },
      { name: 'Winawer · Main Line',                                  moves: ['e4','e6','d4','d5','Nc3','Bb4','e5','c5','a3','Bxc3+','bxc3','Ne7'] },
      { name: 'Winawer · Poisoned Pawn',                              moves: ['e4','e6','d4','d5','Nc3','Bb4','e5','c5','a3','Bxc3+','bxc3','Ne7','Qg4'] },
      { name: 'Tarrasch (3.Nd2)',                                     moves: ['e4','e6','d4','d5','Nd2'] },
      { name: 'Tarrasch · Open (3...c5)',                             moves: ['e4','e6','d4','d5','Nd2','c5'] },
      { name: 'Tarrasch · Closed (3...Nf6)',                          moves: ['e4','e6','d4','d5','Nd2','Nf6','e5','Nfd7'] },
      { name: 'Advance (3.e5)',                                       moves: ['e4','e6','d4','d5','e5'] },
      { name: 'Advance · Milner-Barry Gambit',                        moves: ['e4','e6','d4','d5','e5','c5','c3','Nc6','Nf3','Qb6','Bd3'] },
      { name: 'Exchange (3.exd5 exd5)',                               moves: ['e4','e6','d4','d5','exd5','exd5'] },
      { name: 'Exchange · Monte Carlo',                                moves: ['e4','e6','d4','d5','exd5','exd5','Bd3'] },
      { name: 'Rubinstein (3...dxe4)',                                moves: ['e4','e6','d4','d5','Nc3','dxe4'] },
      { name: "King's Indian Attack vs French",                       moves: ['e4','e6','d3'] },
    ],
  },
  {
    group: 'Caro-Kann Defense (1.e4 c6)',
    items: [
      { name: 'Main · 2.d4 d5',                                       moves: ['e4','c6','d4','d5'] },
      { name: 'Classical (4...Bf5)',                                  moves: ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Bf5'] },
      { name: 'Classical · 7.Nf3',                                    moves: ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Bf5','Ng3','Bg6','h4','h6','Nf3'] },
      { name: 'Karpov (4...Nd7)',                                     moves: ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nd7'] },
      { name: 'Bronstein-Larsen (4...Nf6)',                           moves: ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nf6','Nxf6+','gxf6'] },
      { name: 'Advance (3.e5)',                                       moves: ['e4','c6','d4','d5','e5'] },
      { name: 'Advance · Main Line (3...Bf5)',                        moves: ['e4','c6','d4','d5','e5','Bf5'] },
      { name: 'Advance · Short Variation',                            moves: ['e4','c6','d4','d5','e5','Bf5','Nf3','e6','Be2'] },
      { name: 'Exchange',                                             moves: ['e4','c6','d4','d5','exd5','cxd5'] },
      { name: 'Panov Attack',                                          moves: ['e4','c6','d4','d5','exd5','cxd5','c4'] },
      { name: 'Panov · Main Line',                                     moves: ['e4','c6','d4','d5','exd5','cxd5','c4','Nf6','Nc3','Nc6','Nf3','Bg4'] },
      { name: 'Two Knights (2.Nc3)',                                   moves: ['e4','c6','Nc3','d5','Nf3'] },
      { name: 'Fantasy Variation (3.f3)',                              moves: ['e4','c6','d4','d5','f3'] },
    ],
  },
  {
    group: 'Other 1.e4 Defenses',
    items: [
      { name: 'Scandinavian · 2...Qxd5',                               moves: ['e4','d5','exd5','Qxd5'] },
      { name: 'Scandinavian · Main Line',                              moves: ['e4','d5','exd5','Qxd5','Nc3','Qa5'] },
      { name: 'Scandinavian · Modern (2...Nf6)',                       moves: ['e4','d5','exd5','Nf6'] },
      { name: 'Alekhine Defense',                                      moves: ['e4','Nf6'] },
      { name: 'Alekhine · Modern',                                     moves: ['e4','Nf6','e5','Nd5','d4','d6'] },
      { name: 'Alekhine · Four Pawns Attack',                          moves: ['e4','Nf6','e5','Nd5','d4','d6','c4','Nb6','f4'] },
      { name: 'Pirc Defense',                                          moves: ['e4','d6','d4','Nf6','Nc3','g6'] },
      { name: 'Pirc · Austrian Attack',                                moves: ['e4','d6','d4','Nf6','Nc3','g6','f4'] },
      { name: 'Pirc · Classical',                                      moves: ['e4','d6','d4','Nf6','Nc3','g6','Nf3','Bg7','Be2'] },
      { name: 'Modern Defense (1...g6)',                               moves: ['e4','g6','d4','Bg7'] },
      { name: 'Nimzowitsch Defense (1...Nc6)',                         moves: ['e4','Nc6'] },
      { name: 'Owen Defense',                                          moves: ['e4','b6'] },
      { name: 'St. George Defense',                                    moves: ['e4','a6'] },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  1.d4 — Queen's Pawn Openings
  // ═══════════════════════════════════════════════════════════════════
  {
    group: "Queen's Gambit (1.d4 d5 2.c4)",
    items: [
      { name: 'QGD · Orthodox',                                        moves: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7'] },
      { name: 'QGD · Lasker Defense',                                  moves: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O','Nf3','Ne4'] },
      { name: 'QGD · Tartakower',                                      moves: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O','Nf3','h6','Bh4','b6'] },
      { name: 'QGD · Cambridge Springs',                               moves: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Nbd7','Nf3','c6','e3','Qa5'] },
      { name: 'QGD · Exchange Variation',                              moves: ['d4','d5','c4','e6','Nc3','Nf6','cxd5','exd5'] },
      { name: 'QGD · Exchange · Minority Attack',                      moves: ['d4','d5','c4','e6','Nc3','Nf6','cxd5','exd5','Bg5','c6','Qc2','Be7','e3','Nbd7','Bd3','O-O','Nf3','Re8','O-O','Nf8','Rab1'] },
      { name: 'QGD · Ragozin',                                         moves: ['d4','d5','c4','e6','Nc3','Nf6','Nf3','Bb4'] },
      { name: 'QGD · Vienna',                                          moves: ['d4','d5','c4','e6','Nc3','Nf6','Nf3','dxc4','e4'] },
      { name: 'QGA',                                                    moves: ['d4','d5','c4','dxc4'] },
      { name: 'QGA · Classical',                                        moves: ['d4','d5','c4','dxc4','e4'] },
      { name: 'QGA · Main Line',                                        moves: ['d4','d5','c4','dxc4','Nf3','Nf6','e3','e6','Bxc4'] },
      { name: 'Slav Defense',                                            moves: ['d4','d5','c4','c6'] },
      { name: 'Slav · Main Line',                                        moves: ['d4','d5','c4','c6','Nf3','Nf6','Nc3','dxc4','a4','Bf5'] },
      { name: 'Slav · Exchange',                                         moves: ['d4','d5','c4','c6','cxd5','cxd5'] },
      { name: 'Slav · Chebanenko',                                       moves: ['d4','d5','c4','c6','Nf3','Nf6','Nc3','a6'] },
      { name: 'Semi-Slav',                                                moves: ['d4','d5','c4','c6','Nf3','Nf6','Nc3','e6'] },
      { name: 'Semi-Slav · Meran',                                        moves: ['d4','d5','c4','c6','Nf3','Nf6','Nc3','e6','e3','Nbd7','Bd3','dxc4','Bxc4','b5'] },
      { name: 'Semi-Slav · Botvinnik',                                    moves: ['d4','d5','c4','c6','Nf3','Nf6','Nc3','e6','Bg5','dxc4','e4'] },
      { name: 'Semi-Slav · Anti-Moscow',                                  moves: ['d4','d5','c4','c6','Nf3','Nf6','Nc3','e6','Bg5','h6','Bxf6','Qxf6'] },
      { name: 'Tarrasch Defense',                                         moves: ['d4','d5','c4','e6','Nc3','c5'] },
      { name: 'Tarrasch · Rubinstein',                                    moves: ['d4','d5','c4','e6','Nc3','c5','cxd5','exd5','Nf3','Nc6','g3'] },
      { name: 'Semi-Tarrasch',                                             moves: ['d4','d5','c4','e6','Nc3','Nf6','Nf3','c5'] },
      { name: 'Albin Counter-Gambit',                                      moves: ['d4','d5','c4','e5'] },
      { name: 'Chigorin Defense',                                          moves: ['d4','d5','c4','Nc6'] },
    ],
  },
  {
    group: 'Indian Defenses (1.d4 Nf6)',
    items: [
      { name: "King's Indian · Classical (9.Be2 e5)",                     moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5'] },
      { name: "KID · Mar del Plata",                                       moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5','O-O','Nc6','d5','Ne7'] },
      { name: "KID · Sämisch (5.f3)",                                      moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','f3'] },
      { name: "KID · Fianchetto",                                          moves: ['d4','Nf6','c4','g6','Nc3','Bg7','g3'] },
      { name: "KID · Four Pawns Attack",                                   moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','f4'] },
      { name: "KID · Averbakh",                                            moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Be2','O-O','Bg5'] },
      { name: "KID · Petrosian",                                           moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5','d5'] },
      { name: "KID · Bayonet Attack (9.b4)",                               moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5','O-O','Nc6','d5','Ne7','b4'] },
      { name: "KID · Makogonov (5.h3)",                                     moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','h3'] },
      { name: "KID · Gligoric (7.Be3)",                                     moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5','Be3'] },
      { name: 'Grünfeld · Exchange',                                       moves: ['d4','Nf6','c4','g6','Nc3','d5','cxd5','Nxd5','e4','Nxc3','bxc3'] },
      { name: 'Grünfeld · Russian System',                                 moves: ['d4','Nf6','c4','g6','Nc3','d5','Nf3','Bg7','Qb3'] },
      { name: 'Grünfeld · Fianchetto',                                     moves: ['d4','Nf6','c4','g6','Nc3','d5','Nf3','Bg7','g3'] },
      { name: 'Grünfeld · 4.Bf4',                                           moves: ['d4','Nf6','c4','g6','Nc3','d5','Bf4'] },
      { name: 'Nimzo-Indian · Classical (4.Qc2)',                          moves: ['d4','Nf6','c4','e6','Nc3','Bb4','Qc2'] },
      { name: 'Nimzo-Indian · Rubinstein (4.e3)',                          moves: ['d4','Nf6','c4','e6','Nc3','Bb4','e3'] },
      { name: 'Nimzo · Sämisch (4.a3)',                                     moves: ['d4','Nf6','c4','e6','Nc3','Bb4','a3'] },
      { name: 'Nimzo · Leningrad (4.Bg5)',                                  moves: ['d4','Nf6','c4','e6','Nc3','Bb4','Bg5'] },
      { name: 'Nimzo · Kasparov (4.Nf3)',                                   moves: ['d4','Nf6','c4','e6','Nc3','Bb4','Nf3'] },
      { name: 'Nimzo · Hübner (4.e3 c5 5.Bd3 Nc6 6.Nf3 Bxc3+)',              moves: ['d4','Nf6','c4','e6','Nc3','Bb4','e3','c5','Bd3','Nc6','Nf3','Bxc3+','bxc3','d6'] },
      { name: "Queen's Indian Defense",                                    moves: ['d4','Nf6','c4','e6','Nf3','b6'] },
      { name: "QID · Classical (4.g3)",                                     moves: ['d4','Nf6','c4','e6','Nf3','b6','g3'] },
      { name: "QID · Petrosian (4.a3)",                                     moves: ['d4','Nf6','c4','e6','Nf3','b6','a3'] },
      { name: "QID · Fianchetto Main (4.g3 Ba6)",                            moves: ['d4','Nf6','c4','e6','Nf3','b6','g3','Ba6'] },
      { name: "QID · Fianchetto · Classical (4.g3 Bb7)",                     moves: ['d4','Nf6','c4','e6','Nf3','b6','g3','Bb7'] },
      { name: 'Bogo-Indian',                                                moves: ['d4','Nf6','c4','e6','Nf3','Bb4+'] },
      { name: 'Benoni · Modern (3.d5 e6)',                                  moves: ['d4','Nf6','c4','c5','d5','e6'] },
      { name: 'Benoni · Taimanov',                                          moves: ['d4','Nf6','c4','c5','d5','e6','Nc3','exd5','cxd5','d6','e4','g6','f4'] },
      { name: 'Benoni · Classical',                                         moves: ['d4','Nf6','c4','c5','d5','e6','Nc3','exd5','cxd5','d6','Nf3','g6','e4','Bg7','Be2'] },
      { name: 'Benoni · Fianchetto',                                        moves: ['d4','Nf6','c4','c5','d5','e6','Nc3','exd5','cxd5','d6','g3'] },
      { name: 'Benoni · Four Pawns (Main 8...Bg7)',                         moves: ['d4','Nf6','c4','c5','d5','e6','Nc3','exd5','cxd5','d6','e4','g6','f4','Bg7','Nf3','O-O'] },
      { name: 'Benko Gambit',                                                moves: ['d4','Nf6','c4','c5','d5','b5'] },
      { name: 'Benko · Accepted',                                           moves: ['d4','Nf6','c4','c5','d5','b5','cxb5','a6'] },
      { name: 'Budapest Gambit',                                            moves: ['d4','Nf6','c4','e5'] },
      { name: 'Catalan · Open',                                              moves: ['d4','Nf6','c4','e6','g3','d5','Bg2','dxc4'] },
      { name: 'Catalan · Closed',                                            moves: ['d4','Nf6','c4','e6','g3','d5','Bg2','Be7'] },
      { name: 'Dutch · Classical (2.c4 e6)',                                moves: ['d4','f5','c4','e6','Nf3','Nf6','g3','Be7','Bg2','O-O'] },
      { name: 'Dutch · Stonewall',                                          moves: ['d4','f5','c4','Nf6','g3','e6','Bg2','d5','Nf3','c6'] },
      { name: 'Dutch · Leningrad',                                          moves: ['d4','f5','g3','Nf6','Bg2','g6'] },
      { name: 'Staunton Gambit vs Dutch',                                   moves: ['d4','f5','e4'] },
      { name: 'London System',                                              moves: ['d4','d5','Bf4'] },
      { name: 'London vs Indian setup',                                     moves: ['d4','Nf6','Bf4'] },
      { name: 'Trompowsky Attack',                                          moves: ['d4','Nf6','Bg5'] },
      { name: 'Colle System',                                               moves: ['d4','d5','Nf3','Nf6','e3','e6','Bd3'] },
      { name: 'Torre Attack',                                                moves: ['d4','Nf6','Nf3','e6','Bg5'] },
      { name: 'Veresov Attack',                                              moves: ['d4','d5','Nc3','Nf6','Bg5'] },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  Flank Openings (1.c4, 1.Nf3, other)
  // ═══════════════════════════════════════════════════════════════════
  {
    group: 'Flank openings',
    items: [
      { name: 'English · Symmetrical (1.c4 c5)',                            moves: ['c4','c5'] },
      { name: 'English · Symmetrical · Four Knights',                       moves: ['c4','c5','Nc3','Nc6','Nf3','Nf6'] },
      { name: 'English · Reversed Sicilian (1.c4 e5)',                      moves: ['c4','e5'] },
      { name: 'English · Reversed Dragon',                                   moves: ['c4','e5','Nc3','Nf6','Nf3','Nc6','g3','d5','cxd5','Nxd5'] },
      { name: 'English · Mikenas-Carls',                                    moves: ['c4','Nf6','Nc3','e6','e4'] },
      { name: 'English · Botvinnik System',                                 moves: ['c4','e5','Nc3','Nc6','g3','g6','Bg2','Bg7','e4'] },
      { name: 'English · Hedgehog',                                         moves: ['c4','Nf6','Nc3','e6','Nf3','b6','g3','Bb7','Bg2','Be7','O-O','O-O'] },
      { name: 'English · Agincourt Defense',                                moves: ['c4','e6'] },
      { name: 'English · Slav Defense',                                     moves: ['c4','c6'] },
      { name: 'Réti Opening',                                               moves: ['Nf3','d5','c4'] },
      { name: 'Réti · King\'s Indian Attack',                                moves: ['Nf3','d5','g3'] },
      { name: 'Réti · Kingside Fianchetto',                                  moves: ['Nf3','Nf6','c4','g6','b4'] },
      { name: 'Bird Opening',                                                moves: ['f4'] },
      { name: 'Bird · From\'s Gambit',                                        moves: ['f4','e5'] },
      { name: 'Larsen Opening (1.b3)',                                       moves: ['b3'] },
      { name: 'Nimzowitsch-Larsen',                                          moves: ['b3','e5','Bb2','Nc6','e3'] },
      { name: 'Polish / Sokolsky (1.b4)',                                    moves: ['b4'] },
      { name: 'Grob Attack (1.g4)',                                          moves: ['g4'] },
    ],
  },
];

import { Chess } from '../vendor/chess.js/chess.js';

/**
 * Given a list of SAN moves (the opening), return the FEN of the resulting
 * position, plus the UCI-move equivalent so tournament logs can show the
 * full game from move 1.
 */
export function playOpening(sanMoves) {
  const chess = new Chess();
  const uci = [];
  for (const san of sanMoves) {
    const mv = chess.move(san);
    if (!mv) return null;
    uci.push(mv.from + mv.to + (mv.promotion || ''));
  }
  return { fen: chess.fen(), uciMoves: uci, sanMoves: sanMoves.slice() };
}
