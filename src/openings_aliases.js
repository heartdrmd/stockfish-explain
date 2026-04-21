// src/openings_aliases.js
// Hand-curated descriptive / alternative names for well-known
// openings and variations. Each key is a name SUBSTRING — when an
// opening's full name contains that substring, the listed aliases
// become part of its searchable text.
//
// Only entries where the alternative name is canonical and widely
// used are included. Where an alias is uncertain, the entry is left
// out intentionally — better to skip than to pollute search with
// invented names. Total: ~160 confident entries.

export const OPENING_ALIASES = {
  // ═══════════════════════════════════════════════════════════════
  //   1.e4 e5  — Open Games
  // ═══════════════════════════════════════════════════════════════
  'Ruy Lopez':                                      ['Spanish Game', 'Spanish', '1.e4 e5 2.Nf3 Nc6 3.Bb5'],
  'Ruy Lopez: Berlin':                              ['Berlin', 'Berlin Defense', '3...Nf6'],
  'Ruy Lopez: Berlin Defense, Berlin Wall':         ['Berlin Wall', 'Berlin Endgame'],
  'Ruy Lopez: Morphy':                              ['Morphy Defense', '3...a6'],
  'Ruy Lopez: Closed':                              ['Closed Ruy', 'Closed Spanish', 'Main Line Ruy'],
  'Ruy Lopez: Exchange':                            ['Spanish Exchange', 'Exchange Ruy', '4.Bxc6'],
  'Ruy Lopez: Open':                                ['Open Ruy', 'Open Spanish', '5...Nxe4'],
  'Ruy Lopez: Marshall':                            ['Marshall Attack', 'Marshall Gambit Spanish', '8...d5'],
  'Ruy Lopez: Schliemann':                          ['Schliemann', 'Jaenisch Gambit', '3...f5'],
  'Ruy Lopez: Steinitz':                            ['Steinitz Defense', '3...d6'],
  'Ruy Lopez: Classical':                           ['Classical Ruy', '3...Bc5'],
  'Ruy Lopez: Bird':                                ['Bird Defense Ruy', '3...Nd4'],
  'Ruy Lopez: Cozio':                               ['Cozio', '3...Nge7'],
  'Ruy Lopez: Smyslov Defense':                     ['Smyslov-Karpov', 'h3 Nd7'],
  'Ruy Lopez: Zaitsev':                             ['Zaitsev', 'Bb7 Ruy'],
  'Ruy Lopez: Breyer':                              ['Breyer Defense', 'Nb8 Ruy'],
  'Ruy Lopez: Chigorin':                            ['Chigorin Defense Ruy', 'Na5 Ruy'],

  'Italian Game':                                   ['Italian', '1.e4 e5 2.Nf3 Nc6 3.Bc4'],
  'Italian Game: Giuoco Pianissimo':                ['Giuoco Pianissimo', 'Italian Quiet', 'd3 Italian'],
  'Italian Game: Giuoco Piano':                     ['Giuoco Piano', 'Italian Game 3...Bc5'],
  'Italian Game: Evans Gambit':                     ['Evans Gambit', 'b4 Italian'],
  'Italian Game: Two Knights Defense':              ['Two Knights Defense', '3...Nf6 Italian'],
  'Italian Game: Two Knights, Fried Liver':         ['Fried Liver', 'Fegatello', 'Nxf7 attack'],
  'Italian Game: Two Knights, Traxler':             ['Traxler', 'Wilkes-Barre', 'Bc5 gambit 4...Bc5'],
  'Italian Game: Hungarian Defense':                ['Hungarian Defense', '3...Be7 Italian'],

  'Scotch Game':                                    ['Scotch', '1.e4 e5 2.Nf3 Nc6 3.d4'],
  'Scotch Gambit':                                  ['Scotch Gambit', '4.Bc4 Scotch'],
  'Scotch Game: Classical':                         ['Scotch Classical', '4...Bc5'],
  'Scotch Game: Mieses':                            ['Mieses Variation', 'Nxc6 bxc6 e5'],
  'Scotch Game: Schmidt':                           ['Schmidt Scotch', '4...Nf6 Scotch'],
  'Scotch Game: Steinitz':                          ['Steinitz Scotch', 'Qh4 Scotch'],

  'Four Knights':                                   ['Four Knights', '1.e4 e5 2.Nf3 Nc6 3.Nc3 Nf6'],
  'Three Knights':                                  ['Three Knights'],

  "King's Gambit":                                  ["King's Gambit", 'KG', '2.f4'],
  "King's Gambit Accepted":                         ['KGA', "King's Gambit Accepted"],
  "King's Gambit Declined":                         ['KGD', "King's Gambit Declined"],
  "King's Gambit Accepted: Kieseritzky":            ['Kieseritzky', 'KGA Kieseritzky'],
  "King's Gambit Accepted: Muzio":                  ['Muzio Gambit', 'KGA Muzio'],
  "King's Gambit Accepted: Fischer Defense":        ['Fischer Defense', 'KGA 3...d6'],
  "King's Gambit Declined, Falkbeer":               ['Falkbeer Counter', 'KGD Falkbeer'],

  'Petrov':                                         ['Petrov', 'Russian Defense', 'Petroff', '2...Nf6'],
  'Petroff':                                        ['Petroff', 'Russian Defense', 'Petrov', '2...Nf6'],

  'Vienna Game':                                    ['Vienna', '1.e4 e5 2.Nc3'],
  'Vienna Gambit':                                  ['Vienna Gambit', '3.f4'],

  'Philidor Defense':                               ['Philidor', '1.e4 e5 2.Nf3 d6'],

  'Latvian Gambit':                                 ['Latvian', '2...f5 Gambit'],
  'Elephant Gambit':                                ['Elephant Gambit', '2...d5 Gambit'],
  'Center Game':                                    ['Center Game', '2.d4 exd4 3.Qxd4'],
  'Danish Gambit':                                  ['Danish Gambit', '2.d4 exd4 3.c3'],
  'Ponziani':                                       ['Ponziani', '3.c3 Ponziani'],

  // ═══════════════════════════════════════════════════════════════
  //   Sicilian Defense (1.e4 c5)
  // ═══════════════════════════════════════════════════════════════
  'Sicilian Defense':                               ['Sicilian', '1.e4 c5'],
  'Sicilian Defense: Najdorf':                      ['Najdorf', 'Najdorf Sicilian', '5...a6 Sicilian', 'Sicilian a6'],
  'Sicilian Defense: Najdorf, English Attack':      ['Najdorf English Attack', 'Najdorf Be3', '6.Be3 Najdorf'],
  'Sicilian Defense: Najdorf, Poisoned Pawn':       ['Poisoned Pawn', 'Najdorf Qxb2'],
  'Sicilian Defense: Najdorf, Opocensky':           ['Opocensky', '6.Be2 Najdorf'],
  'Sicilian Defense: Najdorf, Main Line':           ['Main Line Najdorf', '6.Bg5 Najdorf'],
  'Sicilian Defense: Dragon':                       ['Dragon', 'Dragon Sicilian', '5...g6 Sicilian'],
  'Sicilian Defense: Dragon, Yugoslav':             ['Yugoslav Attack', 'Dragon Yugoslav', 'Bc4 Dragon'],
  'Sicilian Defense: Accelerated Dragon':           ['Accelerated Dragon', 'Sicilian 4...g6'],
  'Sicilian Defense: Hyperaccelerated Dragon':      ['Hyperaccelerated Dragon', '2...g6 Sicilian'],
  'Sicilian Defense: Scheveningen':                 ['Scheveningen', 'Sicilian e6+d6'],
  'Sicilian Defense: Scheveningen, Keres':          ['Keres Attack', 'Scheveningen Keres', 'g4 Scheveningen'],
  'Sicilian Defense: Classical':                    ['Classical Sicilian', 'Sicilian 5...Nc6'],
  'Sicilian Defense: Richter-Rauzer':               ['Richter-Rauzer', 'Rauzer Attack', 'Bg5 Sicilian'],
  'Sicilian Defense: Sveshnikov':                   ['Sveshnikov', 'Pelikan', 'Sicilian 5...e5'],
  'Sicilian Defense: Kalashnikov':                  ['Kalashnikov', 'Sicilian 4...e5'],
  'Sicilian Defense: Taimanov':                     ['Taimanov', 'Sicilian Taimanov', 'e6+Nc6 Sicilian'],
  'Sicilian Defense: Kan':                          ['Kan', 'Sicilian Kan', '4...a6 Sicilian'],
  'Sicilian Defense: Paulsen':                      ['Paulsen', 'Sicilian Paulsen', '4...e6 Sicilian'],
  'Sicilian Defense: Rossolimo':                    ['Rossolimo', 'Sicilian Rossolimo', '3.Bb5 Nc6', 'Sicilian Bb5 Nc6'],
  'Sicilian Defense: Moscow':                       ['Moscow Variation', 'Sicilian Moscow', '3.Bb5+ d6', 'Sicilian Bb5 d6'],
  'Sicilian Defense: Canal':                        ['Canal Variation', 'Canal-Sokolsky', '3.Bb5 Sicilian'],
  'Sicilian Defense: Alapin':                       ['Alapin', 'Sicilian Alapin', '2.c3 Sicilian'],
  'Sicilian Defense: Smith-Morra Gambit':           ['Smith-Morra Gambit', 'Morra Gambit', '2.d4 cxd4 3.c3'],
  'Sicilian Defense: Grand Prix':                   ['Grand Prix Attack', 'Sicilian f4', 'Sicilian Grand Prix'],
  'Sicilian Defense: Closed':                       ['Closed Sicilian', '2.Nc3 Sicilian', 'Nc3 Sicilian'],
  'Sicilian Defense: Wing Gambit':                  ['Wing Gambit Sicilian', '2.b4'],

  // ═══════════════════════════════════════════════════════════════
  //   French Defense (1.e4 e6)
  // ═══════════════════════════════════════════════════════════════
  'French Defense':                                 ['French', '1.e4 e6'],
  'French Defense: Winawer':                        ['Winawer', 'French Winawer', '3...Bb4'],
  'French Defense: Tarrasch':                       ['Tarrasch French', '3.Nd2', 'French Nd2'],
  'French Defense: Classical':                      ['Classical French', '3.Nc3 Nf6'],
  'French Defense: Advance':                        ['Advance French', 'French Advance', '3.e5'],
  'French Defense: Exchange':                       ['Exchange French', 'French Exchange', '3.exd5'],
  'French Defense: Rubinstein':                     ['Rubinstein French', '3...dxe4'],
  'French Defense: McCutcheon':                     ['McCutcheon', '4...Bb4 French'],
  'French Defense: Burn':                           ['Burn French', '4...dxe4'],
  'French Defense: Fort Knox':                      ['Fort Knox French'],
  'French Defense: King\'s Indian Attack':          ['KIA French', "King's Indian Attack French"],

  // ═══════════════════════════════════════════════════════════════
  //   Caro-Kann Defense (1.e4 c6)
  // ═══════════════════════════════════════════════════════════════
  'Caro-Kann':                                      ['Caro-Kann', 'Caro', '1.e4 c6'],
  'Caro-Kann Defense: Classical':                   ['Classical Caro', '4...Bf5'],
  'Caro-Kann Defense: Advance':                     ['Advance Caro', 'Caro-Kann 3.e5'],
  'Caro-Kann Defense: Exchange':                    ['Exchange Caro', 'Caro 3.exd5'],
  'Caro-Kann Defense: Panov':                       ['Panov-Botvinnik', 'Panov Attack', 'c4 Caro', 'IQP Caro'],
  'Caro-Kann Defense: Fantasy':                     ['Fantasy Variation', 'Caro Fantasy', '3.f3'],
  'Caro-Kann Defense: Two Knights':                 ['Two Knights Caro', '2.Nc3 d5 3.Nf3'],
  'Caro-Kann Defense: Karpov':                      ['Karpov Caro', '4...Nd7 Caro'],
  'Caro-Kann Defense: Bronstein-Larsen':            ['Bronstein-Larsen Caro', '4...Nf6 5.Nxf6+ gxf6'],

  // ═══════════════════════════════════════════════════════════════
  //   Pirc / Modern / Alekhine / Scandinavian
  // ═══════════════════════════════════════════════════════════════
  'Pirc Defense':                                   ['Pirc', '1.e4 d6 2.d4 Nf6'],
  'Pirc Defense: Austrian':                         ['Austrian Attack', 'Pirc Austrian', 'f4 Pirc'],
  'Pirc Defense: Classical':                        ['Classical Pirc', 'Nf3 Pirc'],
  'Pirc Defense: 150 Attack':                       ['150 Attack', 'Be3 Qd2 Pirc'],
  'Modern Defense':                                 ['Modern', 'Robatsch', '1.e4 g6'],
  "Alekhine's Defense":                             ['Alekhine', "Alekhine's Defense"],
  "Alekhine's Defense: Modern":                     ['Modern Alekhine', '4...Bg4 Alekhine'],
  "Alekhine's Defense: Four Pawns":                 ['Four Pawns Alekhine', 'Alekhine Four Pawns'],
  "Alekhine's Defense: Exchange":                   ['Exchange Alekhine', 'Alekhine Exchange'],
  'Scandinavian Defense':                           ['Scandinavian', 'Center Counter', '1.e4 d5'],
  'Scandinavian Defense: Mieses-Kotroc':            ['Mieses-Kotroc', '2...Qxd5 3...Qa5'],
  'Scandinavian Defense: Marshall':                 ['Marshall Scandinavian', '2...Nf6 Scandinavian'],

  // ═══════════════════════════════════════════════════════════════
  //   Queen's pawn games (1.d4 d5)
  // ═══════════════════════════════════════════════════════════════
  "Queen's Gambit Declined":                        ['QGD', "Queen's Gambit Declined"],
  "Queen's Gambit Declined: Orthodox":              ['Orthodox QGD', 'Orthodox Defense'],
  "Queen's Gambit Declined: Tartakower":            ['Tartakower', 'QGD Tartakower'],
  "Queen's Gambit Declined: Cambridge Springs":     ['Cambridge Springs', 'QGD Cambridge Springs'],
  "Queen's Gambit Declined: Lasker":                ['Lasker Defense', 'QGD Lasker'],
  "Queen's Gambit Declined: Exchange":              ['Exchange QGD', 'QGD Exchange'],
  "Queen's Gambit Declined: Vienna":                ['Vienna QGD', '3...Bb4 QGD'],
  "Queen's Gambit Declined: Semi-Tarrasch":         ['Semi-Tarrasch', 'QGD Semi-Tarrasch'],
  "Queen's Gambit Declined: Ragozin":               ['Ragozin Defense', 'QGD Ragozin'],
  "Queen's Gambit Accepted":                        ['QGA', "Queen's Gambit Accepted"],
  "Queen's Gambit Accepted: Classical":             ['Classical QGA', 'QGA Classical'],
  "Queen's Gambit Accepted: Central":               ['Central QGA', 'QGA Central'],
  'Slav Defense':                                   ['Slav', '1.d4 d5 2.c4 c6'],
  'Slav Defense: Exchange':                         ['Exchange Slav', 'Slav Exchange', '3.cxd5'],
  'Slav Defense: Czech':                            ['Czech Slav', 'Classical Slav', 'Slav Bf5'],
  'Slav Defense: Main Line':                        ['Main Line Slav', '4.Nc3 dxc4'],
  'Slav Defense: Chebanenko':                       ['Chebanenko Slav', '4...a6 Slav'],
  'Slav Defense: Winawer Counter':                  ['Winawer Counter-Gambit Slav', '3...e5'],
  'Semi-Slav':                                      ['Semi-Slav', '4...e6 Slav'],
  'Semi-Slav Defense: Meran':                       ['Meran', 'Meran Variation', 'Semi-Slav Meran'],
  'Semi-Slav Defense: Anti-Meran':                  ['Anti-Meran', 'Semi-Slav Anti-Meran'],
  'Semi-Slav Defense: Moscow':                      ['Moscow Semi-Slav', 'Bxf6 Semi-Slav'],
  'Semi-Slav Defense: Botvinnik':                   ['Botvinnik Variation', 'Semi-Slav Botvinnik'],

  // ═══════════════════════════════════════════════════════════════
  //   Indian defenses (1.d4 Nf6)
  // ═══════════════════════════════════════════════════════════════
  'Nimzo-Indian':                                   ['Nimzo', 'Nimzo-Indian', '1.d4 Nf6 2.c4 e6 3.Nc3 Bb4'],
  'Nimzo-Indian Defense: Classical':                ['Classical Nimzo', 'Nimzo 4.Qc2', 'Capablanca Nimzo'],
  'Nimzo-Indian Defense: Rubinstein':               ['Rubinstein Nimzo', 'Nimzo 4.e3'],
  'Nimzo-Indian Defense: Saemisch':                 ['Sämisch Nimzo', 'Samisch Nimzo', 'Nimzo 4.a3'],
  'Nimzo-Indian Defense: Kasparov':                 ['Kasparov Variation Nimzo', 'Nimzo 4.Nf3'],
  "Queen's Indian":                                 ["Queen's Indian", 'QID', '1.d4 Nf6 2.c4 e6 3.Nf3 b6'],
  "Queen's Indian Defense: Kasparov":               ['Kasparov-Petrosian', 'QID Kasparov'],
  "Queen's Indian Defense: Fianchetto":             ['Fianchetto QID'],
  "King's Indian Defense":                          ["King's Indian", 'KID', '1.d4 Nf6 2.c4 g6'],
  "King's Indian Defense: Classical":               ['Classical KID', "King's Indian Classical", 'Mar del Plata'],
  "King's Indian Defense: Saemisch":                ['Sämisch KID', 'Samisch KID', 'f3 KID'],
  "King's Indian Defense: Four Pawns":              ['Four Pawns Attack KID', 'KID Four Pawns'],
  "King's Indian Defense: Fianchetto":              ['Fianchetto KID', 'Yugoslav KID'],
  "King's Indian Defense: Averbakh":                ['Averbakh KID', 'Bg5 KID'],
  "King's Indian Defense: Petrosian":               ['Petrosian KID', 'd5 KID'],
  "King's Indian Defense: Makogonov":               ['Makogonov KID', 'h3 KID'],
  'Grünfeld Defense':                               ['Grunfeld', 'Grünfeld', '1.d4 Nf6 2.c4 g6 3.Nc3 d5'],
  'Grünfeld Defense: Exchange':                     ['Exchange Grunfeld', 'Grunfeld Exchange'],
  'Grünfeld Defense: Russian':                      ['Russian System Grunfeld', 'Qb3 Grunfeld'],
  'Grünfeld Defense: Classical':                    ['Classical Grunfeld'],
  'Benoni Defense':                                 ['Benoni', '1.d4 Nf6 2.c4 c5'],
  'Benoni Defense: Modern':                         ['Modern Benoni', 'Benoni Modern'],
  'Benoni Defense: Taimanov':                       ['Taimanov Benoni', 'Bb5 Benoni', 'Benoni Bb5'],
  'Benoni Defense: Four Pawns':                     ['Four Pawns Attack Benoni', 'Benoni Four Pawns'],
  'Benoni Defense: Fianchetto':                     ['Fianchetto Benoni'],
  'Benoni Defense: Classical':                      ['Classical Benoni'],
  'Benoni Defense: Old':                            ['Old Benoni'],
  'Benoni Defense: Nimzowitsch':                    ['Nimzowitsch Benoni'],
  'Benko Gambit':                                   ['Benko', 'Volga Gambit', 'Benko Gambit', '3...b5 Benoni'],
  'Budapest Defense':                               ['Budapest Gambit', 'Budapest'],
  'Budapest Defense: Fajarowicz':                   ['Fajarowicz Gambit', 'Budapest Fajarowicz'],
  'Dutch Defense':                                  ['Dutch', '1.d4 f5'],
  'Dutch Defense: Leningrad':                       ['Leningrad Dutch', '6...g6 Dutch'],
  'Dutch Defense: Stonewall':                       ['Stonewall Dutch', 'e6 c6 d5 Dutch'],
  'Dutch Defense: Classical':                       ['Classical Dutch', 'e6 Dutch'],
  'Dutch Defense: Staunton Gambit':                 ['Staunton Gambit Dutch'],
  'Albin Counter':                                  ['Albin Counter-Gambit', 'Albin'],
  'Chigorin Defense':                               ['Chigorin Defense', 'Chigorin'],

  // ═══════════════════════════════════════════════════════════════
  //   Other d4 openings + systems
  // ═══════════════════════════════════════════════════════════════
  'Catalan Opening':                                ['Catalan', '1.d4 2.c4 3.g3'],
  'Catalan Opening: Open':                          ['Open Catalan', '4...dxc4'],
  'Catalan Opening: Closed':                        ['Closed Catalan', '4...Be7'],
  'London System':                                  ['London', 'London System', 'Bf4 d4 system'],
  'Colle System':                                   ['Colle', 'Colle System'],
  'Torre Attack':                                   ['Torre Attack', 'Bg5 Torre'],
  'Trompowsky Attack':                              ['Trompowsky', '1.d4 Nf6 2.Bg5'],
  'Veresov Attack':                                 ['Richter-Veresov', 'Veresov'],
  'Richter-Veresov':                                ['Richter-Veresov', 'Veresov'],
  'Stonewall Attack':                               ['Stonewall Attack', 'Stonewall (white)'],
  'Blackmar-Diemer':                                ['Blackmar-Diemer Gambit', 'BDG'],

  // ═══════════════════════════════════════════════════════════════
  //   Flank openings (1.c4, 1.Nf3, 1.b3, 1.f4, etc)
  // ═══════════════════════════════════════════════════════════════
  'English Opening':                                ['English', '1.c4'],
  'English Opening: Symmetrical':                   ['Symmetrical English', 'English Symmetrical'],
  'English Opening: Reversed Sicilian':             ['Reversed Sicilian', '1.c4 e5'],
  'English Opening: Four Knights':                  ['English Four Knights'],
  'English Opening: Botvinnik':                     ['Botvinnik System English'],
  'English Opening: Mikenas':                       ['Mikenas Attack', 'Flohr-Mikenas'],
  'Réti Opening':                                   ['Reti', 'Réti', '1.Nf3'],
  "King's Indian Attack":                           ['KIA', "King's Indian Attack"],
  "Bird's Opening":                                 ['Bird Opening', 'Bird', '1.f4'],
  "Bird's Opening: From's Gambit":                  ["From's Gambit", 'Froms Gambit', 'Bird From'],
  "Larsen's Opening":                               ['Larsen Opening', 'Nimzo-Larsen Attack', '1.b3'],
  'Nimzo-Larsen Attack':                            ['Nimzo-Larsen', 'Larsen', '1.b3'],
  'Sokolsky Opening':                               ['Sokolsky', 'Polish Opening', 'Orangutan', '1.b4'],
  'Polish Opening':                                 ['Polish', 'Sokolsky', 'Orangutan', '1.b4'],
  'Van Geet Opening':                               ['Van Geet', 'Dunst Opening', 'Mieses', '1.Nc3'],
  'Dunst Opening':                                  ['Dunst', 'Van Geet', '1.Nc3'],
  'Grob Opening':                                   ['Grob', 'Spike', '1.g4'],
  "Van't Kruijs":                                   ["Van 't Kruijs", '1.e3'],
  'Anderssen Opening':                              ['Anderssen', '1.a3'],
  'Amar Opening':                                   ['Amar', 'Paris Opening', '1.Nh3'],
  'Saragossa Opening':                              ['Saragossa', '1.c3'],
  'Barnes Opening':                                 ['Barnes Opening', '1.f3'],
  "Zukertort Opening":                              ['Zukertort', '1.Nf3'],

  // ═══════════════════════════════════════════════════════════════
  //   Additional famous Lichess-DB variations worth aliasing
  // ═══════════════════════════════════════════════════════════════
  'Ruy Lopez: Archangelsk':                         ['Archangelsk', 'Arkhangelsk', 'Bb7 Ruy Lopez'],
  'Ruy Lopez: Modern Archangelsk':                  ['Modern Archangelsk', 'Bc5 Ruy Lopez'],
  'Ruy Lopez: Worrall Attack':                      ['Worrall', 'Worrall Attack', 'Qe2 Ruy'],
  'Ruy Lopez: Anti-Marshall':                       ['Anti-Marshall', 'h3 Ruy', 'a4 Ruy'],
  'Italian Game: Möller Attack':                    ['Möller Attack', 'Moller Attack', 'Italian c3 d4'],
  'Italian Game: Scotch Gambit, Möller Attack':     ['Möller Attack', 'Moller Scotch Gambit'],

  "King's Indian Defense: Classical, Bayonet":      ['Bayonet Attack KID', 'b4 KID', 'KID Bayonet'],
  "King's Indian Defense: Makogonov":               ['Makogonov KID', 'h3 KID', '5.h3 KID'],
  "King's Indian Defense: Gligoric":                ['Gligoric System', 'Be3 KID', '7.Be3 KID'],
  "King's Indian Defense: Orthodox":                ['Orthodox KID', 'Mar del Plata KID'],
  "King's Indian Defense: Panno":                   ['Panno Variation', 'Fianchetto Panno'],

  'Nimzo-Indian Defense: Hübner':                   ['Hübner', 'Huebner Variation', 'Nimzo Hubner'],
  'Nimzo-Indian Defense: Leningrad':                ['Leningrad Nimzo', 'Bg5 Nimzo'],
  'Nimzo-Indian Defense: Normal Line':              ['Normal Nimzo', 'Main Nimzo'],

  "Queen's Indian Defense: Fianchetto, Nimzowitsch Variation": ['Nimzowitsch QID', 'Ba6 QID'],

  'Grünfeld Defense: Three Knights':                ['Three Knights Grunfeld'],
  'Grünfeld Defense: Seville Variation':            ['Seville', 'Seville Grunfeld'],
  'Grünfeld Defense: Modern Exchange':              ['Modern Exchange Grunfeld', '8.Rb1'],

  'Benoni Defense: Four Pawns Attack':              ['Four Pawns Benoni', 'Benoni Four Pawns', 'f4 Benoni'],
  'Benoni Defense: Pawn Storm':                     ['Pawn Storm Benoni'],
  'Benoni Defense: Hromadka':                       ['Czech Benoni', 'Hromadka'],
  'Benko Gambit Accepted':                          ['Benko Accepted', 'Volga Accepted'],
  'Benko Gambit Declined':                          ['Benko Declined'],

  'Sicilian Defense: Sveshnikov, Chelyabinsk':      ['Chelyabinsk', 'Sveshnikov Main'],
  'Sicilian Defense: Najdorf, Fischer-Sozin':       ['Fischer-Sozin', 'Sozin Najdorf', 'Bc4 Najdorf'],
  'Sicilian Defense: Najdorf, Adams Attack':        ['Adams Attack', 'h3 Najdorf'],
  'Sicilian Defense: Velimirovic':                  ['Velimirovic Attack', 'Bc4 Classical Sicilian'],
  'Sicilian Defense: Four Knights':                 ['Four Knights Sicilian'],
  'Sicilian Defense: Löwenthal':                    ['Löwenthal', 'Lowenthal', 'Sicilian 4...e5'],

  'French Defense: Winawer, Poisoned Pawn':         ['Poisoned Pawn French', 'Winawer Poisoned'],
  'French Defense: Winawer, Advance':               ['Winawer Advance', 'Winawer Main'],
  'French Defense: Tarrasch, Open':                 ['Open Tarrasch', 'Tarrasch Open'],
  'French Defense: Tarrasch, Closed':               ['Closed Tarrasch', 'Tarrasch Closed'],
  'French Defense: Steinitz':                       ['Steinitz French', '4.e5 French'],
  'French Defense: Boleslavsky':                    ['Boleslavsky French', '4.Bg5 French'],
  'French Defense: Milner-Barry':                   ['Milner-Barry Gambit', 'Advance Milner-Barry'],

  'Caro-Kann Defense: Advance, Short':              ['Short Variation Caro', 'Advance Short Caro'],
  'Caro-Kann Defense: Tartakower':                  ['Tartakower Caro'],
  'Caro-Kann Defense: Gurgenidze':                  ['Gurgenidze Caro', '2.Nc3 g6'],

  'Queen\'s Gambit Declined: Tarrasch':             ['Tarrasch Defense', 'Tarrasch QGD', '3...c5'],
  "Queen's Gambit Declined: Semi-Tarrasch":         ['Semi-Tarrasch', 'Semi-Tarrasch Defense'],
  "Queen's Gambit Declined: Manhattan":             ['Manhattan Variation'],
  "Queen's Gambit Accepted: Old":                   ['Old QGA'],

  'Slav Defense: Quiet':                            ['Quiet Slav'],
  'Slav Defense: Geller Gambit':                    ['Geller Gambit Slav'],
  'Slav Defense: Schlechter':                       ['Schlechter Slav'],
  'Semi-Slav Defense: Marshall':                    ['Marshall Gambit Semi-Slav', 'e4 Semi-Slav'],

  'Alekhine Defense: Four Pawns':                   ['Four Pawns Alekhine'],
  'Alekhine Defense: Modern':                       ['Modern Alekhine', 'Bg4 Alekhine'],
  'Alekhine Defense: Exchange':                     ['Exchange Alekhine', '4.exd6'],

  'Dutch Defense: Classical':                       ['Classical Dutch', 'Ilyin-Genevsky'],
  'Dutch Defense: Rubinstein':                      ['Rubinstein Dutch'],

  'English Opening: Hedgehog':                      ['Hedgehog', 'English Hedgehog'],
  'English Opening: Botvinnik':                     ['Botvinnik English', 'Botvinnik System'],
  'English Opening: Anti-Benoni':                   ['Anti-Benoni English'],

  'Trompowsky Attack: Classical':                   ['Classical Tromp', 'Main Line Trompowsky'],
  'Trompowsky Attack: Edge':                        ['Edge Variation Tromp'],
  'London System: Barry Attack':                    ['Barry Attack', 'London Barry'],
  'London System: Jobava':                          ['Jobava London', 'Rapport-Jobava'],
  "King's Indian Attack: Sicilian":                 ['KIA Sicilian', "King's Indian Attack vs Sicilian"],
};
