// openings_book.js — synthesised opening coaching database.
//
// ~200 curated opening entries with plan templates, motifs, and common
// pitfalls. Detection runs two matchers in sequence:
//
//   1) Exact SAN-prefix match against the played move history (longest
//      first). When a prefix matches, the entry is returned with
//      `_matched = 'exact'`.
//   2) FEN-based structural fallback. If no prefix matches but a FEN is
//      supplied, we compare the current position's pawn skeleton +
//      piece placement + material + side-to-move against each entry's
//      canonical FEN (pre-computed at module load by replaying its
//      moves once). The nearest-neighbour entry is returned with
//      `_matched = 'structural'` provided the distance is under a
//      similarity threshold — this lets a transposed Maroczy / IQP /
//      Carlsbad still trigger the right coaching plans even when the
//      move order doesn't match any book line.
//
// Data synthesised from publicly-documented opening theory (ECO
// classification, Wikipedia, public chess-press summaries). Plan and
// motif descriptions are paraphrased in original words — no
// copyrighted prose is reproduced. Move sequences and ECO codes are
// factual reference data.

import { Chess } from '../vendor/chess.js/chess.js';
import { LICHESS_OPENINGS } from './openings_lichess.js';

const BOOK_RAW = [
  // ═════════════════════ SICILIAN ═════════════════════
  { name: 'Najdorf Sicilian', eco: 'B90', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6'],
    structure: 'Small Black centre on d6 with flexible ...e5 or ...e6; ...a6 prepares ...b5 queenside expansion.',
    whitePlans: ['English Attack (Be3, f3, Qd2, O-O-O, g4-g5)', 'Classical Bg5 pin pressuring f6 and d6', 'Fischer-Sozin Bc4 targeting f7', 'Positional Be2/O-O squeeze on d5'],
    blackPlans: ['Queenside counter with ...b5, ...Bb7, ...Nbd7-b6-c4', 'Central ...e5 to contest d4 and gain space', 'Opposite-side castling race in sharp lines', 'Exchange sac ...Rxc3 shattering White queenside'],
    pitfalls: ['Poisoned Pawn (7...Qb6 8.Qd2 Qxb2) — razor-sharp, memorise or avoid', 'Premature ...h5 vs English Attack loses to h4/g4-g5'],
    motifs: ['Pawn storm g4-g5 vs ...b5-b4', '...Rxc3 exchange sac', 'Nd5 central jump'] },
  { name: 'Sveshnikov Sicilian', eco: 'B33', parent: 'sicilian',
    moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','Nf6','Nc3','e5'],
    structure: 'Black concedes d5 hole for active piece play; backward d-pawn is the main positional flaw.',
    whitePlans: ['Ndb5-Bxf6-Nd5 route planting knight on d5', 'Positional c4 clamping d5 square', 'Kingside castle + Bd3/a4 restraining ...b5'],
    blackPlans: ['...a6 kicking Na3, then ...b5 hitting c4/e4', 'Dark-square trade via ...Be7/...Bg5', '...Ne7 rerouting to challenge Nd5'],
    pitfalls: ['Unchallenged Nd5 leads to permanent bind', '...f5 break without prep opens e-file against own king'],
    motifs: ['Ndb5-Nd5 double knight maneuver', '...Bxd5 eliminating the outpost'] },
  { name: 'Dragon Sicilian', eco: 'B70', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','g6'],
    structure: 'Fianchettoed g7-bishop on the long diagonal; opposite-side castling typical.',
    whitePlans: ['Yugoslav Attack: Be3, f3, Qd2, O-O-O, Bh6, h4-h5', 'Exchange sac on h5 ripping open Black king', 'Nd5 central jump after ...Re8'],
    blackPlans: ['...Rc8, ...Ne5, ...Nc4 queenside attack', '...Rxc3 exchange sac vs White queenside king', '...a5-a4 pawn lever opening b-file'],
    pitfalls: ['Allowing Bh6 trade + h4-h5-hxg6 with no counter-play', '...Qa5 without ...Rc8 support drops queen to Nd5'],
    motifs: ['Bh6 trade; h-file pry-open', '...Rxc3 sac; ...Nxe4 shot'] },
  { name: 'Accelerated Dragon', eco: 'B36', parent: 'sicilian',
    moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','g6'],
    structure: 'Delays ...d6 to preserve ...d5 break; Maroczy Bind is principled response.',
    whitePlans: ['Maroczy Bind c4/Nc3/Be2 restricting ...d5 and ...b5', 'Exchange on c6 + Qd2/Bh6 simplifying'],
    blackPlans: ['...Ng4 trading Be3 then ...Nxd4 easing bind', '...d6, ...Bd7, ...Nxd4 + ...Bc6 hitting e4'],
    pitfalls: ['Allowing the full c4-Nc3-Be2-Be3 Maroczy setup', '...Qb6 hasty drops to Nb3/Nd5 fork'],
    motifs: ['Maroczy pawn cage c4/e4', '...Ng4 Be3 trade'] },
  { name: 'Taimanov Sicilian', eco: 'B48', parent: 'sicilian',
    moves: ['e4','c5','Nf3','e6','d4','cxd4','Nxd4','Nc6'],
    structure: 'Flexible pawn skeleton; Black delays ...d6 and ...Nf6, keeping central tension.',
    whitePlans: ['English Attack Be3/f3/Qd2/O-O-O vs ...a6/...Qc7', 'Maroczy Bind with c4 after early trades'],
    blackPlans: ['...a6/...Qc7/...Nf6/...Bb4 pinning Nc3', '...b5 expansion with ...Bb7'],
    pitfalls: ['Leaving Nc6 hanging to Nxc6 bxc6 + e5', 'Allowing Ndb5 when ...a6 is delayed'],
    motifs: ['...Bb4 Nc3 pin; Ndb5 jump'] },
  { name: 'Kan Sicilian', eco: 'B42', parent: 'sicilian',
    moves: ['e4','c5','Nf3','e6','d4','cxd4','Nxd4','a6'],
    structure: 'Hedgehog-compatible small-centre; ...a6/...b5 expansion on the queenside.',
    whitePlans: ['Maroczy Bind c4+Nc3', 'Be2/O-O/Kh1, a4 clamp, plus f4'],
    blackPlans: ['Hedgehog: ...b6/...Bb7/...d6/...Nbd7/...Qc7', '...b5 direct expansion'],
    pitfalls: ['Passive Hedgehog without ...b5 or ...d5 drifts', 'Early ...b5 without ...Nf6/...Bb7 drops to a4'],
    motifs: ['...d5 or ...b5 Hedgehog break'] },
  { name: 'Scheveningen Sicilian', eco: 'B80', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','e6'],
    structure: 'Classic small centre d6+e6; very elastic, often transposes to Najdorf.',
    whitePlans: ['Keres Attack (g4 early)', 'English Attack Be3/f3/Qd2/O-O-O/g4-g5', 'Classical Be2/O-O/f4-f5'],
    blackPlans: ['...a6/...Qc7/...Nbd7/...b5 expansion', '...Bb7 + ...Rc8 pressuring c-file'],
    pitfalls: ['Allowing Keres g4-g5 without prep', 'Premature ...b5 without ...Bb7 meets Ndxb5'],
    motifs: ['g4-g5 Keres kick', '...d5 freeing break', 'Nd5 sac'] },
  { name: 'Alapin Sicilian (c3)', eco: 'B22', parent: 'sicilian-anti',
    moves: ['e4','c5','c3'],
    structure: 'White prepares d4, often reaching IQP or classical centre.',
    whitePlans: ['d4 cxd4 cxd4: IQP + piece activity Bd3/Nc3/Re1', 'Bd3/O-O/Re1 + Nbd2-f1-g3 reroute'],
    blackPlans: ['2...Nf6 forcing e5 decision', '2...d5 3.exd5 Qxd5 Scandinavian-style'],
    pitfalls: ['Letting White IQP become dynamic weapon', '2...e5 transpositions comfort White'],
    motifs: ['IQP play: d4-d5 break, Ng5/Bxh7+ attack'] },
  { name: 'Rossolimo Sicilian', eco: 'B31', parent: 'sicilian-anti',
    moves: ['e4','c5','Nf3','Nc6','Bb5'],
    structure: 'White often plays Bxc6 giving Black doubled c-pawns for the bishop pair.',
    whitePlans: ['Bxc6 dxc6/bxc6 + d3/Nbd2/Re1 + e5 clamp', 'c3/d4 classical centre vs ...g6'],
    blackPlans: ['...g6/...Bg7/...Nf6 KID-style', '...e5 space claim after Bxc6 bxc6'],
    pitfalls: ['Accepting Bxc6 dxc6 without a plan is sterile'],
    motifs: ['Bxc6 bishop-pair trade; e5 clamp'] },
  { name: 'Moscow Sicilian', eco: 'B51', parent: 'sicilian-anti',
    moves: ['e4','c5','Nf3','d6','Bb5+'],
    structure: 'After Bb5+ Bd7 White often trades bishops for quiet positional Sicilian.',
    whitePlans: ['Bxd7+ Qxd7 + c4 Maroczy Bind', 'O-O/Re1/c3/d4 classical centre'],
    blackPlans: ['...Nf6/...g6/...Bg7 solid fianchetto', '...Nc6/...e6/...Be7 flexible'],
    pitfalls: ['...Nd7 to block check restricts development'],
    motifs: ['Bxd7+ trade; c4 Maroczy clamp'] },
  { name: 'Grand Prix Attack', eco: 'B23', parent: 'sicilian-anti',
    moves: ['e4','c5','Nc3','Nc6','f4'],
    structure: 'White aims for Bb5/Bc4 + early f4 and quick kingside attack.',
    whitePlans: ['Bb5xc6 doubling pawns + d3/Nf3/O-O + f5 break', 'Bc4/f5/Qe1-h4 direct mating attack'],
    blackPlans: ['...g6/...Bg7/...e6 blunting f5', '...d5 central counter'],
    pitfalls: ['Allowing f5 break unchallenged'],
    motifs: ['Bxc6 doubled-pawn plan; f4-f5 break; Qe1-h4 lift'] },
  { name: 'Smith-Morra Gambit', eco: 'B21', parent: 'sicilian-anti',
    moves: ['e4','c5','d4','cxd4','c3'],
    structure: 'White gambits a pawn for open c/d-files and rapid development.',
    whitePlans: ['Nxc3/Bc4/O-O/Qe2/Rd1 rapid development + e5 break', 'Bxf7+ or Nd5 sacrificial motifs'],
    blackPlans: ['Siberian defence ...Nc6/...e6/...a6/...Nge7/...d6', 'Return pawn with ...d5 neutralising'],
    pitfalls: ['Greedy ...Qxd4 loses to Nb5 tactics', 'Leaving f7 undefended'],
    motifs: ['Nd5 jump forking b6/c7/f6; Bxf7+ sac'] },
  { name: 'Richter-Rauzer Sicilian', eco: 'B62', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','Nc6','Bg5'],
    structure: 'White pins the f6-knight before committing to castling, aiming to trade on f6 and damage the kingside cover.',
    whitePlans: ['Qd2/O-O-O then f3/g4-g5 storm', 'Bxf6 doubling f-pawns + h4-h5 chase', 'Nxc6 bxc6 + Be2/O-O quiet squeeze'],
    blackPlans: ['...e6/...Be7/...a6/...Bd7 preparing ...O-O or ...O-O-O', '...Qb6 hitting b2 and the knight on d4', '...h6 nudging the bishop before completing development'],
    pitfalls: ['Castling kingside into an h4-h5 lever without a counter', 'Allowing Ndb5 when ...a6 has been delayed'],
    motifs: ['Bxf6 + pawn storm', 'Opposite-side castling race', '...Rxc3 exchange sac'] },
  { name: 'Four Knights Sicilian', eco: 'B45', parent: 'sicilian',
    moves: ['e4','c5','Nf3','e6','d4','cxd4','Nxd4','Nf6','Nc3','Nc6'],
    structure: 'Both sides develop knights symmetrically; Ndb5 ideas hang over the position and often transpose into Taimanov or Sveshnikov territory.',
    whitePlans: ['Ndb5 jump targeting d6 and forcing ...d6 concessions', 'Nxc6 bxc6 + e5 seeking a structural edge', 'Be2/O-O classical slow setup'],
    blackPlans: ['...Bb4 pinning Nc3 + ...Bxc3 doubling pawns', '...d6 + ...a6 solid Scheveningen-style shell', 'Accept Sveshnikov transposition with ...e5 when allowed'],
    pitfalls: ['Ignoring the Ndb5 jump and ending up forced into ...d6 passively', 'Playing ...d6 and ...a6 too slowly, allowing Nd5 sac shots'],
    motifs: ['Ndb5 intrusion', '...Bxc3 doubled-pawn plan', 'Nd5 central sac'] },
  { name: 'Kalashnikov Sicilian', eco: 'B32', parent: 'sicilian',
    moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','e5'],
    structure: 'Black stakes out e5 before ...Nf6, conceding the d5 hole for counter-chances built around ...d6 and piece activity.',
    whitePlans: ['Nb5 hopping at the d6 weakness followed by N1c3 + Be2/O-O', 'c4 clamp combined with Nc3 gripping d5', 'Be2/O-O/Nd5 planting a long-term outpost'],
    blackPlans: ['...d6/...a6 pushing the b5-knight back to a3', '...Be7/...Nf6/...O-O completing development before breaking', '...b5 queenside expansion, eyeing ...Nb6 or ...Nb4 later'],
    pitfalls: ['Letting Nd5 land unchallenged and freeze the position', '...f5 without coordination opens the e-file against your own king'],
    motifs: ['Nb5 raid on d6', 'd5 outpost tug-of-war', '...b5-b4 kick'] },
  { name: 'Löwenthal Sicilian', eco: 'B32', parent: 'sicilian',
    moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','e5','Nb5','a6','Nd6+','Bxd6','Qxd6','Qf6'],
    structure: 'Black accepts a ruined kingside and concedes the bishop pair in exchange for rapid development and central piece pressure against the exposed white queen.',
    whitePlans: ['Qd1 retreat followed by Nc3/Be2/O-O and slow consolidation', 'c4 to clamp d5 and neutralise Black activity', 'Exchange queens and head for a calm edge in the endgame'],
    blackPlans: ['...Nge7/...d6/...Be6 rapid development to compensate for the bishop loss', 'Harass the queen off d6 with ...Nge7 + tempo gains', 'Target d4 and e4 by piece play before White finishes developing'],
    pitfalls: ['Leaving the f8-bishop on the board instead of checking on d6 drops tempo', 'Failing to generate piece pressure lets the bishop pair simply win'],
    motifs: ['Tempo gains on the wandering queen', 'Piece play over material', 'Central e-file pressure'] },
  { name: 'Paulsen Sicilian', eco: 'B46', parent: 'sicilian',
    moves: ['e4','c5','Nf3','e6','d4','cxd4','Nxd4','Nc6','Nc3','Qc7'],
    structure: 'Flexible small-centre system in which Black delays both ...d6 and ...Nf6, keeping choices open to transpose into Taimanov, Kan, or Scheveningen setups as White commits.',
    whitePlans: ['Be3/Bd3/O-O English-Attack-lite aimed at a timely f4 or Nd5 break', 'a3 + Nb3 preserving structure before launching kingside pawns', 'Maroczy-style c4 after piece trades on d4'],
    blackPlans: ['...a6/...Nf6/...Bb4 or ...Bd6 flexible piece placement', '...b5/...Bb7 queenside expansion with pressure along the long diagonal', '...Nxd4 trade followed by ...Bc5 or ...Bb4 hitting the centre'],
    pitfalls: ['Dawdling with ...Nf6 allows Nd5 jumps with tempo on the queen', '...b5 without ...Bb7 invites Ndxb5 piece sacs'],
    motifs: ['Queen on c7 controlling e5 and c-file', '...Bb4 Nc3 pin', 'Delayed ...Nf6 flexibility'] },
  { name: 'Closed Sicilian', eco: 'B25', parent: 'sicilian-anti',
    moves: ['e4','c5','Nc3','Nc6','g3'],
    structure: 'White avoids opening the centre, fianchettoes the king-bishop, and plans a slow kingside assault while Black develops on the queenside.',
    whitePlans: ['Bg2/d3/Nge2/Be3/Qd2 building a f4-f5 or h4-h5 push', 'Delayed f4 break combined with Nh3-f2 or Nf3 rerouting', 'Kingside castle followed by a pawn-storm against a fianchettoed enemy king'],
    blackPlans: ['...g6/...Bg7/...d6 mirror setup with ...Rb8 and ...b5 later', '...e6/...Nge7 reserving the f5 break for Black', '...Nd4 jump supported by ...e5 cramping White'],
    pitfalls: ['Falling behind in the kingside pawn race when White commits first', 'Playing ...e5 too early and leaving d5 permanently weak'],
    motifs: ['f4-f5 pawn lever', 'Symmetric fianchettoes', '...b5-b4 queenside breakthrough'] },
  { name: 'Fischer-Sozin Attack', eco: 'B87', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Bc4'],
    structure: 'White points the light-squared bishop at f7 before committing to the English Attack or quieter setups, and often goes O-O with a quick Bb3 + f4.',
    whitePlans: ['Bb3/f4/Qf3 building a direct kingside attack', 'Velimirović treatment Be3/Qe2/O-O-O and g4-g5', 'Trade on c6 to cripple the queenside and pressure d6'],
    blackPlans: ['...e6/...b5/...Be7/...Bb7/...O-O the main Scheveningen-style shell', '...Nc6/...Na5 harassing the b3-bishop', '...Nbd7/...b5 with a quick ...Bb7 challenging the long diagonal'],
    pitfalls: ['Castling kingside into a prepared f4-f5 or Bxe6 sacrifice', 'Ignoring the bishop on b3 and allowing Bxe6 fxe6 Nxe6 tactics'],
    motifs: ['Bxe6 sacrifice on the light squares', 'f4-f5 pawn lever', '...Na5 bishop swap'] },
  { name: 'Chekhover Sicilian', eco: 'B53', parent: 'sicilian-anti',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Qxd4'],
    structure: 'White recaptures on d4 with the queen rather than a knight, accepting a slight loss of tempo in return for a stable centre and sidestepping heavy Najdorf theory.',
    whitePlans: ['Bb5+/Bxd7+ followed by c4 Maroczy clamp', 'Nc3/Be2/O-O simple development with a later e5 push', 'Bg5 + O-O-O targeting a weakened Black king'],
    blackPlans: ['...Nc6 gaining a tempo on the queen and preparing ...g6', '...a6 + ...Nc6 + ...g6 fianchetto setup', '...Bd7/...Nc6/...Nf6 solid development with a later ...e5 or ...d5'],
    pitfalls: ['Leaving the queen exposed to ...Nc6 + ...e5 double tempo', 'Allowing Bb5+ trades that freeze the c8-bishop'],
    motifs: ['Queen on d4 tempo-target', 'Maroczy Bind with c4', 'Bb5+ bishop trade'] },
  { name: 'KIA versus Sicilian', eco: 'B40', parent: 'sicilian-anti',
    moves: ['e4','c5','Nf3','e6','d3'],
    structure: 'White sets up a reversed KID: Nbd2, g3, Bg2, O-O and a later e4-e5 lever combined with kingside pawn pushes.',
    whitePlans: ['e4-e5 clamp followed by Nf1-h2-g4 and h4-h5', 'Re1/Nf1/Bf4 reroute aimed at f6 and h-file', 'Slow positional build when Black over-extends on the queenside'],
    blackPlans: ['...Nc6/...d5/...Nf6/...Be7 classical setup neutralising the clamp', '...d6/...Nf6/...Be7/...b5 Sicilian-flavoured counter', '...c4 queenside space-grab restricting d3'],
    pitfalls: ['Allowing h4-h5 to land unchallenged on a castled king', 'Releasing the tension with ...dxe4 too early'],
    motifs: ['e4-e5 clamp', 'h4-h5 kingside lever', '...c4 queenside grab'] },
  { name: 'Wing Gambit (Sicilian)', eco: 'B20', parent: 'sicilian-anti',
    moves: ['e4','c5','b4'],
    structure: 'White offers the b-pawn to pull the c5-pawn off the diagonal, aiming for a broad d4/e4 centre and open b-file.',
    whitePlans: ['a3/d4 rebuilding the centre and opening the b-file', 'Bb2 long-diagonal pressure combined with rapid development', 'Quick Nf3/Bc4/O-O seeking tactical chances in the centre'],
    blackPlans: ['Accept with ...cxb4 then ...d5 central counter-break', '...e5 transposing to King\'s Gambit style structures a pawn up', 'Decline with ...e6 or ...Nf6 reaching solid waters'],
    pitfalls: ['White failing to get d4 in lets Black keep a healthy extra pawn', 'Black greedy ...bxa3 can leave queenside pieces offside'],
    motifs: ['Central d4 lever', 'b-file pressure', 'Bb2 long diagonal'] },
  { name: 'Hyperaccelerated Dragon', eco: 'B27', parent: 'sicilian',
    moves: ['e4','c5','Nf3','g6'],
    structure: 'Black fianchettoes immediately, keeping the ...d6 or ...d5 break flexible and side-stepping several anti-Sicilian setups.',
    whitePlans: ['c3/d4 reaching an Alapin-style centre', 'd4 cxd4 Nxd4 with a Maroczy Bind c4 setup', 'Bc4/O-O/d3 quiet piece-play vs the fianchetto'],
    blackPlans: ['...Bg7/...Nc6/...d5 central counter-break', '...Bg7/...Nc6/...Nf6 transposing to Accelerated Dragon lines', '...Bg7/...d6 Dragon-style setup after Nxd4'],
    pitfalls: ['Missing the c3/d4 centre and allowing a Maroczy-like clamp', 'Playing ...d6 too early and giving White an easy Open Sicilian'],
    motifs: ['...d5 central break', 'Maroczy Bind avoidance', 'Long-diagonal fianchetto'] },

  // ═════════════════════ 1.e4 e5 ═════════════════════
  { name: 'Ruy Lopez — Closed Chigorin', eco: 'C97', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6','c3','O-O','h3','Na5'],
    structure: 'Classical Spanish chain (e4/d4 vs e5/d6); ...Na5 hits b3 then ...c5 clamps d4.',
    whitePlans: ['Build d4 + maneuver Nbd2-f1-g3', 'Close centre with d5 + kingside buildup', 'a4 probe on the queenside'],
    blackPlans: ['Trade c-pawn with ...c5 + ...Qc7', 'Reroute a5-knight back via ...Nc6/...Nb7', '...d5 only after White commits d5'],
    pitfalls: ['Premature ...exd4 concedes centre', 'Letting a5-knight get stranded after a4-a5'],
    motifs: ['Light-square bishop reroute Bc2-d3', 'd4-d5 advance', 'Nf1-g3 kingside swing'] },
  { name: 'Ruy Lopez — Berlin Defence', eco: 'C65', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','Nf6'],
    structure: 'Early ...Nf6; often leads to queen trade and endgame with Black doubled c-pawns + bishop pair.',
    whitePlans: ['Berlin Wall endgame via 4.O-O Nxe4 5.d4', '4.d3 keeping queens on', 'h3/g4 limiting bishop pair'],
    blackPlans: ['Accept endgame; use bishop pair + king centralisation', 'In 4.d3, prepare ...d6/...Bc5 slow maneuvering', '...c5-c4 queenside majority'],
    pitfalls: ['Pushing kingside pawns too fast weakens king', 'Playing for quick win when endgame calls for patience'],
    motifs: ['Bishop pair in endgame', 'Doubled c-pawns compensation'] },
  { name: 'Ruy Lopez — Marshall Attack', eco: 'C89', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','O-O','c3','d5'],
    structure: 'Black gambits a pawn after 8...d5 for long-term kingside attack.',
    whitePlans: ['Consolidate with d4, Qf3, g3', 'Trade queens to defuse attack', 'Return pawn for safe endgame'],
    blackPlans: ['Qf6-Qh3 + Bd6 for mating attack', 'Open f-file with ...f5-f4', 'Sac on g3 or h3'],
    pitfalls: ['Rushing attack before ...Qh3 set up', 'Allowing queen trade'],
    motifs: ['Queen lift to h3 via f6', 'Dark-square bishop on d6'] },
  { name: 'Ruy Lopez — Exchange', eco: 'C68', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Bxc6','dxc6'],
    structure: 'Black gets doubled c-pawns + bishop pair; White plays for endgame pawn-majority edge.',
    whitePlans: ['Head for endgame with better kingside majority', 'd3/Nbd2 slow maneuvering', 'Trade queens whenever possible'],
    blackPlans: ['Active bishop pair with ...Bd6/...f6', '...f5 kingside break', 'Trade light-squared bishops'],
    pitfalls: ['Trading bishop pair prematurely'],
    motifs: ['Bishop pair vs healthier majority', '...f6-f5 break'] },
  { name: 'Italian Game — Giuoco Piano', eco: 'C53', parent: 'italian',
    moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5','c3','Nf6','d4'],
    structure: 'Open centre after d4; Black pressures with Bb4+ check forcing critical decision.',
    whitePlans: ['6.Bd2 (safe) or 6.Nbd2 (sharp) after the check', 'Push e4-e5 attacking f6-knight', 'Qb3 targeting f7'],
    blackPlans: ['...Nxe4 exchange on c3 damaging structure', '...O-O + ...d5 break', 'Pressure d4-isolated pawn after trades'],
    pitfalls: ['Leaving f7 undefended to Qb3/Bxf7', 'Exchanging at wrong moment'],
    motifs: ['IQP positions', 'Diagonal pressure on f7/f2', '...d5 break'] },
  { name: 'Giuoco Pianissimo', eco: 'C50', parent: 'italian',
    moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5','d3','Nf6','O-O','d6','c3'],
    structure: 'Closed slow Italian with d3; both sides maneuver before committing.',
    whitePlans: ['Nbd2-f1-g3 kingside maneuver', 'Prepare d3-d4 at right moment', 'a4 queenside expansion'],
    blackPlans: ['Mirror with ...Nbd2-style maneuvering', '...a6 + ...Ba7', '...d5 break when ready'],
    pitfalls: ['Getting outmaneuvered without a clear plan', 'Missing the d5 break timing'],
    motifs: ['Slow maneuvering', 'Knight tours Nb1-d2-f1-g3'] },
  { name: 'Evans Gambit', eco: 'C51', parent: 'italian',
    moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5','b4'],
    structure: 'White sacs b-pawn for tempo and c3+d4 centre.',
    whitePlans: ['c3 + d4 building powerful centre', 'Ba3 pinning eventual d6 pawn', 'Rapid development for kingside attack'],
    blackPlans: ['Accept with ...Bxb4 then return pawn ...Bc5-a5', 'Decline with ...Bb6', '...d6 + ...Na5 defusing'],
    pitfalls: ['Greedy material grabbing', 'Leaving king in centre'],
    motifs: ['Pawn sac for activity', 'Central roller c3-d4'] },
  { name: 'Two Knights Defence', eco: 'C55', parent: 'italian',
    moves: ['e4','e5','Nf3','Nc6','Bc4','Nf6'],
    structure: 'Black challenges centrally allowing sharp 4.Ng5 attacking f7.',
    whitePlans: ['4.Ng5 attacking f7 for Fried Liver', '4.d3 quiet Italian', '4.d4 Scotch Gambit'],
    blackPlans: ['...d5 opening lines', '...Bc5 Traxler counter-attack', '...Na5 after 4.Ng5 d5'],
    pitfalls: ['Walking into Nxf7 Fried Liver unprepared'],
    motifs: ['f7 pressure point', '...d5 counter-blow'] },
  { name: 'Scotch Game', eco: 'C45', parent: 'scotch',
    moves: ['e4','e5','Nf3','Nc6','d4','exd4','Nxd4'],
    structure: 'Early centre opening; exchange of d-pawns leaves open position with rapid development.',
    whitePlans: ['4...Nf6 5.Nxc6 Mieses for structure imbalance', 'c3 + Nc3 classical development', 'Be3/Qd2 solid setup'],
    blackPlans: ['...Bc5 attacking d4-knight', '...Nf6 exchange on d4', '...Bb4+ check gaining tempo'],
    pitfalls: ['Leaving d4-knight exposed to ...Qh4 + ...Bc5'],
    motifs: ['Open centre tactics', '...Qh4 queen excursion'] },
  { name: 'Petroff Defence', eco: 'C42', parent: 'petroff',
    moves: ['e4','e5','Nf3','Nf6'],
    structure: 'Symmetrical counter-attack on e4; leads to solid simplified structures.',
    whitePlans: ['3.Nxe5 d6 4.Nf3 exchange for endgame', '3.d4 sharper centre', '3.Nc3 avoiding theory'],
    blackPlans: ['Copy to equality with ...Nxe4 + ...d5', '...Bd6 + ...O-O natural development', 'Avoid 3...Nxe4 without ...d6'],
    pitfalls: ['3...Nxe4 without ...d6 first loses pawn'],
    motifs: ['Symmetry-breaking tactics', 'Central pawn duo e4/d4 vs e5/d5'] },
  { name: 'Philidor Defence', eco: 'C41', parent: 'philidor',
    moves: ['e4','e5','Nf3','d6'],
    structure: 'Solid but passive; Black supports e5 accepting cramp.',
    whitePlans: ['d4 immediately for space', 'Nc3 + Be3 classical', 'Avoid Hanham with pre-emptive Nc3'],
    blackPlans: ['Hanham ...Nd7 + ...Ngf6 setup', '...exd4 + solid middlegame', '...g6 + ...Bg7 fianchetto'],
    pitfalls: ['Legal Trap Bxf7+ tactics', 'Getting passively squeezed'],
    motifs: ['Hanham setup knights d7/f6', 'Legal Trap tactics'] },
  { name: 'Vienna Game', eco: 'C25', parent: 'vienna',
    moves: ['e4','e5','Nc3'],
    structure: 'Flexible 2nd move; leads to Vienna Gambit 3.f4 or quiet positional play.',
    whitePlans: ['3.f4 Vienna Gambit for attack', '3.Bc4 Italian-like', '3.g3 Glek fianchetto'],
    blackPlans: ['...Nf6 Falkbeer setup', '...d5 challenging centre', '...Nc6 + ...Bc5 classical'],
    pitfalls: ['Fork tricks Bxf7+ / Nxe5', 'Frankenstein-Dracula complications'],
    motifs: ['f4 push for attack', 'Nd5 ideas'] },
  { name: "King's Gambit Accepted", eco: 'C33', parent: 'kings-gambit',
    moves: ['e4','e5','f4','exf4'],
    structure: 'Romantic gambit; Black captures on f4 leaving White open f-file after d4.',
    whitePlans: ['3.Nf3 preventing ...Qh4+', 'Kieseritzky (3.Nf3 g5 4.h4 g4 5.Ne5) sharp', 'Muzio sac for open lines'],
    blackPlans: ['Hold pawn with ...g5 + ...Bg7', 'Modern 3...d5 for equality', 'Fischer 3...d6 solid'],
    pitfalls: ['Losing g-pawn chain quickly', 'Opening king with ...g5 without prep'],
    motifs: ['f-file attack', 'Pawn sac for development'] },
  { name: 'Ruy Lopez — Zaitsev', eco: 'C92', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6','c3','O-O','h3','Bb7'],
    structure: 'Black places the queen-bishop on the long diagonal and keeps all pieces in play rather than rerouting the c6-knight; pressure against e4 becomes the main theme.',
    whitePlans: ['d4/Nbd2/a4 classical build aimed at a later d5', 'a4 probing the b5-chain combined with Bc2 redeployment', 'Ng3/Nh2-g4 kingside reroute for a later f4 or Nf5'],
    blackPlans: ['...Re8 + ...Bf8 reinforcing e5 and waiting for the right break', '...Nb8-d7 rerouting the knight to b6 or c5', '...exd4 followed by ...Nb4 or ...d5 in the right circumstances'],
    pitfalls: ['Allowing d5 without the ...c6/...Nb8 reroute prepared', 'Trading on d4 prematurely and abandoning the e5-square'],
    motifs: ['Long-diagonal pressure on e4', 'Central d4-d5 clamp', 'Kingside Ng3/Nh2-g4 reroute'] },
  { name: 'Ruy Lopez — Breyer', eco: 'C95', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6','c3','O-O','h3','Nb8'],
    structure: 'Black willingly retreats the c6-knight to reroute it via d7 to f8 or b6, building a resilient fortress around e5 before any break.',
    whitePlans: ['d4/Nbd2/Bc2 classical formation aimed at a later d5', 'a4 queenside probe combined with Nb3-a5 jumps', 'Slow kingside build with Nf1-g3 + Nh2-g4'],
    blackPlans: ['...Nbd7/...Bb7/...c5 rerouting the knight and contesting d4', '...Nf8-g6 kingside regrouping with later ...Nh5 or ...Nf4', '...c5-c4 shutting down b3 and building a queenside pawn wedge'],
    pitfalls: ['Drifting without a clear break and letting d5 freeze the game', 'Playing ...c5 too early and hanging the d-pawn'],
    motifs: ['Knight tour ...Nc6-b8-d7-f8-g6', '...c5-c4 queenside wedge', 'Central d4-d5 clamp'] },
  { name: 'Ruy Lopez — Smyslov', eco: 'C93', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6','c3','O-O','h3','h6'],
    structure: 'Black spends a tempo denying Bg5 and Ng5 ideas while keeping flexible Chigorin-style development options open.',
    whitePlans: ['d4/Nbd2/Nf1-g3 building a classical centre', 'a4 queenside pressure exploiting the slower setup', 'Slow build with Bc2/Qd3 aimed at a kingside attack after d5'],
    blackPlans: ['...Re8/...Bf8 transposing to Zaitsev-like setups', '...Nb8-d7 Breyer-style reroute at the right moment', '...Bb7 long-diagonal pressure'],
    pitfalls: ['Falling behind in development because of the waiting ...h6', 'Allowing d5 before the minor pieces have been rerouted'],
    motifs: ['...h6 prophylaxis', 'Flexible Chigorin regrouping', 'd4-d5 central clamp'] },
  { name: 'Anti-Marshall 8.h3', eco: 'C88', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','O-O','h3'],
    structure: 'White defuses the Marshall Attack by spending a tempo on h3, keeping the light-squared bishop protected and preparing a slower strategic game.',
    whitePlans: ['d4/c3/Nbd2 classical centre with a later d5', 'a4 probing the queenside before releasing the tension', 'Trade the light bishop via Nbd2-f1-g3 and Bc2'],
    blackPlans: ['...d6/...Nb8-d7 transposing to a Breyer', '...Bb7/...d6/...Re8 Zaitsev-style setup', '...d5 at the right moment despite the Anti-Marshall tempo'],
    pitfalls: ['Rushing ...d5 without the preparation the true Marshall requires', 'Letting White finish development then land d4-d5 unchallenged'],
    motifs: ['Prophylactic h3', 'Bishop reroute Bb3-c2', 'Central d4-d5 lever'] },
  { name: 'Anti-Marshall 8.a4', eco: 'C88', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','O-O','a4'],
    structure: 'White probes the b5-pawn before allowing ...d5, creating concrete questions on the queenside and side-stepping the Marshall entirely.',
    whitePlans: ['axb5 when ...b4 or ...Bb7 is inconvenient, followed by d3/Nbd2', 'c3/d4 reaching a classical Ruy after the probe', 'a5 clamping the queenside and cramping ...c6'],
    blackPlans: ['...b4 closing the queenside and breaking later with ...a5 or ...c6', '...Bb7 + ...Rb8 solid defence of the chain', '...d6 + ...Na5 hitting the b3-bishop'],
    pitfalls: ['Allowing axb5 axb5 Rxa8 with favourable structural changes', 'Playing ...b4 too early and stranding the a6-pawn'],
    motifs: ['a4-a5 queenside clamp', 'Minority-attack shell', 'Bishop trade via ...Na5'] },
  { name: 'Ruy Lopez — Old Steinitz', eco: 'C62', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','d6'],
    structure: 'Black backs up the e5-pawn early and accepts a cramped but solid setup, keeping central tension and delaying kingside development.',
    whitePlans: ['d4 immediately, exchanging to gain space and the d-file', 'c3/Bd3/O-O slow build against a cramped opponent', 'Bxc6+ bxc6 opening the b-file and targeting doubled pawns'],
    blackPlans: ['...Bd7/...Nf6/...Be7 quiet development accepting the squeeze', '...exd4 followed by ...Nf6/...Be7/...O-O', '...g6/...Bg7 fianchetto setup for counterplay'],
    pitfalls: ['Becoming entirely passive and allowing a clamping d4-d5', 'Losing the e5 square and with it all counter-chances'],
    motifs: ['Central d4 lever', 'Bxc6+ structure damage', 'Squeeze vs hedgehog defence'] },
  { name: 'Schliemann Defence', eco: 'C63', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','f5'],
    structure: 'Black strikes back immediately with a kingside pawn push, opening lines against the bishop on b5 and accepting structural concessions for piece activity.',
    whitePlans: ['4.Nc3 fxe4 5.Nxe4 entering the main theoretical jungle', '4.d3 solid prophylactic line avoiding complications', '4.exf5 grabbing the pawn and defending precisely'],
    blackPlans: ['...Nf6/...d5 opening the position for active pieces', '...fxe4 followed by ...d5/...Nf6 rapid development', 'Sac on f5 or e4 when White delays development'],
    pitfalls: ['Overextending and leaving the king wide open on the kingside', 'Allowing Nxe5 followed by Qh5+ tactical tricks'],
    motifs: ['Kingside line-opening', 'Central ...d5 break', 'Queen check on h5'] },
  { name: 'Ruy Lopez — Classical', eco: 'C64', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','Bc5'],
    structure: 'Black develops the king-bishop actively before committing to ...a6, challenging the Bb5 diagonally and hinting at sharp play around f2 and d4.',
    whitePlans: ['c3/d4 seeking an open centre with the bishop pair', 'O-O/Nc3/d3 quiet Italian-flavoured setup', 'Bxc6 + d4 exchange structure aiming for the endgame'],
    blackPlans: ['...Nf6/...O-O/...d6 solid classical development', '...f5 kingside expansion in sharp lines', '...d6/...Bg4 bishop-pair pressure in quieter structures'],
    pitfalls: ['Allowing c3 + d4 to land without a counter-break', 'Leaving the bishop on c5 exposed to Na4 hitting it'],
    motifs: ['Na4 bishop-chase', 'c3-d4 central lever', 'Bishop-pair squeeze after Bxc6'] },
  { name: 'Ruy Lopez — Bird Defence', eco: 'C61', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','Nd4'],
    structure: 'Black offers a knight trade on d4 to reach an imbalanced pawn structure with long-term bishop pair chances.',
    whitePlans: ['Nxd4 exd4 followed by O-O/c3/d3 targeting the advanced d-pawn', 'Bc4 sidestep keeping tension and fast development', 'd3/c3/O-O quiet squeeze against the bishop pair'],
    blackPlans: ['...c6/...d6/...Bd6 supporting the d-pawn and developing harmoniously', '...f5 kingside space with the bishop pair', '...Qf6/...Ne7 redeployment behind the d-pawn'],
    pitfalls: ['Pushing ...d5 too early and losing the d-pawn outright', 'Leaving the advanced d-pawn unsupported against c3 undermining'],
    motifs: ['Advanced-pawn vs bishop-pair trade-off', 'c3 undermining break', '...f5 kingside expansion'] },
  { name: 'Open Ruy Lopez', eco: 'C80', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Nxe4'],
    structure: 'Black grabs the e4-pawn and accepts an open middlegame with isolated or hanging pawns in exchange for active pieces and central counter-chances.',
    whitePlans: ['d4/Re1/c3/Nbd2 classical lever against the centralised knight', 'Nd4 or Bxc6 trades followed by pressure on the d-pawn', 'Queenside play with a4 combined with central squeeze'],
    blackPlans: ['...b5/...d5/...Be6 the standard classical development', '...Nc5 retreat followed by ...Bg4 or ...d5 support', '...Be7/...O-O/...f5 kingside expansion in sharper lines'],
    pitfalls: ['Allowing Bxc6 + d4-d5 structural collapse', 'Leaving the Nc5 or Ne4 short of support and losing a tempo'],
    motifs: ['Central IQP-like structures', 'Nc5 redeployment', '...f5 kingside space'] },
  { name: 'Scotch Four Knights', eco: 'C47', parent: 'scotch',
    moves: ['e4','e5','Nf3','Nc6','Nc3','Nf6','d4'],
    structure: 'An open centre with symmetrical piece development; play often hinges on the pin after ...Bb4 and the trade on c3.',
    whitePlans: ['Nxd4 followed by Bg5/Nxc6 seeking the bishop pair', 'Bd3/O-O/Nxc6 keeping tension and developing quickly', 'e5 lever gaining space when Black commits'],
    blackPlans: ['...Bb4 pinning and ...Bxc3 doubling pawns', '...exd4 Nxd4 ...Bb4 classical development', '...d5 central strike when White hesitates'],
    pitfalls: ['Letting e5 arrive before completing development', 'Leaving c6 weak after ...Bxc3 without compensation'],
    motifs: ['Central d-file opening', '...Bb4 pin', 'e4-e5 lever'] },
  { name: 'Scotch Gambit', eco: 'C44', parent: 'scotch',
    moves: ['e4','e5','Nf3','Nc6','d4','exd4','Bc4'],
    structure: 'White gambits the d-pawn for rapid piece development and direct central pressure, often transposing into sharp Italian or Two Knights structures.',
    whitePlans: ['c3 gambit line opening the centre after recapture', 'e5 pushing the f6-knight around and gaining tempi', 'O-O/Nxd4 quiet recovery of material with central pressure'],
    blackPlans: ['...Nf6/...Bc5 classical development and timely ...d6', '...Bb4+ check picking up a tempo', '...Bc5 + ...d6/...Nge7 holding the pawn solidly'],
    pitfalls: ['Greedy pawn-grabbing without developing pieces first', 'Allowing Ng5 + Qh5 combined attacks on f7'],
    motifs: ['Rapid development for a pawn', 'f7 pressure', 'Central e4-e5 lever'] },
  { name: 'Centre Game', eco: 'C22', parent: 'centre',
    moves: ['e4','e5','d4','exd4','Qxd4'],
    structure: 'White recaptures with the queen immediately, accepting some tempo loss for an early central occupation and the possibility of long castling with a quick kingside attack.',
    whitePlans: ['Nc3/Be3/Qd2/O-O-O followed by a pawn-storm on the kingside', 'Bg5/O-O-O pressuring f6 and h7 dark squares', 'Piece development aimed at meeting ...d5 with tactical blows'],
    blackPlans: ['...Nc6 gaining a tempo on the queen followed by ...Nf6/...Be7/...O-O', '...d5 central counter-break once the queen is pushed back', '...a6/...Nc6/...d6 flexible slower development'],
    pitfalls: ['Leaving the queen on d4 exposed to ...Nc6 + ...d5 tempi', 'Castling kingside into a prepared queenside attack'],
    motifs: ['Opposite-side castling race', 'Queen tempo-target', '...d5 central break'] },
  { name: 'Danish Gambit', eco: 'C21', parent: 'centre',
    moves: ['e4','e5','d4','exd4','c3'],
    structure: 'White gambits one or two pawns for long diagonal bishops and a raging initiative, aiming to break through on the kingside before Black completes development.',
    whitePlans: ['Bc4/Bb2 double-fianchetto-like setup eyeing f7 and g7', 'Nxc3 + rapid development with direct threats', 'Qb3/Bxf7+ or Bxg7 sacrifices in concrete lines'],
    blackPlans: ['Accept with ...dxc3 then give it all back with ...d5', '3...d5 immediate central return sidestepping complications', '...Bb4+/...Nc6/...d6 decline combined with development'],
    pitfalls: ['Grabbing every pawn offered and falling behind in development', 'Castling kingside into an already-prepared sacrificial attack'],
    motifs: ['Bishop pair on long diagonals', 'f7 and g7 pressure points', 'Central ...d5 return-break'] },
  { name: "Bishop's Opening", eco: 'C23', parent: 'bishops-opening',
    moves: ['e4','e5','Bc4'],
    structure: 'Immediate development of the king-bishop to its most active square; sidesteps Petroff and often transposes into Italian, King\'s Gambit Declined, or Vienna structures.',
    whitePlans: ['d3/Nc3/Nf3 reaching an Italian with extra options', 'f4 Vienna-style kingside push after Nc3', 'Qe2/d3/Nf3 + long-diagonal squeeze'],
    blackPlans: ['...Nf6/...Bc5/...d6 classical development', '...Nc6/...Nf6/...Bb4+ Berlin-style pin', '...Nc6/...d6/...Be7 flexible slow play'],
    pitfalls: ['Allowing the f4 break without a counter-plan', 'Walking into Qh5/Bxf7+ tactical tricks on the unsafe king'],
    motifs: ['f7 pressure with Bc4', 'Central d3/f4 structures', 'Transposition gateway'] },
  { name: 'Ponziani Opening', eco: 'C44', parent: 'ponziani',
    moves: ['e4','e5','Nf3','Nc6','c3'],
    structure: 'An early c3 prepares d4 without committing pieces, at the cost of a tempo and slightly offbeat move-order concessions.',
    whitePlans: ['d4 centre-grab with tactics on the e-file', 'Bb5/Qa4 pressure on the c6-knight', 'Quiet d3/Bd3/O-O build with a later d4'],
    blackPlans: ['...Nf6 attacking e4 immediately', '...d5 central counter-strike exploiting the slow c3', '...f5 Jaenisch-style counter-gambit in rarer lines'],
    pitfalls: ['Allowing d4 cxd4 and a free open centre for the white pieces', 'Missing the ...d5 counter-strike and ending up cramped'],
    motifs: ['Central d4 lever', '...d5 counter-break', 'Queen sortie Qa4'] },
  { name: 'Latvian Gambit', eco: 'C40', parent: 'latvian',
    moves: ['e4','e5','Nf3','f5'],
    structure: 'Black attacks the centre on move two with an aggressive pawn thrust, accepting serious king-safety concessions for piece activity and surprise value.',
    whitePlans: ['Nxe5 Qf6 d4 quiet refutation taking the initiative', 'exf5 grabbing the pawn and consolidating', 'Bc4 development keeping tension and targeting f7'],
    blackPlans: ['...Qf6/...fxe4 opening lines for pieces', '...Nc6/...d6 attempting to justify the pawn with activity', 'Accept material losses for tactical chances in sharp lines'],
    pitfalls: ['Leaving the king stuck in the centre after ...fxe4', 'Allowing Bc4 + Nxe5 combined attacks on f7'],
    motifs: ['King-in-centre tactics', 'f7 pressure', '...Qf6 queen sortie'] },
  { name: 'Elephant Gambit', eco: 'C40', parent: 'elephant',
    moves: ['e4','e5','Nf3','d5'],
    structure: 'Black throws the d-pawn forward immediately, seeking unbalanced, tactical positions at the cost of sound structure and central control.',
    whitePlans: ['exd5 Nxd5 Nxe5 or exd5 e4 Qe2 sharp refutation', 'Quiet d3/Nc3 development refusing complications', 'Bb5+/Nxe5 combined development and material grab'],
    blackPlans: ['Gambit lines with ...e4/...Qxd5 for central activity', '...Bd6/...Nf6 rapid piece development at pawn cost', 'Transposition attempts into other gambits via move-order tricks'],
    pitfalls: ['Ignoring king safety and walking into standard refutations', 'Overextending pieces without concrete threats'],
    motifs: ['Central ...e4 thrust', 'Queen recapture on d5', 'Tactical shots on e-file'] },

  // ═════════════════════ SEMI-OPEN (French / Caro / etc.) ═════════════════════
  { name: 'French Winawer', eco: 'C15', parent: 'french',
    moves: ['e4','e6','d4','d5','Nc3','Bb4'],
    structure: 'Black pins Nc3, inviting doubled c-pawns for light-square bind + dark-square trumps.',
    whitePlans: ['a3 forcing Bxc3+ using half-open b-file + bishop pair', 'Qg4 hitting g7', 'Strong e5 chain + h4-h5'],
    blackPlans: ['Target doubled c3/c4 with ...c5/...Qa5/...Ne7-f5', 'Blockade d5/e4 with ...b6/...Ba6 trade', 'Counter Qg4 with ...Qc7 or ...Kf8'],
    pitfalls: ['Drifting into passivity + failing to contest c-file', 'Castling kingside into ...h5-h4 storm'],
    motifs: ['Light-square bishop trade ...b6/...Ba6', 'g7 weakness after Qg4'] },
  { name: 'French Classical', eco: 'C11', parent: 'french',
    moves: ['e4','e6','d4','d5','Nc3','Nf6'],
    structure: 'Classical pawn-chain middlegame with pressure on e5/d4.',
    whitePlans: ['Push e5 forcing Nfd7 + kingside space', 'Bg5 pinning + dark-square pressure', 'Castle long + kingside storm'],
    blackPlans: ['Undermine with ...c5 + ...f6', 'Trade dark bishops to relieve cramp', '...Qb6 hitting d4/b2'],
    pitfalls: ['Releasing tension with ...dxe4 prematurely', 'Allowing Bxf6 gxf6 when king unsafe'],
    motifs: ['Pawn-chain levers c5/f6', 'Dark-square bishop problem'] },
  { name: 'French Advance', eco: 'C02', parent: 'french',
    moves: ['e4','e6','d4','d5','e5'],
    structure: 'White locks centre early; Black attacks base at d4.',
    whitePlans: ['Defend d4 with c3/Nf3/Be2', 'Exchange dark bishops Bd2-a5', 'Kingside expansion'],
    blackPlans: ['Pressure d4 with ...c5/...Nc6/...Qb6', 'Activate bad bishop via ...Bd7-b5 or ...Nge7-f5', '...f6 break with heavy pieces'],
    pitfalls: ['...Qxb2 greedily allowing Nb5 traps'],
    motifs: ['b2/d4 fork points', 'Knight reroute to f5 via e7'] },
  { name: 'French Tarrasch', eco: 'C05', parent: 'french',
    moves: ['e4','e6','d4','d5','Nd2'],
    structure: 'White keeps c-pawn free; closed pawn-chain or IQP structures.',
    whitePlans: ['After ...c5 recapture with piece + Ngf3/Bd3/O-O', 'Closed: play for e5 + Ne2-f4', 'Play against isolated d5'],
    blackPlans: ['...c5 immediately for activity', '...Nf6 classical or ...Nc6 main line', '...b6/...Ba6 or ...Bd7-b5'],
    pitfalls: ['Allowing e5 wedge to stabilise'],
    motifs: ['IQP Nf3-e5 outpost', 'Minor piece trades on c-file'] },
  { name: 'French Winawer Main Line', eco: 'C18', parent: 'french',
    moves: ['e4','e6','d4','d5','Nc3','Bb4','e5','c5','a3','Bxc3+','bxc3'],
    structure: 'White accepts doubled c-pawns and the bishop pair in return for a massive central pawn chain and attacking chances against the Black king.',
    whitePlans: ['Qg4 hitting g7 and provoking kingside weakening', 'Nf3/Bd3/O-O completing development before launching h4-h5', 'Exchange queens with Qd2 when ...Qa5 arrives, reaching a structural endgame'],
    blackPlans: ['...Qc7/...Nbc6/...Nge7/...Bd7 rapid development targeting c3', '...Qa5 pinning the c3-pawn and provoking queen exchanges', '...Ne7-f5 redeploying to the strongest central outpost'],
    pitfalls: ['Castling kingside straight into a prepared h4-h5 storm', 'Failing to contest the c-file and letting the queenside solidify'],
    motifs: ['Doubled c-pawn structural target', 'Qg4 attack on g7', 'Knight on f5 outpost'] },
  { name: 'Winawer Poisoned Pawn', eco: 'C18', parent: 'french',
    moves: ['e4','e6','d4','d5','Nc3','Bb4','e5','c5','a3','Bxc3+','bxc3','Ne7','Qg4','Qc7','Qxg7','Rg8','Qxh7','cxd4'],
    structure: 'An unbalanced material race in which White wins two flank pawns while Black opens every central line for attack.',
    whitePlans: ['Ne2/Qd3 defence aiming to consolidate the extra pawns', 'Rapid piece development to support the king stuck in the centre', 'Offer back material to trade into an endgame with extra pawns'],
    blackPlans: ['...Qxc3+/...Qxa1 grabbing material back with attack', '...Nbc6/...Bd7/...O-O-O rapid queenside castle and central push', 'Sacrifice on e5 or d4 to break open the white king'],
    pitfalls: ['Making a single inaccurate move in a heavily theoretical line', 'Trading queens into a lost endgame down material'],
    motifs: ['Central piece-sac breakthroughs', 'Opposite-side race', 'King-in-centre hunt'] },
  { name: 'French Classical Steinitz', eco: 'C11', parent: 'french',
    moves: ['e4','e6','d4','d5','Nc3','Nf6','e5','Nfd7','f4'],
    structure: 'White locks the centre with e5 and supports it with f4, preparing Nf3 and kingside play against a cramped black formation.',
    whitePlans: ['Nf3/Be3/Qd2/O-O-O followed by f5 or kingside pawn push', 'Ne2/c3 supporting d4 when the centre is under pressure', 'Trade the dark-squared bishops via Be3-Bd2 to relieve cramp for White'],
    blackPlans: ['...c5 undermining combined with ...Nc6/...Qb6 pressure on d4', '...f6 challenging the e5-wedge at the right moment', '...b6/...Ba6 exchanging the problem bishop on the a6-f1 diagonal'],
    pitfalls: ['Releasing tension with ...cxd4 Nxd4 too early and reducing counter-chances', 'Allowing f5 breakthrough unchallenged'],
    motifs: ['Pawn-chain lever c5/f6', 'f4-f5 kingside push', '...Qb6 central pressure'] },
  { name: 'French McCutcheon', eco: 'C12', parent: 'french',
    moves: ['e4','e6','d4','d5','Nc3','Nf6','Bg5','Bb4'],
    structure: 'Black pins the c3-knight immediately and accepts sharp complications rather than retreat into classical French positions.',
    whitePlans: ['e5 h6 Bd2 Bxc3 bxc3 kingside attack with Qg4', 'Exchange on f6 combined with quick development', 'Ne2/a3/Bxc3 preserving structure and trading into a middlegame edge'],
    blackPlans: ['...Bxc3+/bxc3 Ne4 active piece play with central counter-break', '...h6/...Bxc3+ followed by ...Ne4/...c5', '...Qxd4 or ...Ne4 tactical shots in the sharpest lines'],
    pitfalls: ['Allowing the white queen to land on g4 with tempo on g7', 'Misplacing the knight on e4 without supporting ...c5'],
    motifs: ['Ne4 central outpost', '...Bxc3 doubled-pawn plan', 'Qg4 attacking the kingside'] },
  { name: 'French Rubinstein', eco: 'C10', parent: 'french',
    moves: ['e4','e6','d4','d5','Nc3','dxe4','Nxe4'],
    structure: 'Black releases central tension voluntarily, accepting a small space deficit in exchange for a solid structure and clear development of the problem bishop.',
    whitePlans: ['Nf3/Bd3/O-O/c3 quiet build with a slight space edge', 'Ng3/h4-h5 preparing a kingside attack', 'Trade bishops with Bxe4 or Bg5 reducing Black activity'],
    blackPlans: ['...Nd7/...Ngf6/...Be7/...O-O classical solid setup', '...Bd7-c6 or ...b6/...Bb7 activating the light bishop', '...c5 central break at the right moment'],
    pitfalls: ['Falling into purely passive play without any break', 'Allowing Ne4-f6+ tactical tricks in the early middlegame'],
    motifs: ['Knight on e4/f6 outpost', 'Light-bishop development problem', 'Central ...c5 lever'] },
  { name: 'French Burn', eco: 'C11', parent: 'french',
    moves: ['e4','e6','d4','d5','Nc3','Nf6','Bg5','dxe4'],
    structure: 'Black voluntarily trades in the centre, accepting bishop-pair concessions in return for solid structure and straightforward development.',
    whitePlans: ['Nxe4/Bxf6 gxf6 seeking to exploit the doubled f-pawns', 'Nxe4/Bxf6 Nxf6 keeping tension and finishing development', 'Slow positional squeeze using the e-file and better structure'],
    blackPlans: ['...Nbd7/...Be7/...O-O solid development after the trade', '...gxf6 with a later ...f5 kingside space-grab', '...b6/...Bb7/...c5 central counter-play'],
    pitfalls: ['Allowing Bxf6 Qxf6 Nxe4 winning a pawn or piece in concrete lines', 'Drifting into passivity with the doubled pawns'],
    motifs: ['Doubled f-pawn structures', '...f5 kingside expansion', 'Bg5 pin pressure'] },
  { name: 'French Fort Knox', eco: 'C10', parent: 'french',
    moves: ['e4','e6','d4','d5','Nc3','dxe4','Nxe4','Bd7'],
    structure: 'Black sets up a rock-solid pawn structure and plans to exchange the light-squared bishop via Bc6, removing the traditional bad bishop of the French.',
    whitePlans: ['Nf3/Bd3/O-O with a space advantage and slow play', 'Ng3/h4 combined with c3 preparing a kingside attack', 'Exchange on c6 or e4 to keep structural pressure'],
    blackPlans: ['...Bc6 trading the problem bishop off the board', '...Nd7/...Ngf6/...Be7/...O-O completing development', '...c5 or ...e5 central break only when fully developed'],
    pitfalls: ['Making the ...Bc6 trade at the wrong moment and dropping a pawn', 'Staying completely passive without any break'],
    motifs: ['Light-bishop trade via ...Bc6', 'Solid pawn triangle', 'Central ...c5 lever'] },
  { name: 'KIA versus French', eco: 'C00', parent: 'french',
    moves: ['e4','e6','d3'],
    structure: 'White declines the main French by entering a reversed King\'s Indian structure, often aiming for a slow build and an e4-e5 kingside clamp.',
    whitePlans: ['Nd2/Ngf3/g3/Bg2/O-O completing the reversed KID setup', 'e4-e5 clamp followed by Nf1-h2-g4 and h4-h5', 'c3 + d4 reaching a classical centre when Black hesitates'],
    blackPlans: ['...d5/...Nf6/...Bd6/...Nc6/...O-O classical solid development', '...c5 queenside space combined with ...Nc6/...b5', '...c4/...b5 queenside push gaining space'],
    pitfalls: ['Falling asleep on the queenside while White prepares h4-h5', 'Playing too slowly and allowing e4-e5 to clamp permanently'],
    motifs: ['Reversed KID structure', 'Opposite-wing pawn race', 'e4-e5 clamp'] },
  { name: 'Caro-Kann Classical', eco: 'B18', parent: 'caro-kann',
    moves: ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Bf5'],
    structure: 'Black develops light-squared bishop outside the pawn chain before ...e6.',
    whitePlans: ['Kick bishop with Ng3 Bg6 h4-h5', 'Nf3/Bd3/O-O pressuring kingside', 'Minority attack endgame edge'],
    blackPlans: ['Complete ...Nd7/...Ngf6/...e6/...Be7/...O-O', 'Accept slight kingside weakening', 'Trade pieces neutralising space'],
    pitfalls: ['Allowing h5 before retreating bishop to h7', 'Castling long into ...c5/...Qa5 storm'],
    motifs: ['h4-h5 bishop-chase', 'Qb6 pressure in endgames'] },
  { name: 'Caro-Kann Advance', eco: 'B12', parent: 'caro-kann',
    moves: ['e4','c6','d4','d5','e5'],
    structure: 'White grabs space; Black develops Bc8 to f5 freely avoiding French bad bishop.',
    whitePlans: ['Challenge Bf5 with Nf3/Be2/Nh4 or g4 Short system', 'c3/h4-h5 kingside space', 'Nf5 outpost'],
    blackPlans: ['...e6/...c5/...Nc6/...Nge7-f5 trading e5 chain', '...c5 hitting d4', '...Qb6 pressuring b2/d4'],
    pitfalls: ['Bishop exposed to Nh4', 'Over-extending with g4 weakening king'],
    motifs: ['Short-system g4 expulsion', 'Knight outpost f5'] },
  { name: 'Caro-Kann Panov-Botvinnik', eco: 'B14', parent: 'caro-kann',
    moves: ['e4','c6','d4','d5','exd5','cxd5','c4'],
    structure: 'IQP structure against Black reminiscent of QGD lines.',
    whitePlans: ['Nc3/Nf3/Bd3 or Bg5 pressuring d5 + kingside', 'Exploit central activity', 'Target isolated d-pawn'],
    blackPlans: ['Blockade with ...Nb6 after ...Nc6/...e6/...Be7', 'Simplifications trading heavies', '...g6 fianchetto counter-pressure'],
    pitfalls: ['Mishandling piece placement in attack'],
    motifs: ['IQP attack vs blockade', 'Nb6/Nb4 blockade squares'] },
  { name: 'Scandinavian Main', eco: 'B01', parent: 'scandinavian',
    moves: ['e4','d5','exd5','Qxd5','Nc3','Qa5'],
    structure: 'Black accepts tempo loss for clean structure.',
    whitePlans: ['d4/Nf3/Bc4/Bd2 gaining tempi', 'a3/b4 queenside pressure', 'Exploit queen with Nd5'],
    blackPlans: ['...Nf6/...c6/...Bf5 or ...Bg4/...e6/...Nbd7', 'Solid Caro-like ...c6 structure'],
    pitfalls: ['Queen exposed to b4/Nd5 hits'],
    motifs: ['Tempo-gain development', 'c6-d5 pawn triangle'] },
  { name: 'Pirc Classical', eco: 'B08', parent: 'pirc',
    moves: ['e4','d6','d4','Nf6','Nc3','g6','Nf3','Bg7','Be2'],
    structure: 'White solid centre; Black hypermodern fianchetto counterpunch.',
    whitePlans: ['Short castle + Re1 + c4 expansion', 'Meet ...e5 with d5 or exchange', 'h3/Be3/Qd2 slow build'],
    blackPlans: ['...e5 undermining d4', '...Nc6 or ...Nd7 setup', '...c6/...b5 queenside expansion'],
    pitfalls: ['Playing passively allows unopposed centre'],
    motifs: ['Central ...e5 break', 'Fianchetto pressure on d4'] },
  { name: 'Modern Defence', eco: 'B06', parent: 'modern',
    moves: ['e4','g6'],
    structure: 'Black delays ...Nf6 keeping maximum flexibility.',
    whitePlans: ['Broad centre c4/Nc3/d4', 'Austrian-style f4 setup', '150 Attack Be3/Qd2/O-O-O'],
    blackPlans: ['...d6/...Nd7/...c6/...b5 queenside play', 'Postpone ...Nf6 avoiding f4-f5 tempo gain'],
    pitfalls: ['Allowing c4 centre without counterplay'],
    motifs: ['Delayed ...Nf6 flexibility', '...a6/...b5 queenside counter'] },
  { name: 'Alekhine Defence Modern', eco: 'B04', parent: 'alekhine',
    moves: ['e4','Nf6','e5','Nd5','d4','d6','Nf3'],
    structure: 'White develops solidly with Nf3 avoiding Four Pawns.',
    whitePlans: ['Nf3/Be2/O-O + c4 maintaining space', 'Meet ...Bg4 with h3 or Be2', 'Main line Bc4/c3 flexible'],
    blackPlans: ['...Bg4 pin + ...e6/...Be7/...O-O', '...dxe5 Nxe5 + ...c6', '...Nb6 or ...Nd7 rerouting'],
    pitfalls: ['Ng5 tactics after mistimed ...Bg4 trades'],
    motifs: ['Bg4 pin leverage', '...c6/...e6 solidifying'] },
  { name: 'Caro-Kann Two Knights', eco: 'B11', parent: 'caro-kann',
    moves: ['e4','c6','Nc3','d5','Nf3'],
    structure: 'White develops knights before resolving the central tension, inviting sharp lines after ...Bg4 or a quick transposition to main-line Caro structures.',
    whitePlans: ['h3 kicking the bishop and following up with g4/Nh4 aggressive play', 'd4/Bd3/O-O reaching a classical Caro-Kann centre', 'exd5 cxd5 with Bd3/Bb5+ piece pressure'],
    blackPlans: ['...Bg4 pin followed by ...e6/...Nf6/...Be7', '...dxe4 Nxe4 Nf6 entering main-line Caro structures', '...Nf6/...dxe4 trade followed by ...Bf5 deployment'],
    pitfalls: ['Allowing the h3/g4 bishop-chase to gain a pawn or structure', 'Trading on e4 too early and letting White dictate tempo'],
    motifs: ['Bg4 pin leverage', 'g4 kingside push', 'Central ...dxe4 trade'] },
  { name: 'Caro-Kann Fantasy', eco: 'B12', parent: 'caro-kann',
    moves: ['e4','c6','d4','d5','f3'],
    structure: 'White props up the e4-pawn with a pawn rather than a piece, accepting kingside weaknesses in exchange for a broad centre and the chance to launch a kingside attack.',
    whitePlans: ['Be3/Nc3/Qd2/O-O-O and a kingside pawn push', 'c4 expanding centrally once Black commits', 'Trade on e4 combined with a Be3/Nc3 development plan'],
    blackPlans: ['...dxe4 fxe4 e5 challenging the centre immediately', '...g6/...Bg7 fianchetto setup pressuring the long diagonal', '...e6/...Nf6/...Bd6 classical solid development'],
    pitfalls: ['Overextending with kingside pushes before piece development', 'Allowing Black ...e5 freeing break to open the centre with an undeveloped king'],
    motifs: ['Big central pawn formation', 'g-file and h-file kingside attack', '...e5 central break'] },
  { name: 'Caro-Kann Bronstein-Larsen', eco: 'B16', parent: 'caro-kann',
    moves: ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nf6','Nxf6+','gxf6'],
    structure: 'Black voluntarily doubles the f-pawns to gain the open g-file and dynamic piece activity against the White king.',
    whitePlans: ['c3/Bc4/Qe2/O-O-O and a rapid queenside castle', 'Nf3/Bd3/O-O classical setup targeting the structural damage', 'Trade queens to neutralise Black\'s dynamic chances'],
    blackPlans: ['...Bf5/...Qc7/...Nd7/...O-O-O sharp race with opposite castling', '...Rg8 using the open g-file for attack', '...e6/...Bd6/...Qc7 piece mobilisation'],
    pitfalls: ['Castling kingside into the open g-file with no defence', 'Trading queens without compensation for the structural damage'],
    motifs: ['Open g-file attack', 'Opposite-side castling race', 'Dynamic piece play over structure'] },
  { name: 'Caro-Kann Karpov', eco: 'B17', parent: 'caro-kann',
    moves: ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Nd7'],
    structure: 'Black prepares ...Ngf6 without allowing the double-capture on f6, keeping the kingside pawn shell intact at the cost of a small tempo.',
    whitePlans: ['Nf3/Bc4/Qe2/O-O-O combined with a later c3/Ne5 or kingside push', 'Ng5 targeting f7 with Bd3/Qe2', 'Bc4/Qe2/Ng5 direct attack on f7 and e6'],
    blackPlans: ['...Ngf6/...e6/...Be7/...O-O solid classical setup', '...h6 preventing Ng5 before completing development', 'Trade queens when offered and head for a solid endgame'],
    pitfalls: ['Allowing Ng5 followed by Qe2/Nxf7 combined sacrifices', 'Developing the light-bishop badly and ending up cramped'],
    motifs: ['Ng5 attack on f7', 'Central Ne5 outpost', 'Solid light-square shell'] },
  { name: 'Pirc Austrian Attack', eco: 'B09', parent: 'pirc',
    moves: ['e4','d6','d4','Nf6','Nc3','g6','f4'],
    structure: 'White throws pawns forward on the kingside to grab space and launch a direct attack, accepting that the centre may become fragile.',
    whitePlans: ['Nf3/Bd3/O-O/Qe1-h4 classical kingside attack setup', 'e5 kicking the knight and gaining even more space', 'Bd3/O-O/Kh1/Qe1 and a kingside pawn storm'],
    blackPlans: ['...Bg7/...O-O/...c5 central counter-break', '...Nc6/...e5 hitting the centre immediately', '...Na6-c7/...c5/...b5 queenside counter-play'],
    pitfalls: ['Allowing e5 to clamp while the centre is not yet tested', 'Castling kingside into the looming f4-f5-f6 push'],
    motifs: ['f4-f5 pawn lever', 'e4-e5 central clamp', '...c5 queenside break'] },
  { name: 'Pirc 150 Attack', eco: 'B07', parent: 'pirc',
    moves: ['e4','d6','d4','Nf6','Nc3','g6','Be3'],
    structure: 'White aims for a straightforward attacking scheme with Qd2/O-O-O/f3 and a kingside pawn storm, mirroring ideas from the English Attack against the Sicilian.',
    whitePlans: ['Qd2/O-O-O/f3/g4-g5 direct kingside attack', 'Bh6 trading the fianchetto bishop before the storm', 'h4-h5 push combined with Nh3-Nf2 support'],
    blackPlans: ['...Bg7/...O-O/...a6/...b5 counter-attack with opposite castling', '...Nbd7/...c6/...Qa5 central and queenside pressure', '...e5 central break when White is over-committed to the kingside'],
    pitfalls: ['Allowing Bh6 trade plus h4-h5 without counter-play', 'Castling kingside into an established queenside attacking setup'],
    motifs: ['Bh6 bishop trade', 'h4-h5-g5 pawn storm', 'Opposite-side castling race'] },
  { name: 'Pirc Byrne System', eco: 'B07', parent: 'pirc',
    moves: ['e4','d6','d4','Nf6','Nc3','g6','Bg5'],
    structure: 'White develops the dark-squared bishop actively before committing to a pawn structure, pressuring f6 and keeping multiple attacking ideas in reserve.',
    whitePlans: ['Qd2/O-O-O/f3 combined with a quick kingside pawn storm', 'Bxf6 exf6 followed by Qd2/O-O-O structural exploitation', 'Nf3/Be2/Qd2 quieter build preserving the bishop pair'],
    blackPlans: ['...Bg7/...O-O/...c6/...b5 standard queenside counter', '...h6/...Bg7 questioning the bishop before committing', '...c5 or ...e5 central break at the right moment'],
    pitfalls: ['Allowing Bxf6 exf6 combined with a quick kingside push', 'Drifting without a clear queenside or central plan'],
    motifs: ['Bxf6 pin trade', 'Opposite-side castling race', '...c5 central counter'] },
  { name: "Monkey's Bum", eco: 'B06', parent: 'modern',
    moves: ['e4','g6','d4','Bg7','Nc3','d6','Bc4'],
    structure: 'White develops the bishop on c4 pointing at f7 before committing to a full centre, waiting to punish Black\'s lack of a committed central pawn.',
    whitePlans: ['Qe2/Nge2 or Nf3 with O-O and a direct kingside build', 'e5 break combined with tactical threats against f7', 'Ng5 tactics targeting f7 when ...Nf6 arrives'],
    blackPlans: ['...Nf6 followed by ...e6/...O-O neutralising the bishop', '...Nc6/...e6 challenging the centre solidly', '...c6/...b5 queenside kick followed by ...Bb7'],
    pitfalls: ['Playing ...Nf6 without preparation and walking into Bxf7+ tactics', 'Castling kingside while the bishop still stares at f7'],
    motifs: ['Bxf7+ sacrifice on an undeveloped king', 'Bc4/Qe2 battery', 'Central e4-e5 lever'] },
  { name: 'Alekhine Four Pawns', eco: 'B03', parent: 'alekhine',
    moves: ['e4','Nf6','e5','Nd5','d4','d6','c4','Nb6','f4'],
    structure: 'White grabs maximum central space with four connected pawns, betting that the rolling centre and space advantage outweigh the slow development and kingside weaknesses.',
    whitePlans: ['Nf3/Be2/O-O consolidating before f5 or d5 levers', 'Nc3/Be3/Qd2 supporting the centre and reserving attacking options', 'f5 or d5 pawn lever at the right moment to roll the centre'],
    blackPlans: ['...dxe5 fxe5 followed by ...Nc6/...Bf5 pressuring the centre', '...Bf5/...e6/...Be7/...O-O piece pressure around the pawn mass', '...c5 central break dissolving the structure'],
    pitfalls: ['Premature pushes that abandon the rear-guard of the centre', 'Allowing ...c5 break without sufficient support'],
    motifs: ['Rolling pawn centre', 'Piece pressure on over-extended pawns', 'Central ...c5 lever'] },
  { name: 'Alekhine Exchange', eco: 'B03', parent: 'alekhine',
    moves: ['e4','Nf6','e5','Nd5','d4','d6','c4','Nb6','exd6'],
    structure: 'White simplifies into a calmer game with a queenside pawn majority, giving up some ambition for a clean structural plus.',
    whitePlans: ['Nc3/Nf3/Be2/O-O/b3 slow build with a space edge', 'cxd6 or exd6 depending on move order, heading for a better endgame', 'Play against the backward c-pawn after fixed structure'],
    blackPlans: ['...cxd6 natural recapture followed by ...Nc6/...g6/...Bg7', '...exd6 keeping the light-bishop active on the h3-c8 diagonal', '...Nc6/...Bg4/...e5 central counter-play'],
    pitfalls: ['Accepting a doubled pawn without compensating piece activity', 'Drifting into passive positions without any break'],
    motifs: ['Queenside pawn majority', 'Minority attack with b4-b5', 'Slow positional squeeze'] },
  { name: 'Alekhine Chase Variation', eco: 'B02', parent: 'alekhine',
    moves: ['e4','Nf6','e5','Nd5','c4','Nb6','c5'],
    structure: 'White chases the knight again with the c-pawn, grabbing further space but leaving dark-square weaknesses and the d5-hole.',
    whitePlans: ['Rapid development with Nc3/d4/Bd3/Nf3 maximising the space advantage', 'Bc4/Nf3/O-O combined with d4 central build', 'Preserve the advanced pawn and prevent ...d6 breaks'],
    blackPlans: ['...Nd5/...d6 hitting the pawn chain immediately', '...Nd5 followed by ...e6/...c6 and piece play against the over-extended pawns', '...d6 cxd6 cxd6 opening central files'],
    pitfalls: ['Allowing ...d6 breaks without enough support for the pawn chain', 'Overextending and losing the pawn without compensation'],
    motifs: ['Space vs holes trade-off', '...d6 central break', 'Dark-square weaknesses'] },
  { name: 'Scandinavian Modern', eco: 'B01', parent: 'scandinavian',
    moves: ['e4','d5','exd5','Nf6'],
    structure: 'Black delays recapturing the pawn to develop a piece with tempo and avoid the queen exposure of the main line.',
    whitePlans: ['d4/c4 supporting the extra pawn and preparing to give it back advantageously', 'Nf3/Bb5+/Bc4 classical rapid development', 'c4/d4/Nc3 broad centre aiming to punish the pawn sacrifice'],
    blackPlans: ['...Nxd5/...c6 classical development plan', '...Bg4/...Nbd7/...e6 piece pressure around the d5-pawn', '...Qxd5/...Qa5 transposing into main-line structures'],
    pitfalls: ['Recapturing on d5 too quickly and wasting the tempo', 'Allowing c4/d4 without a concrete piece play plan'],
    motifs: ['Tempo-gaining knight development', 'Central pawn pressure', '...Bg4 pin leverage'] },
  { name: 'Portuguese Scandinavian', eco: 'B01', parent: 'scandinavian',
    moves: ['e4','d5','exd5','Nf6','d4','Bg4'],
    structure: 'Black places the light bishop outside the pawn chain and prepares a gambit with ...Bxf3 followed by recapture on d5 and active development.',
    whitePlans: ['f3 chasing the bishop combined with c4 central build', 'Bb5+/Qd2 and queenside castling for an attack', 'Nf3/Be2 simple development returning the pawn when convenient'],
    blackPlans: ['...Bxf3 gxf3/Qxf3 followed by ...Qxd5 active queen placement', '...c6 offering the pawn back in exchange for rapid development', '...Nbd7/...e6/...Bb4+ sharp development with concrete threats'],
    pitfalls: ['Taking the bait too early when the refutation lines are precise', 'Allowing White to hold the pawn and develop comfortably'],
    motifs: ['...Bxf3 structural damage', 'Central ...Qxd5 active placement', 'Gambit-style rapid development'] },

  // ═════════════════════ QUEEN'S GAMBIT ═════════════════════
  { name: 'QGD Orthodox', eco: 'D60', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O','Nf3','Nbd7'],
    structure: 'Classical symmetrical pawn chain; Black light-squared bishop locked behind e6.',
    whitePlans: ['Minority attack b4-b5 creating weak c6', 'Central e3-e4 break after Qc2/Bd3/Rad1', 'Kingside space Ne5 + f4'],
    blackPlans: ['Freeing ...c5 or ...dxc4 + ...c5', '...b6/...Bb7 Tartakower', '...Ne4 Lasker trade'],
    pitfalls: ['Premature ...c5 drops d5', 'Bad bishop mismanagement'],
    motifs: ['Minority attack b4-b5xc6', 'Pillsbury knight on e5', 'e3-e4 lever'] },
  { name: 'QGD Exchange (Carlsbad)', eco: 'D35', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','cxd5','exd5'],
    structure: 'Carlsbad structure with half-open c-file for White and half-open e-file for Black.',
    whitePlans: ['Minority attack b2-b4-b5xc6', 'Central break e3-e4 with pieces', 'Kingside Qc2/Bd3/O-O-O + g4'],
    blackPlans: ['...c5 neutralising minority', '...f7-f5 kingside expansion', 'Defend c6 with ...Nb6 or ...a6'],
    pitfalls: ['Allowing b5xc6 without counter', 'Attacking kingside before queenside ready'],
    motifs: ['Minority attack b4-b5', 'Central lever e3-e4'] },
  { name: 'Cambridge Springs Defence', eco: 'D52', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Nbd7','e3','c6','Nf3','Qa5'],
    structure: 'Semi-closed centre; Black queen creates threats on c3 and g5.',
    whitePlans: ['Break the pin with Nd2 or Bxf6', 'cxd5 exd5 entering favourable Exchange', 'Bd3/O-O + minority attack'],
    blackPlans: ['...Bb4 adding to pin', '...dxc4 + ...Ne4 double attack', '...dxc4 + ...c5 endgame'],
    pitfalls: ['White walking into ...dxc4/...Ne4 double attack', '...Qxa2 trapped after b3'],
    motifs: ['Double attack ...Bb4 + ...Ne4', 'Trap ...Qxa2 Nb5'] },
  { name: 'Semi-Slav Meran', eco: 'D47', parent: 'semi-slav',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','Nf3','c6','e3','Nbd7','Bd3','dxc4','Bxc4','b5'],
    structure: 'Semi-open centre with Black grabbing queenside space.',
    whitePlans: ['Aggressive e3-e4-e5 pushing', 'a4 undermining queenside', 'Sac on b5 or e6 in tactical lines'],
    blackPlans: ['...Bb7/...a6 supporting queenside', '...c5 freeing break', '...O-O + target d4'],
    pitfalls: ['...c5 without piece coordination'],
    motifs: ['...b5-a6-b4 expansion', 'Central lever e4-e5'] },
  { name: 'Slav Main Line', eco: 'D15', parent: 'slav',
    moves: ['d4','d5','c4','c6','Nf3','Nf6','Nc3','dxc4','a4','Bf5'],
    structure: 'Open Slav; Black light-squared bishop outside the chain.',
    whitePlans: ['e3/Bxc4/O-O + e4 break', 'Ne5 targeting active bishop and c6', 'a4-a5 restricting ...b5'],
    blackPlans: ['...e6/...Bb4/...Nbd7 solid setup', '...c5 freeing break', 'Prevent e4 with ...Ne4 or ...Bg6'],
    pitfalls: ['Allowing Nh4 trading active bishop'],
    motifs: ['Active bishop ...Bf5', 'Central lever e3-e4'] },
  { name: 'Open Catalan', eco: 'E04', parent: 'catalan',
    moves: ['d4','Nf6','c4','e6','g3','d5','Bg2','dxc4'],
    structure: 'Fianchettoed bishop on g2 exerts long-term queenside pressure.',
    whitePlans: ['Win back c4 with Qa4+ or Qc2', 'Long-diagonal pressure', 'Advance d4-d5'],
    blackPlans: ['Hold pawn with ...a6 + ...b5', 'Return with ...Bb4+', 'Trade g2-bishop via ...Bd7-b5'],
    pitfalls: ['Too greedy with c4 pawn'],
    motifs: ['Long diagonal Bg2', 'Qa4+ pawn recovery'] },
  { name: 'QGD Lasker Defence', eco: 'D56', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O','Nf3','h6','Bh4','Ne4'],
    structure: 'Black simplifies by trading minor pieces to relieve the cramp of the Orthodox QGD, heading for a solid, piece-poor middlegame.',
    whitePlans: ['Bxe7 Qxe7 followed by cxd5 and a classical middlegame edge', 'Rc1/Qc2/Bd3 maintaining the initiative with pieces on the board', 'Central e3-e4 break once pieces are traded'],
    blackPlans: ['...Nxc3 bxc3 followed by ...dxc4 and structural simplification', '...Nxc3 bxc3 c5 central counter-break', '...Nd7/...c6 solid setup after the trades'],
    pitfalls: ['Allowing Nxd5 tactics before ...Nxc3 is safely played', 'Drifting into a symmetrical endgame without any activity'],
    motifs: ['Piece trades relieving cramp', '...Nxc3 structural exchange', 'Central e3-e4 lever'] },
  { name: 'QGD Tartakower Defence', eco: 'D58', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O','Nf3','h6','Bh4','b6'],
    structure: 'Black fianchettoes the problem light-squared bishop, giving up the Orthodox bad-bishop problem at the cost of some kingside dark-square softness.',
    whitePlans: ['cxd5 Nxd5 Bxe7 Qxe7 followed by Rc1/Qb3 classical pressure', 'Bxf6 Bxf6 followed by cxd5 and central control', 'Rapid development with Rc1/Qc2/Bd3 keeping tension'],
    blackPlans: ['...Bb7/...c5/...Nbd7 completing a solid flexible setup', '...dxc4 followed by ...c5 heading for hanging pawns', 'Trade minor pieces then play ...c5 for central breaks'],
    pitfalls: ['Allowing cxd5 Nxd5 Bxe7 Nxe7 with a slightly cramped endgame', 'Failing to contest the c-file when hanging pawns arrive'],
    motifs: ['Problem-bishop trade via ...b6/...Bb7', 'Hanging pawns c5/d5', 'Bishop-pair squeeze'] },
  { name: 'Semi-Tarrasch Defence', eco: 'D40', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','Nf3','c5'],
    structure: 'Black challenges the centre immediately, heading for an IQP for Black or a symmetrical structure depending on which side accepts the isolated pawn.',
    whitePlans: ['cxd5 Nxd5 followed by e4 and IQP play against Black', 'cxd5 exd5 and a minority attack in the reversed Carlsbad', 'Keep tension with Bd3/O-O and punish central concessions'],
    blackPlans: ['...Nxd5/...Nc6/...cxd4 active piece-play treatment', '...exd5 accepting the IQP with active piece setup', 'Quick development and early trade of pieces'],
    pitfalls: ['Mishandling the isolated pawn and allowing blockade', 'Trading on d4 prematurely and leaving d5 weak'],
    motifs: ['Isolated queen pawn', 'Central piece play', 'Minority attack'] },
  { name: 'Ragozin Defence', eco: 'D38', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','Nf3','Bb4'],
    structure: 'Black combines the Nimzo-style Bb4 pin with a QGD pawn structure, aiming for concrete piece play rather than the usual slow QGD middlegame.',
    whitePlans: ['Bg5/Qa4+ combined with cxd5 exchanges to fix structure', 'a3/Bxc3+ bxc3 reaching a QGD Exchange with doubled c-pawns', 'Qc2/cxd5 keeping the tension and developing with pieces'],
    blackPlans: ['...O-O/...dxc4 combined with ...c5/...b6 queenside development', '...Bxc3+ bxc3 followed by ...c5/...Nc6 pressure on the weakened queenside', '...dxc4/...c5 central break with active piece play'],
    pitfalls: ['Allowing Bg5 combined with Qa4+ pinning ideas', 'Trading on c3 without securing central play'],
    motifs: ['...Bxc3 doubled-pawn plan', 'Central ...c5 break', 'Queen-sortie Qa4+'] },
  { name: 'Vienna Variation', eco: 'D39', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','Nf3','Bb4','Bg5','dxc4'],
    structure: 'Black grabs the c-pawn and accepts a sharp open game in which White has a strong centre but must prove compensation for the missing pawn.',
    whitePlans: ['e4 central push combined with rapid development and attack on f6', 'Bxc4/O-O development attempting to recover the pawn or keep initiative', 'Bxf6 gxf6 followed by e4 with a direct attacking setup'],
    blackPlans: ['...c5/...Qa5 active play using the extra pawn as a shield', '...b5 holding the pawn combined with rapid queenside development', '...Bxc3+/...Nbd7 solid defence aiming to consolidate material'],
    pitfalls: ['Allowing e4-e5 to win back material with interest', 'Failing to develop pieces while holding the pawn'],
    motifs: ['Central e4 break', 'Gambit-style compensation', '...Bxc3+ trade'] },
  { name: 'Tarrasch Defence', eco: 'D32', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','c5'],
    structure: 'Black challenges immediately in the centre, typically accepting an isolated d-pawn in exchange for very active piece play and open lines.',
    whitePlans: ['cxd5 exd5 followed by g3/Bg2/O-O blockade of the IQP', 'e3/Nf3/Bd3/O-O classical development against the weak pawn', 'Exchange on c5 reaching a symmetric structure and playing for a small edge'],
    blackPlans: ['...Nc6/...Nf6/...Be7/...O-O classical active development around the IQP', '...Bg4/...Bf5 activating the light bishop actively', '...d4 advance breaking the blockade at the right moment'],
    pitfalls: ['Letting the blockade become permanent without counter-chances', 'Advancing ...d4 prematurely and losing the pawn outright'],
    motifs: ['Isolated queen pawn', 'Active piece play', '...d4 advance break'] },
  { name: 'QGA Central (3.e4)', eco: 'D20', parent: 'qga',
    moves: ['d4','d5','c4','dxc4','e4'],
    structure: 'White grabs a huge central pawn duo and plays to exploit it with rapid development, accepting that the c4-pawn may be lost in return.',
    whitePlans: ['Bxc4/Nf3/Nc3/O-O natural development exploiting the centre', 'e4-e5 push restricting Black\'s kingside development', 'Nf3/Bxc4/Be3 aiming for a kingside attack'],
    blackPlans: ['...e5 challenging the centre immediately', '...Nf6/...e6/...c5 classical setup targeting d4', '...b5/...Bb7 queenside development holding the pawn briefly'],
    pitfalls: ['Trying to hold the c4-pawn while falling behind in development', 'Allowing e4-e5 to clamp without counter-break'],
    motifs: ['Central pawn duo e4/d4', '...e5 counter-strike', 'c-file pressure after recapture'] },
  { name: 'QGA Classical (Furman)', eco: 'D27', parent: 'qga',
    moves: ['d4','d5','c4','dxc4','Nf3','Nf6','e3','e6','Bxc4','c5','O-O','a6'],
    structure: 'Black aims for the isolated queen-pawn structure for White with active piece play for Black, using ...a6/...b5 for queenside expansion.',
    whitePlans: ['dxc5 trade followed by Qxd8/Rd1 endgame pressure', 'Qe2/Rd1/a4 clamping the queenside expansion', 'e4 central push when the position allows it'],
    blackPlans: ['...b5/...Bb7/...Nc6 active piece play with queenside space', '...cxd4 exchange followed by ...Nc6/...Be7/...O-O', '...Nbd7/...b6/...Bb7 solid development'],
    pitfalls: ['Playing ...b5 too early and losing the pawn to a4 or axb5', 'Exchange on d4 at the wrong moment leaving the bishop exposed'],
    motifs: ['Queenside expansion ...b5', 'Isolated queen pawn for White', 'Long-diagonal pressure on the a8-h1 line'] },
  { name: 'QGA Janowski (3...a6)', eco: 'D25', parent: 'qga',
    moves: ['d4','d5','c4','dxc4','Nf3','a6'],
    structure: 'Black prepares ...b5 immediately to protect the c4-pawn and grab queenside space, accepting slow development in exchange for structural gains.',
    whitePlans: ['e3/Bxc4/O-O simple recapture and classical development', 'e4 central break combined with rapid development', 'a4 probing the queenside before Black consolidates'],
    blackPlans: ['...b5/...Bb7 classical queenside expansion', '...Nf6/...e6/...Be7 solid development after holding the pawn briefly', '...Bg4/...e6/...Nbd7 setup challenging White\'s centre'],
    pitfalls: ['Holding the pawn too long and falling behind in development', 'Playing ...b5 without adequate piece support'],
    motifs: ['Queenside pawn expansion', 'Long-diagonal fianchetto', 'Central e4 lever'] },
  { name: 'Albin Counter-Gambit', eco: 'D08', parent: 'qgd',
    moves: ['d4','d5','c4','e5'],
    structure: 'Black immediately counter-gambits the e-pawn, aiming for concrete tactical chances built around the advanced d4-pawn after ...d4.',
    whitePlans: ['dxe5 d4 Nf3 Nc6 g3 Bg4 Bg2 setup neutralising the gambit', 'e3 immediately trying to break the d4-pawn', 'Bf4/Nbd2/a3 quiet setup returning material for development'],
    blackPlans: ['...d4/...Nc6/...Bg4/...Nge7 active piece play around the d-pawn', '...Bb4+/...Qe7 targeting tactical chances', '...Nge7-g6 redeployment supporting the d-pawn'],
    pitfalls: ['White playing Nc3 or b4 too early and getting hit by tactics', 'Black letting the d-pawn fall without generating compensation'],
    motifs: ['Advanced d-pawn wedge', 'Lasker trap', 'Long-diagonal counter-play'] },
  { name: 'Marshall Defence', eco: 'D06', parent: 'qgd',
    moves: ['d4','d5','c4','Nf6'],
    structure: 'Black develops a piece rather than committing to a pawn structure, accepting an early trade that simplifies the position.',
    whitePlans: ['cxd5 Nxd5 followed by e4 tempo-gaining central development', 'Nc3 immediately challenging the centre and preparing cxd5', 'Nf3/Bg5 simple development heading for a standard QGD structure'],
    blackPlans: ['...Nxd5 with tempo-loss but active piece placement', '...e6 transposing to main QGD or Semi-Tarrasch', '...c6 Slav transposition avoiding complications'],
    pitfalls: ['Allowing e4 with tempo on the d5-knight', 'Accepting weak central development without compensation'],
    motifs: ['Early piece development', 'Central e4 tempo', 'Transposition gateway'] },
  { name: 'Chigorin Defence', eco: 'D07', parent: 'qgd',
    moves: ['d4','d5','c4','Nc6'],
    structure: 'Black develops a knight to c6 blocking the c-pawn, aiming for an unorthodox piece-play game based on activity rather than classical pawn structure.',
    whitePlans: ['cxd5 Qxd5 Nf3 followed by classical development with tempo gains', 'Nc3/Nf3 solid development and punishing structural concessions', 'cxd5 Qxd5 e3/Nc3 reaching a favourable middlegame'],
    blackPlans: ['...Bg4 pin combined with ...e6/...Bb4 active development', '...e5 central counter-break with piece support', '...Nf6/...Bg4/...e6 classical piece-play setup'],
    pitfalls: ['Falling behind in development while holding unusual positions', 'Allowing c-file pressure without piece compensation'],
    motifs: ['Piece activity over structure', 'Bg4 pin leverage', '...e5 central break'] },
  { name: 'Baltic Defence', eco: 'D06', parent: 'qgd',
    moves: ['d4','d5','c4','Bf5'],
    structure: 'Black develops the light-squared bishop outside the pawn chain immediately, avoiding the classic QGD bad-bishop problem at the cost of some flexibility.',
    whitePlans: ['Qb3 hitting both b7 and d5 combined with Nc3/Nf3', 'cxd5 trade followed by Nc3/Qb3 piece pressure', 'Nf3/Nc3/e3 classical development with a slight edge'],
    blackPlans: ['...e6/...Nf6/...c6 consolidation after the bishop development', '...Nc6/...e6/...Bb4 active piece play', '...dxc4/...e6/...Nf6 heading for a QGA-style structure'],
    pitfalls: ['Allowing Qb3 to win material on b7 or d5', 'Committing the bishop too early and letting it become a target'],
    motifs: ['Early light-bishop development', 'Qb3 double attack', 'Central ...dxc4 trade'] },
  { name: 'Chebanenko Slav', eco: 'D15', parent: 'slav',
    moves: ['d4','d5','c4','c6','Nf3','Nf6','Nc3','a6'],
    structure: 'Black plays a useful waiting move with ...a6, keeping maximum flexibility and reserving the option of ...b5 expansion or quiet development.',
    whitePlans: ['c5 queenside clamp followed by b4-b5 pawn storm', 'Bf4/e3/Qc2/O-O-O aggressive setup with opposite castling', 'Bg5/e3/Bd3 classical development with slow play'],
    blackPlans: ['...b5/...Bb7/...e6 queenside expansion with the long diagonal', '...Bg4/...e6/...Nbd7 flexible piece-play setup', '...dxc4 followed by ...b5 Meran-style treatment'],
    pitfalls: ['Playing ...b5 without adequate support and losing material', 'Allowing c5 clamp without counter-play'],
    motifs: ['Queenside ...b5 expansion', 'Long-diagonal Bb7 pressure', 'Flexible waiting setup'] },
  { name: 'Exchange Slav', eco: 'D10', parent: 'slav',
    moves: ['d4','d5','c4','c6','cxd5','cxd5'],
    structure: 'A symmetrical pawn structure with open c-file; the game often revolves around minor-piece activity and small structural nuances.',
    whitePlans: ['Nc3/Nf3/Bf4/e3 classical development claiming the c-file', 'Ne5 outpost combined with f4 support and kingside play', 'Qb3 queen sortie targeting b7 and creating asymmetry'],
    blackPlans: ['...Nc6/...Nf6/...Bf5 mirror development contesting the c-file', '...e6/...Nf6/...Bd6 solid setup aiming for a quick draw', '...a6/...Nc6/...Bf5 fighting for the c-file'],
    pitfalls: ['Allowing Qb3 to land with tempo on b7', 'Missing the c-file and losing slow structural battle'],
    motifs: ['c-file battery', 'Ne5 outpost', 'Symmetrical endgame pressure'] },
  { name: 'Schlechter Slav', eco: 'D94', parent: 'slav',
    moves: ['d4','d5','c4','c6','Nf3','Nf6','Nc3','g6'],
    structure: 'Black combines the Slav pawn structure with a Grünfeld-style fianchetto, aiming to pressure the d4-pawn from the long diagonal without entering sharp Grünfeld theory.',
    whitePlans: ['e3/Bd3/O-O solid classical development with a small edge', 'Bf4 combined with Qb3 pressure on the queenside', 'cxd5 cxd5 reaching a Carlsbad-like structure'],
    blackPlans: ['...Bg7/...O-O/...Bg4 classical fianchetto development', '...dxc4 combined with ...b5 queenside expansion', '...Bf5 light-bishop activation with solid structure'],
    pitfalls: ['Missing the right moment for ...dxc4 and staying passively placed', 'Letting c5 clamp arrive without a counter-break'],
    motifs: ['Long-diagonal pressure on d4', '...dxc4 followed by ...b5', 'Queenside counter-play'] },
  { name: 'Winawer Counter-Gambit (Slav)', eco: 'D10', parent: 'slav',
    moves: ['d4','d5','c4','c6','Nc3','e5'],
    structure: 'Black strikes back immediately in the centre with a pawn sacrifice, aiming for rapid development and central activity against a cramped White position.',
    whitePlans: ['dxe5/cxd5 simplification followed by consolidation', 'e3/Bf4/Nf3 quiet refutation developing naturally', 'cxd5 trade followed by Nf3/Be2 piece-pressure play'],
    blackPlans: ['...d4/...Nf6/...Bc5 active piece play with central initiative', '...Bb4 pin combined with rapid development', '...Nf6/...Bb4 pressure on the kingside'],
    pitfalls: ['Over-extending without adequate piece support', 'Allowing White to consolidate with extra material'],
    motifs: ['Central ...e5/...d4 wedge', 'Gambit-style rapid development', 'Pin ...Bb4'] },
  { name: 'Anti-Meran (Qc2)', eco: 'D45', parent: 'semi-slav',
    moves: ['d4','d5','c4','c6','Nc3','Nf6','Nf3','e6','e3','Nbd7','Qc2'],
    structure: 'White avoids the main-line Meran by holding back Bd3 and preparing e3-e4 with queen support, reaching a flexible and less-theoretical middlegame.',
    whitePlans: ['Bd3/O-O/b3/Bb2 classical development followed by e3-e4', 'e3-e4 central push combined with tactics on the e-file', 'b3/Bb2/Rd1 slow positional squeeze'],
    blackPlans: ['...Bd6/...O-O/...e5 central counter-break', '...dxc4 combined with ...b5/...Bb7 classical Meran-style setup', '...Be7/...O-O/...b6/...Bb7 quieter fianchetto plan'],
    pitfalls: ['Allowing e3-e4 without preparing a counter-break', 'Playing ...dxc4 too early and losing the queenside fight'],
    motifs: ['Central e3-e4 lever', '...e5 counter-break', 'Long-diagonal fianchetto'] },
  { name: 'Moscow Variation', eco: 'D43', parent: 'semi-slav',
    moves: ['d4','d5','c4','c6','Nc3','Nf6','Nf3','e6','Bg5','h6','Bh4'],
    structure: 'White maintains the pin with Bh4, keeping pressure on f6 while allowing sharp play if Black goes for the Anti-Moscow.',
    whitePlans: ['e3/Bd3/O-O classical development maintaining the pin', 'Bxf6 Bxf6 followed by e3/Bd3/O-O with bishop pair pressure', 'Qc2/Rc1 developing pieces and keeping tension'],
    blackPlans: ['...dxc4 entering the Anti-Moscow sharp lines', '...Be7/...O-O/...b6 solid classical development', '...Nbd7/...dxc4/...b5 Meran-style setup'],
    pitfalls: ['Letting the pin become an attacking tool after kingside castle', 'Allowing Bxf6 gxf6 with inadequate structural compensation'],
    motifs: ['Bh4 pin pressure', 'Bxf6 structural trade', 'Central e3-e4 lever'] },
  { name: 'Anti-Moscow Gambit', eco: 'D43', parent: 'semi-slav',
    moves: ['d4','d5','c4','c6','Nc3','Nf6','Nf3','e6','Bg5','h6','Bh4','dxc4'],
    structure: 'Black grabs the c-pawn and accepts sharp, unbalanced play with opposite attacks; White typically sacrifices further material for initiative.',
    whitePlans: ['e4 central push gaining space combined with rapid development', 'e4/Be2/O-O/Bxc4 recovering the pawn and keeping the initiative', 'Sacrificial attacks on f7 or the kingside in the sharpest lines'],
    blackPlans: ['...b5 holding the pawn combined with ...Bb7/...a6', '...g5/...Bg7 counter-attack with fianchetto setup', '...Nbd7/...Qa5/...Bb4 piece activity around the extra pawn'],
    pitfalls: ['Making a single theoretical inaccuracy in razor-sharp lines', 'Trading queens into a structurally lost endgame'],
    motifs: ['Central e4-e5 rolling pawn', 'Kingside sacrifice on f7/e6', 'Opposite-side castling race'] },
  { name: 'Botvinnik System', eco: 'D44', parent: 'semi-slav',
    moves: ['d4','d5','c4','c6','Nc3','Nf6','Nf3','e6','Bg5','dxc4','e4','b5'],
    structure: 'One of the sharpest lines in chess theory, with both sides launching simultaneous attacks based on deep calculation and concrete preparation.',
    whitePlans: ['e5 kicking the knight combined with piece sacrifices on b5 or f6', 'Bxf6 gxf6 followed by central push e5/fxe5', 'Rapid development and sacrificial attack on the Black king'],
    blackPlans: ['...h6/...g5 counter-attacking with kingside expansion', '...Nbd7/...Bb7/...Qb6 solid development holding material', '...Bb7/...Nbd7 piece activity in the centre and long diagonal'],
    pitfalls: ['Forgetting a single forcing move in a deeply analysed line', 'Trading queens without preserving adequate material'],
    motifs: ['Central e4-e5-e6 roller', 'Kingside sacrifice on f6 or b5', 'Long-diagonal piece pressure'] },
  { name: 'Shabalov-Shirov Gambit', eco: 'D45', parent: 'semi-slav',
    moves: ['d4','d5','c4','c6','Nc3','Nf6','Nf3','e6','e3','Nbd7','Qc2','Bd6','g4'],
    structure: 'White pushes the g-pawn immediately as a gambit, aiming to blow open the kingside and create tactical chances before Black completes development.',
    whitePlans: ['g5 kicking the knight combined with rapid piece development', 'Rg1/h4 direct kingside pawn storm', 'Long castle combined with further pawn advances'],
    blackPlans: ['...Nxg4 accepting the pawn and trying to consolidate', '...h6 declining and developing solidly', '...dxc4 central trade combined with ...b5 counter-play'],
    pitfalls: ['Taking the pawn and falling behind in development', 'Allowing the kingside attack to gain unstoppable momentum'],
    motifs: ['g4-g5 kingside lever', 'Sacrificial kingside attack', 'Opposite-side castling race'] },
  { name: 'Closed Catalan', eco: 'E06', parent: 'catalan',
    moves: ['d4','Nf6','c4','e6','g3','d5','Bg2','Be7','Nf3','O-O','O-O','Nbd7'],
    structure: 'Black keeps the c-pawn and enters a slow, positional middlegame with the long-diagonal bishop exerting quiet but persistent pressure.',
    whitePlans: ['Qc2/Rd1/Bf4/Nbd2 classical slow build', 'b3/Bb2/Nc3 double-fianchetto-like setup', 'Central e4 break or queenside minority attack'],
    blackPlans: ['...c6/...b6/...Bb7 solid setup pressuring the long diagonal', '...dxc4 followed by ...b5 defending material with queenside expansion', '...c5 central break at the right moment'],
    pitfalls: ['Drifting into completely passive play without any break', 'Allowing e4 to land without counter-break'],
    motifs: ['Long-diagonal pressure', 'Central e4 lever', 'Queenside minority attack'] },
  { name: 'Bogo-Indian Defence', eco: 'E11', parent: 'bogo',
    moves: ['d4','Nf6','c4','e6','Nf3','Bb4+'],
    structure: 'Black pins the queenside with a bishop check, reaching solid positions in which White must decide between blocking with Bd2, Nbd2, or Nc3.',
    whitePlans: ['Bd2 trading bishops combined with Nc3/Qc2/e3 classical setup', 'Nbd2 keeping the bishop pair combined with a3/b3 slow development', 'Nc3 reaching Nimzo-Indian transposition'],
    blackPlans: ['...Bxd2+/...O-O/...d6/...c5 solid setup after the trade', '...a5 combined with ...b6/...Bb7 long-diagonal play', '...c5/...O-O/...d5 central counter-break'],
    pitfalls: ['Trading the Bb4 without sufficient compensation', 'Allowing a3/Nxc3 doubled-pawn structure without counter-play'],
    motifs: ['Bishop check pin', '...c5 central break', 'Dark-square control after trades'] },
  { name: 'KID Mar del Plata (9.Ne1)', eco: 'E99', parent: 'kid',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5','O-O','Nc6','d5','Ne7','Ne1'],
    structure: 'The knight retreats to e1 to support the queenside push while Black prepares a full kingside pawn storm; opposite-wing races are typical.',
    whitePlans: ['Nd3/c5/b4 queenside pawn storm aimed at cracking d6', 'Nb1-d2-b3 reroute supporting the queenside break', 'f3/Be3 kingside defence slowing down Black\'s attack'],
    blackPlans: ['...f5/...f4/...g5/...Nh5 classic kingside pawn storm', '...Rf7-g7 or ...Ng6 redeployments supporting the attack', '...h5/...h4 preparing ...g3 combined with sacrificial breakthroughs'],
    pitfalls: ['Falling behind in the kingside race after a slow ...f5', 'Letting c5 arrive and cracking d6 before the kingside break'],
    motifs: ['Opposite-wing pawn race', '...g3 sacrificial breakthrough', 'Queenside c5 cracker'] },
  { name: 'KID Bayonet Attack', eco: 'E97', parent: 'kid',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5','O-O','Nc6','d5','Ne7','b4'],
    structure: 'White launches the queenside pawn storm one move faster than in the Mar del Plata, aiming to crack d6 before Black organises the kingside break.',
    whitePlans: ['c5 combined with a4-a5 cracking d6 before the kingside storm arrives', 'Ba3/c5/Rc1 rapid queenside pressure', 'Ne1/Nd3 reroute supporting c5 and restraining ...f5'],
    blackPlans: ['...Nh5/...f5/...f4 classical kingside attack setup', '...a5 restraining the b-pawn and delaying the queenside crack', '...Ng6/...Rf7-g7 redeploying for the kingside attack'],
    pitfalls: ['Allowing c5 to arrive before ...f5 is committed', 'Trading on d4 prematurely and giving White the c-file'],
    motifs: ['b4-b5-c5 cracker', 'Opposite-wing race', '...Nh5 kingside reroute'] },
  { name: 'KID Sämisch', eco: 'E80', parent: 'kid',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','f3'],
    structure: 'White builds a huge pawn centre supported by f3, preparing queenside castling and a kingside pawn storm while restricting Black\'s break ideas.',
    whitePlans: ['Be3/Qd2/O-O-O/h4-h5 queenside-castle with a kingside pawn storm', 'Nge2/Bd3/O-O classical setup with central control', 'Central d5 advance combined with piece pressure'],
    blackPlans: ['...c5 Benoni-style central counter with ...e6/...b5', '...Nc6/...a6/...Rb8/...b5 Panno-style queenside expansion', '...e5 followed by ...Nh5/...f5 kingside break'],
    pitfalls: ['Allowing the kingside pawn storm to arrive unopposed', 'Playing ...e5 without enough support and losing the pawn'],
    motifs: ['f3/h4-h5 kingside storm', 'Opposite-side castling race', 'Central d5 clamp'] },
  { name: 'KID Four Pawns Attack', eco: 'E76', parent: 'kid',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','f4'],
    structure: 'White grabs maximum central space with four pawns, betting that the centre will overwhelm Black before counter-play arrives.',
    whitePlans: ['Nf3/Be2/O-O consolidating the centre before e5 or f5', 'e5 breakthrough cracking the centre', 'f5 kingside advance combined with rapid piece development'],
    blackPlans: ['...c5 Benoni-style central break undermining d4', '...Nc6/...Bg4 piece pressure on the over-extended pawns', '...e5 central lever at the right moment'],
    pitfalls: ['Pushing pawns before completing development', 'Allowing ...c5 without adequate support'],
    motifs: ['Rolling pawn centre', 'Central ...c5 break', 'Piece-over-pawn pressure'] },
  { name: 'KID Fianchetto', eco: 'E62', parent: 'kid',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','g3'],
    structure: 'White fianchettoes the king-bishop, adopting a hypermodern approach that leads to strategic rather than purely tactical battles.',
    whitePlans: ['Bg2/Nf3/O-O/e3 classical fianchetto setup', 'd5 central advance combined with queenside play', 'Qc2/Rd1/e3 slow build aiming for a central break'],
    blackPlans: ['...d6/...O-O/...Nc6/...e5 classical Yugoslav-style setup', '...O-O/...c5/...Nc6/...d6 Benoni-like development', '...O-O/...d6/...Nbd7/...e5 simple solid development'],
    pitfalls: ['Allowing d5 clamp without prepared counter-play', 'Drifting into a passive setup with no clear break'],
    motifs: ['Long-diagonal pressure', 'Central d5 clamp', '...c5 queenside break'] },
  { name: 'KID Averbakh', eco: 'E73', parent: 'kid',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Be2','O-O','Bg5'],
    structure: 'White develops the dark-squared bishop actively to pin f6 and discourage the standard KID ...e5 break, reaching strategic middlegames.',
    whitePlans: ['Qd2/f3 combined with kingside or queenside castling plans', 'Nf3/O-O classical setup exploiting the pin', 'd5 central clamp combined with queenside expansion'],
    blackPlans: ['...h6/...c5 central break combined with piece development', '...Na6/...e5 pushing the knight to a less standard square', '...c6/...Qa5 active piece play with queenside counter-play'],
    pitfalls: ['Allowing the pin to become a real attacking tool', 'Breaking with ...e5 while the pin is still active'],
    motifs: ['Bg5 pin pressure', 'Central ...c5 break', 'Dark-square trade ideas'] },
  { name: 'KID Classical Exchange', eco: 'E92', parent: 'kid',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5','dxe5'],
    structure: 'White trades pawns in the centre immediately, aiming for a slightly better endgame with piece activity and structural edge rather than the complex middlegame of the Main Line.',
    whitePlans: ['Qxd8/Rxd8 simplification with a small edge in the endgame', 'Nd5 central outpost combined with piece pressure', 'c5/b4 queenside expansion in the middlegame'],
    blackPlans: ['...dxe5 with ...Qxd1 trade and solid endgame play', '...Nxe4 tactical shot looking for equality with activity', '...Nfd7 or ...Ng4 piece maneuvers maintaining tension'],
    pitfalls: ['Allowing an isolated or doubled pawn without activity', 'Walking into Nd5 tactics after inaccurate piece moves'],
    motifs: ['Central pawn trade', 'Nd5 outpost', 'Endgame technique'] },
  { name: 'Grünfeld Russian System', eco: 'D97', parent: 'grunfeld',
    moves: ['d4','Nf6','c4','g6','Nc3','d5','Nf3','Bg7','Qb3','dxc4','Qxc4'],
    structure: 'White recaptures on c4 with the queen, aiming to build a dominating centre while Black plans typical Grünfeld piece-pressure counter-play.',
    whitePlans: ['e4/Be2/O-O/Qb3 reaching a huge central formation', 'Rd1/Be3 supporting the centre and punishing ...c5 breaks', 'Retreat the queen to c2 or e2 after development is complete'],
    blackPlans: ['...O-O/...Bg4/...Nfd7/...Nb6 classic piece-pressure setup', '...a6/...b5 Hungarian Variation grabbing queenside space', '...Bg4/...Nc6/...e6 harassing the queen and building counter-play'],
    pitfalls: ['Leaving the queen on c4 exposed to ...Nc6/...Be6 tempo-gains', 'Allowing Black to trade into a favourable endgame'],
    motifs: ['Queen-tempo harassment', 'Central piece pressure', 'Long-diagonal Bg7 pressure'] },
  { name: 'Grünfeld Modern Exchange', eco: 'D85', parent: 'grunfeld',
    moves: ['d4','Nf6','c4','g6','Nc3','d5','cxd5','Nxd5','e4','Nxc3','bxc3','Bg7','Nf3','c5','Rb1'],
    structure: 'White places the rook on b1 before committing the bishop, preparing to support the centre while pressuring the b-file and discouraging ...Qa5.',
    whitePlans: ['Rook-lift Rb1 combined with Be2/O-O/Bg5 classical setup', 'd5 central push cracking the position open', 'h3/Bd3/O-O queenside play with pressure on c-file'],
    blackPlans: ['...O-O/...Qa5/...Nc6 classical active piece play', '...b6/...Bb7 long-diagonal development and pressure on e4', '...cxd4 exchange combined with ...Qa5/...Nc6'],
    pitfalls: ['Trading on d4 prematurely and giving up central pressure', 'Allowing d5 to land without adequate counter-break'],
    motifs: ['Rb1 queenside pressure', 'Central d5 advance', '...Qa5 pin idea'] },
  { name: 'Grünfeld Fianchetto', eco: 'D77', parent: 'grunfeld',
    moves: ['d4','Nf6','c4','g6','Nc3','d5','g3'],
    structure: 'White adopts a hypermodern fianchetto setup against the Grünfeld, reaching quiet positional middlegames in which small structural edges matter.',
    whitePlans: ['Bg2/Nf3/O-O/cxd5 neutralising the centre with fianchetto pressure', 'e3/Nf3/O-O classical slow development', 'Qb3/cxd5 combined development pressure'],
    blackPlans: ['...Bg7/...O-O/...c6/...Bf5 solid Slav-like development', '...dxc4 combined with ...Nc6/...Bg4 active piece play', '...c5/...O-O/...Nc6 central counter-break'],
    pitfalls: ['Staying passive and allowing e4-e5 to clamp', 'Trading on c4 at the wrong moment and falling behind'],
    motifs: ['Long-diagonal duel', 'Small structural edges', 'Central ...c5 break'] },
  { name: 'Grünfeld Bf4', eco: 'D83', parent: 'grunfeld',
    moves: ['d4','Nf6','c4','g6','Nc3','d5','Bf4'],
    structure: 'White develops the dark-squared bishop outside the pawn chain, supporting central plans and aiming for a safer treatment than the main-line Exchange.',
    whitePlans: ['Rc1/e3/cxd5/Bxc7 piece activity with a small structural edge', 'e3/Nf3/Be2/O-O solid classical development', 'cxd5 Nxd5 combined with Bxc7 or Ne4 pressure'],
    blackPlans: ['...Bg7/...O-O/...c5/...Nc6 classical Grünfeld counter-play', '...dxc4 combined with queenside expansion', '...Ne4/...Bf5 tactical shots targeting the bishop'],
    pitfalls: ['Leaving the bishop on f4 exposed to ...Nh5 or ...Ne4', 'Allowing ...c5 break without adequate support'],
    motifs: ['Active Bf4 development', 'Central d5 trade', 'Dark-square pressure'] },
  { name: 'Grünfeld Prins (5.Bg5)', eco: 'D80', parent: 'grunfeld',
    moves: ['d4','Nf6','c4','g6','Nc3','d5','Bg5'],
    structure: 'White develops the bishop to g5 before committing centrally, creating immediate pressure on f6 and looking to deter standard Grünfeld breaks.',
    whitePlans: ['Bxf6/exf6 cxd5 combined with e3/Nf3/Be2 slow play', 'cxd5 Nxd5 trade exploiting the pin on f6', 'e3/Nf3/Qb3 pressuring the centre and queenside'],
    blackPlans: ['...Ne4 questioning the bishop and central piece play', '...Bg7/...c5/...Nc6 classical Grünfeld counter-play', '...dxc4/...c5 combined with queenside development'],
    pitfalls: ['Leaving the bishop on g5 exposed to ...h6/...Ne4 combinations', 'Allowing ...c5 break without preparation'],
    motifs: ['Bg5 pin pressure', '...Ne4 tactical response', 'Central ...c5 break'] },
  { name: 'Hungarian Attack (Grünfeld/Sämisch)', eco: 'D70', parent: 'grunfeld',
    moves: ['d4','Nf6','c4','g6','f3'],
    structure: 'White prepares e4 with a pawn rather than a piece, aiming for the Sämisch-style treatment against both the Grünfeld and King\'s Indian.',
    whitePlans: ['e4/Nc3/Be3/Qd2 reaching a Sämisch-like attacking setup', 'Nc3/Be3/Qd2/O-O-O and a kingside pawn storm', 'Central d5 advance combined with queenside expansion'],
    blackPlans: ['...d5/...Bg7/...O-O transposing to an Anti-Grünfeld structure', '...c5 Benoni-style central break', '...d6/...Bg7/...O-O KID-style transposition'],
    pitfalls: ['Falling behind in development due to the slow f3 move', 'Allowing the kingside pawn storm to arrive unopposed'],
    motifs: ['Sämisch-style structures', 'Kingside pawn storm', 'Opposite-side castling race'] },
  { name: 'Nimzo-Indian Sämisch', eco: 'E25', parent: 'nimzo',
    moves: ['d4','Nf6','c4','e6','Nc3','Bb4','a3'],
    structure: 'White immediately asks the bishop to take on c3, accepting a doubled c-pawn in exchange for the bishop pair and a broad central pawn mass.',
    whitePlans: ['f3/e4 reaching a huge central pawn formation', 'Bd3/Ne2/O-O classical development with bishop pair', 'Central e4-e5 push combined with kingside attack'],
    blackPlans: ['...c5/...Nc6/...d6 Hübner-style setup blockading the centre', '...O-O/...d6/...Ne8-c7 blockading and piece regrouping', '...b6/...Ba6 light-bishop trade attacking c4'],
    pitfalls: ['Allowing the central pawn mass to roll unchecked', 'Trading pieces without reducing the bishop pair advantage'],
    motifs: ['Doubled c-pawn trade-off', 'Central pawn roller', '...Ba6 light-bishop attack'] },
  { name: 'Nimzo-Indian Leningrad', eco: 'E30', parent: 'nimzo',
    moves: ['d4','Nf6','c4','e6','Nc3','Bb4','Bg5'],
    structure: 'White develops the dark-squared bishop aggressively to maintain tension and avoid the doubled c-pawn structure.',
    whitePlans: ['f3/e4 central push combined with kingside expansion', 'e3/Nf3/Bd3 classical development keeping the pin', 'Bxf6 Bxc3+/bxc3 gxf6 structural damage trade'],
    blackPlans: ['...h6/...Bxc3+/bxc3/...d6 Sämisch-style treatment', '...c5/...O-O/...d6/...Qa5 active piece counter-play', '...d5/...O-O/...Nbd7 classical solid setup'],
    pitfalls: ['Allowing Bxf6 combined with central push', 'Failing to contest the e4/f3 pawn break'],
    motifs: ['Bg5 pin pressure', 'Central f3/e4 push', '...c5 central break'] },
  { name: 'Nimzo-Indian Kasparov Variation', eco: 'E20', parent: 'nimzo',
    moves: ['d4','Nf6','c4','e6','Nc3','Bb4','Nf3'],
    structure: 'White develops a piece rather than committing to an immediate structural choice, keeping multiple setups available depending on Black\'s response.',
    whitePlans: ['g3/Bg2/O-O Fianchetto setup pressuring the long diagonal', 'Qb3/a3/Bxc3+ reaching the Sämisch structure with a piece already out', 'e3/Bd3/O-O classical Rubinstein transposition'],
    blackPlans: ['...O-O/...d5 classical active development', '...c5/...O-O/...b6/...Bb7 hedgehog-like setup', '...b6/...Bb7/...d5 queenside fianchetto'],
    pitfalls: ['Committing too slowly and letting White choose the ideal structure', 'Allowing g3 setup without long-diagonal counter-play'],
    motifs: ['Flexible move-order', 'Long-diagonal fianchetto duel', 'Central ...d5/...c5 break'] },
  { name: 'Nimzo-Indian Hübner', eco: 'E42', parent: 'nimzo',
    moves: ['d4','Nf6','c4','e6','Nc3','Bb4','e3','c5','Nge2','Nc6','a3','Bxc3+','Nxc3','d6'],
    structure: 'Black voluntarily trades on c3 to establish a blockade with pawns on c5/d6/e5 and piece control over the dark squares, typical of the Hübner system.',
    whitePlans: ['Nge2/b3/Bb2/Bd3 slow development claiming the bishop pair edge', 'f3/e4 central push breaking the blockade', 'a3/b4 queenside expansion attacking the c5-pawn'],
    blackPlans: ['...e5 blockading setup combined with ...O-O/...b6 development', '...O-O/...Qc7/...Rfd8 piece play around the blockade', '...b6/...Ba6 light-bishop trade targeting c4'],
    pitfalls: ['Letting the blockade collapse to a well-timed e4 push', 'Trading pieces when the bishop pair is still an issue'],
    motifs: ['c5/d6/e5 blockade', 'Dark-square control', 'Central f3/e4 break'] },
  { name: 'Nimzo-Indian Noa Variation', eco: 'E36', parent: 'nimzo',
    moves: ['d4','Nf6','c4','e6','Nc3','Bb4','Qc2','d5'],
    structure: 'Black responds to the Classical 4.Qc2 with an immediate central challenge, heading for positions with open lines and piece play rather than the quieter main lines.',
    whitePlans: ['cxd5 exd5 combined with Bg5/Nf3 classical pressure', 'a3/Bxc3+ followed by queenside expansion', 'e3/Nf3/Bd3 classical development with central tension'],
    blackPlans: ['...O-O/...c5/...Nc6 classical active piece play', '...dxc4/...c5 central trade combined with active development', '...Bxc3+/...Nc6/...b6 solid structural treatment'],
    pitfalls: ['Allowing Bg5 pin without a concrete counter', 'Trading on c3 without central compensation'],
    motifs: ['Central ...d5 challenge', 'Bg5 pin pressure', '...c5 central break'] },
  { name: 'Nimzo-Indian Keres (4.Nge2)', eco: 'E45', parent: 'nimzo',
    moves: ['d4','Nf6','c4','e6','Nc3','Bb4','e3','b6','Nge2'],
    structure: 'White develops the kingside knight to e2 rather than f3, preserving the option of f3/e4 central roll and avoiding blockades on c5/d4.',
    whitePlans: ['a3/Nxc3 followed by Ng3 and central e4 push', 'f3/e4 central pawn mass supported by the knight on e2', 'Ng3/Bd3/O-O classical development'],
    blackPlans: ['...Ba6 light-bishop trade attacking c4', '...Bb7/...O-O/...d5 classical development', '...Bb7/...O-O/...c5 hedgehog-style setup'],
    pitfalls: ['Allowing the central roller e3-e4-e5 to work unchecked', 'Trading the queenside bishop without breaking the pawn chain'],
    motifs: ['...Ba6 light-bishop pressure', 'Central e3-e4 push', 'Knight tour Nge2-g3-f5'] },
  { name: 'QID Petrosian Variation', eco: 'E12', parent: 'qid',
    moves: ['d4','Nf6','c4','e6','Nf3','b6','a3'],
    structure: 'White prevents the ...Bb4+ and ...Bb4 pin ideas in advance, keeping bishop-pair ambitions and preparing a flexible central build.',
    whitePlans: ['Nc3/e4 or d5 central push combined with piece pressure', 'b3/Bb2 double-fianchetto setup supporting c4', 'Qc2/e4 straight central expansion'],
    blackPlans: ['...Bb7/...d5/...Be7 classical solid development', '...Bb7/...c5/...Be7 flexible setup with central pressure', '...Ba6 combined with ...c5 attacking c4 directly'],
    pitfalls: ['Allowing e4 to land without adequate counter-break', 'Trading pieces without dissolving the central advantage'],
    motifs: ['Prophylactic a3', 'Central e4/d5 push', '...Ba6 light-bishop pressure'] },
  { name: 'Kasparov-Petrosian QID', eco: 'E12', parent: 'qid',
    moves: ['d4','Nf6','c4','e6','Nf3','b6','a3','Bb7','Nc3','d5'],
    structure: 'Black challenges the centre immediately, reaching structures reminiscent of the QGD with the bishop on b7 rather than c8.',
    whitePlans: ['cxd5 exd5 combined with Bg5/e3/Bd3 classical pressure', 'Bg5/Qb3 pressuring d5 and the queenside', 'b4/Bb2 queenside expansion combined with central play'],
    blackPlans: ['...Be7/...O-O/...c5 active development around the centre', '...Bd6/...O-O/...Nbd7 solid classical setup', '...dxc4 trade combined with ...c5 central break'],
    pitfalls: ['Trading on c4 at the wrong moment and losing structural edge', 'Allowing Bg5 pin to become an attacking tool'],
    motifs: ['Central ...d5 challenge', 'Long-diagonal Bb7 pressure', 'Bg5 pin'] },
  { name: 'Benoni Taimanov', eco: 'A67', parent: 'benoni',
    moves: ['d4','Nf6','c4','c5','d5','e6','Nc3','exd5','cxd5','d6','e4','g6','f4','Bg7','Bb5+'],
    structure: 'White checks immediately before castling, aiming for a direct attack against the uncastled king and restricting Black\'s standard Benoni development.',
    whitePlans: ['Bd3/Nf3/O-O after disrupting Black development', 'e5 central break combined with sacrificial attacks', 'a4/Rb1 restraining ...b5 and preparing kingside push'],
    blackPlans: ['...Nbd7 blocking the check with development', '...Bd7 trading pieces at the right moment', '...O-O/...Re8/...Na6 piece-play counter'],
    pitfalls: ['Allowing e5 to crack the position open prematurely', 'Trading the dark-squared bishop without compensation'],
    motifs: ['Bb5+ disruption', 'Central e4-e5 break', 'Kingside attack on the uncastled king'] },
  { name: 'Benoni Four Pawns Attack', eco: 'A68', parent: 'benoni',
    moves: ['d4','Nf6','c4','c5','d5','e6','Nc3','exd5','cxd5','d6','e4','g6','f4'],
    structure: 'White throws pawns forward to crush Black in the centre, giving up structural integrity for direct central and kingside pressure.',
    whitePlans: ['Nf3/Be2/O-O consolidating the centre before e5 or f5', 'e5 central break combined with kingside attack', 'f5 kingside advance combined with piece pressure'],
    blackPlans: ['...Bg7/...O-O/...Re8/...Na6/...Nc7/...b5 active piece play', '...Bg4/...Nbd7 piece pressure on the over-extended pawns', '...a6/...Rb8/...b5 queenside expansion'],
    pitfalls: ['Pushing pawns before completing development', 'Allowing ...Re8 combined with tactical central shots'],
    motifs: ['Rolling pawn centre', 'Kingside f4-f5 lever', '...Re8 combined with central ...Nxe4 shots'] },
  { name: 'Benoni Fianchetto', eco: 'A62', parent: 'benoni',
    moves: ['d4','Nf6','c4','c5','d5','e6','Nc3','exd5','cxd5','d6','Nf3','g6','g3'],
    structure: 'White fianchettoes the king-bishop to combine central pressure with long-diagonal control, reaching a slower, more positional Benoni game.',
    whitePlans: ['Bg2/O-O/Nd2 classical fianchetto setup', 'e4/Re1/Nd2-c4 central piece pressure', 'a4/Re1/e4 queenside expansion combined with central control'],
    blackPlans: ['...Bg7/...O-O/...Re8/...a6/...Nbd7 classical setup', '...Bg7/...O-O/...b5/...Bb7 queenside expansion', '...Bg7/...O-O/...Re8/...Nbd7 piece pressure on d5'],
    pitfalls: ['Allowing e4-e5 without adequate counter-break', 'Trading the queenside bishop at the wrong moment'],
    motifs: ['Long-diagonal pressure', 'Queenside ...b5 expansion', 'Piece pressure on d5'] },
  { name: 'Benoni Flick-Knife (Taimanov)', eco: 'A67', parent: 'benoni',
    moves: ['d4','Nf6','c4','c5','d5','e6','Nc3','exd5','cxd5','d6','e4','g6','f4','Bg7','Bb5+','Nfd7'],
    structure: 'Black interposes with the knight rather than the bishop, keeping the dark-squared bishop on g7 at the cost of an awkward piece placement.',
    whitePlans: ['a4/Nf3/O-O classical development punishing the cramped position', 'e5 central break combined with tactical shots', 'Bd3/Nf3/O-O solid development with central pressure'],
    blackPlans: ['...O-O/...a6/...Nb6 redeployment of the awkward knight', '...a6/...Qh4+ tactical counter-shot', '...O-O/...Re8/...Na6 piece-play counter'],
    pitfalls: ['Leaving the knight on d7 stuck for too long', 'Allowing e5 without preparing piece pressure'],
    motifs: ['Bb5+ disruption', 'Central e4-e5 break', '...Qh4+ tactical shot'] },
  { name: 'Benko Gambit Declined', eco: 'A57', parent: 'benko',
    moves: ['d4','Nf6','c4','c5','d5','b5','Nf3'],
    structure: 'White declines the pawn offer and develops a piece, reaching a slightly irregular Benoni-like structure with solid but passive placement.',
    whitePlans: ['cxb5/a4/Nc3 simple refutation grabbing the pawn later', 'e3/Nc3/Be2 classical development avoiding the gambit', 'Nbd2/e3/Bd3 flexible quiet setup'],
    blackPlans: ['...Bb7/...g6/...Bg7 classical Benko-style development', '...bxc4/...d6/...g6 trade combined with typical Benko setup', '...d6/...e6 solid development avoiding complications'],
    pitfalls: ['Taking the pawn at the wrong moment and walking into gambit compensation', 'Staying too passive and letting Black dominate queenside files'],
    motifs: ['Queenside file pressure', 'Long-diagonal fianchetto', '...a6 combined with ...bxc4 trade'] },
  { name: 'Dutch Classical', eco: 'A84', parent: 'dutch',
    moves: ['d4','f5','c4','Nf6','Nc3','e6'],
    structure: 'Black combines ...f5 with a solid development setup including ...e6 and ...Be7, aiming for a slower strategic game rather than the sharp Leningrad or Stonewall.',
    whitePlans: ['Nf3/Bg5/e3 classical development with structural pressure', 'g3/Bg2 fianchetto setup combined with central play', 'Bg5 pin combined with Qc2/O-O-O and kingside attack'],
    blackPlans: ['...Be7/...O-O/...d6/...Qe8-h5 classical setup', '...Bb4/...O-O/...d6 active development with the pin', '...b6/...Bb7/...Qe8 long-diagonal development'],
    pitfalls: ['Allowing Bg5 pin to become an attacking tool', 'Over-extending on the kingside without support'],
    motifs: ['...f5 kingside space', 'Bg5 pin pressure', 'Queen-sortie ...Qe8-h5'] },
  { name: 'Dutch Stonewall', eco: 'A90', parent: 'dutch',
    moves: ['d4','f5','g3','Nf6','Bg2','e6','Nf3','d5','c4','c6'],
    structure: 'Black sets up the Stonewall formation with pawns on c6/d5/e6/f5, creating a rigid but durable structure with long-term dark-square play.',
    whitePlans: ['Bf4/b3/Nc3/Ne5 piece pressure on the weak e5-square', 'Qc2/b3/Bb2 double-fianchetto setup', 'Central e3-e4 break combined with tactical piece play'],
    blackPlans: ['...Bd6/...O-O/...Qe7/...Nbd7 classical Stonewall setup', '...Bd6/...O-O/...b6/...Bb7 long-diagonal development', '...Ne4 central outpost combined with kingside piece attack'],
    pitfalls: ['Trading the dark-squared bishop without compensation', 'Allowing e4 central break without adequate preparation'],
    motifs: ['Ne4 central outpost', 'Dark-square weakness on e5', 'Kingside attack via ...Rf6-h6'] },
  { name: 'Staunton Gambit', eco: 'A82', parent: 'dutch',
    moves: ['d4','f5','e4'],
    structure: 'White immediately challenges the Dutch with a pawn sacrifice for rapid development and attack against the unprotected kingside.',
    whitePlans: ['Nc3/Bg5 combined with f3 central recovery', 'Rapid kingside attack with Bxf6/Qxd4-h4', 'Central piece pressure with open lines'],
    blackPlans: ['...fxe4 grabbing the pawn and trying to consolidate', '...Nf6/...e6 declining and developing solidly', '...d5 central counter-attack at the right moment'],
    pitfalls: ['Taking the pawn without preparing development', 'Allowing the kingside attack to develop unopposed'],
    motifs: ['Gambit-style rapid development', 'Kingside attack on f7/h7', 'Central pawn recovery'] },
  { name: 'Anti-Dutch (Hopton Attack)', eco: 'A80', parent: 'dutch',
    moves: ['d4','f5','Bg5'],
    structure: 'White immediately develops the dark-squared bishop aggressively to disrupt standard Dutch development and create early tactical chances.',
    whitePlans: ['Bxe7 Qxe7/Nxe7 followed by quick development', 'h4/g4 aggressive kingside pawn pushes', 'e3/Nf3/Bd3 classical development with central pressure'],
    blackPlans: ['...h6/...Nf6 solid development questioning the bishop', '...Nf6/...g6/...Bg7 fianchetto setup', '...c5/...Nc6 central counter-break'],
    pitfalls: ['Allowing h4 combined with g4 to destabilise the kingside', 'Trading the dark-squared bishop without compensation'],
    motifs: ['Early Bg5 harassment', 'Kingside pawn push h4/g4', 'Central ...c5 break'] },
  { name: 'Old Indian Defence', eco: 'A53', parent: 'old-indian',
    moves: ['d4','Nf6','c4','d6'],
    structure: 'Black sets up a modest but flexible pawn structure, delaying kingside commitments and often transposing to King\'s Indian or Philidor-like structures.',
    whitePlans: ['Nc3/e4/Be2/O-O classical centre-grab', 'Nf3/Bf4/e3 solid quiet development', 'd5 central advance combined with piece pressure'],
    blackPlans: ['...Nbd7/...e5/...Be7/...O-O classical Philidor-like setup', '...g6/...Bg7 transposing to a KID', '...c6/...e5 flexible central setup'],
    pitfalls: ['Playing too passively and letting White dominate the centre', 'Allowing d5 clamp without counter-play'],
    motifs: ['Flexible move-order', 'Central ...e5 break', 'KID transposition'] },
  { name: 'Budapest Gambit', eco: 'A52', parent: 'budapest',
    moves: ['d4','Nf6','c4','e5'],
    structure: 'Black counter-gambits the e-pawn to reach open positions with active piece play and direct threats against the White king.',
    whitePlans: ['dxe5 Ng4 Nf3 Nc6 Bf4 consolidating with a slight edge', 'dxe5 Ng4 e4 central expansion combined with defence', 'Nf3/Bg5/e3 quiet positional treatment'],
    blackPlans: ['...Ng4/...Nxe5 recapturing the pawn with active pieces', '...Bb4+/...Nc6/...Qe7 piece pressure on the centre', '...d6/...Nge7 slower development with piece activity'],
    pitfalls: ['Allowing Nxg4 tactics without support', 'Losing the e5 pawn without compensation'],
    motifs: ['Ng4 active knight', 'Piece pressure for a pawn', 'f2 tactical target'] },
  { name: 'Fajarowicz Variation', eco: 'A51', parent: 'budapest',
    moves: ['d4','Nf6','c4','e5','dxe5','Ne4'],
    structure: 'A sharper Budapest sub-line in which Black immediately places the knight on e4, accepting the loss of a pawn for direct piece activity and tactical chances.',
    whitePlans: ['Nd2/Qc2 consolidating with extra material', 'Nf3/Bf4/e3 solid development punishing the aggressive setup', 'a3/Nc3 preventing ...Bb4+ combined with development'],
    blackPlans: ['...Bb4+/...Nc6/...d6 active piece play for compensation', '...Nc6/...Qe7/...Bb4+ tactical pressure on the centre', '...d5 central counter-break at the right moment'],
    pitfalls: ['Falling behind further in development while trying to compensate', 'Allowing trades that simplify into a lost endgame'],
    motifs: ['Central Ne4 outpost', 'Gambit-style piece activity', 'Tactical shots on f2/e5'] },
  { name: 'Blumenfeld Gambit', eco: 'E10', parent: 'blumenfeld',
    moves: ['d4','Nf6','c4','e6','Nf3','c5','d5','b5'],
    structure: 'Black offers a queenside pawn for a mighty central pawn structure with pawns on c5/d5/e5 restricting White\'s pieces.',
    whitePlans: ['Bg5 pressuring f6 combined with cxb5/e3 consolidation', 'cxb5/a4/Nc3 consolidating with extra material', 'Refuse with e3/Bd3/O-O keeping solid development'],
    blackPlans: ['...a6/...bxc4/...Bb7/...d5 central piece activity', '...Bb7/...d5/...Nbd7 classical central setup', '...exd5/...d6/...Bb7 building the big central pawn mass'],
    pitfalls: ['Taking the pawn without handling ...Bb7 pressure', 'Allowing the big central pawn mass to roll'],
    motifs: ['Central c5/d5/e5 pawn mass', 'Long-diagonal Bb7 pressure', '...Qb6 queenside pressure'] },
  { name: 'English Hedgehog', eco: 'A30', parent: 'english',
    moves: ['c4','c5','Nf3','Nf6','g3','b6','Bg2','Bb7','O-O','e6','Nc3','Be7','d4','cxd4','Qxd4'],
    structure: 'Black adopts the classic Hedgehog formation with pawns on a6/b6/d6/e6, accepting a cramped but extremely flexible structure rich in break and reorganisation ideas.',
    whitePlans: ['Rd1/Be3/Rfd1 classical restraint setup targeting ...d5 and ...b5', 'b3/Bb2 double-fianchetto combined with slow pressure', 'e4/Nd2 central expansion restricting Black breaks'],
    blackPlans: ['...a6/...d6/...Nbd7/...Qc7 classical Hedgehog development', '...Rac8/...Rfd8 doubling heavy pieces before a break', '...b5 or ...d5 break at the right moment'],
    pitfalls: ['Playing the break too early without full preparation', 'Allowing White to complete the full restraint setup'],
    motifs: ['Hedgehog break ...b5 or ...d5', 'Heavy-piece reorganisation', 'Long-diagonal Bb7 pressure'] },
  { name: 'English Double Fianchetto', eco: 'A30', parent: 'english',
    moves: ['c4','Nf6','Nf3','c5','g3','b6','Bg2','Bb7','O-O','e6','Nc3','Be7','d4'],
    structure: 'Both sides fianchetto in this symmetrical setup, reaching a complex strategic battle in which small structural decisions matter enormously.',
    whitePlans: ['b3/Bb2 double-fianchetto combined with central d4', 'd4 central trade followed by Qxd4/Rd1 pressure', 'Rd1/Qd3/Rac1 heavy-piece activity on open files'],
    blackPlans: ['...O-O/...d6/...a6/...Qc7 classical Hedgehog setup', '...d5 central counter-break at the right moment', '...Nc6/...d5 active central counter-play'],
    pitfalls: ['Allowing central d4-d5 clamp without counter-break', 'Trading pieces without preserving dynamic chances'],
    motifs: ['Long-diagonal duel', 'Central ...d5 break', 'Heavy-piece activity'] },
  { name: 'Botvinnik English', eco: 'A26', parent: 'english',
    moves: ['c4','e5','Nc3','Nc6','g3','g6','Bg2','Bg7','e4'],
    structure: 'White erects the Botvinnik pawn formation with pawns on c4/d3/e4, aiming for a reversed KID-style game with an extra tempo.',
    whitePlans: ['d3/Nge2/O-O classical Botvinnik setup', 'f4 kingside pawn push combined with piece activity', 'Qd2/Be3/Rb1 queenside expansion with b4'],
    blackPlans: ['...Nge7/...d6/...O-O classical setup', '...d6/...Be6/...Qd7 piece development combined with ...f5 break', '...a6/...Rb8/...b5 queenside counter-play'],
    pitfalls: ['Allowing f4-f5 kingside push without counter-break', 'Playing ...d5 at the wrong moment and losing the pawn'],
    motifs: ['Reversed KID structure', 'f4-f5 kingside push', 'Queenside ...b5 expansion'] },
  { name: 'Anti-KID English', eco: 'A26', parent: 'english',
    moves: ['c4','Nf6','Nc3','g6','e4'],
    structure: 'White sets up a broad pawn centre against a fianchetto, reaching an aggressive King\'s Indian-like structure with the white king as the attacker.',
    whitePlans: ['d4/Nf3/Be2/O-O reaching a full classical KID structure with colours reversed', 'd3/Nge2/f4 restrained setup combined with kingside push', 'h3/g4 direct kingside attack'],
    blackPlans: ['...d6/...Bg7/...O-O classical KID-style development', '...e5/...Nc6/...d6 central counter-setup', '...c5/...Bg7 Benoni-style transposition'],
    pitfalls: ['Over-extending with central pawns before development', 'Allowing ...d5 break at an inopportune moment'],
    motifs: ['Broad pawn centre', 'Kingside pawn storm', 'Reversed KID structure'] },
  { name: 'Anti-QGD English', eco: 'A14', parent: 'english',
    moves: ['c4','Nf6','Nf3','e6','g3','d5','Bg2'],
    structure: 'White avoids main-line QGD by fianchettoing the king-bishop, reaching a Catalan-like structure with a quieter positional character.',
    whitePlans: ['O-O/b3/Bb2 classical fianchetto setup', 'd4 central commitment combined with classical development', 'Ne5/d4 central piece pressure'],
    blackPlans: ['...Be7/...O-O/...b6/...Bb7 classical solid setup', '...dxc4 trade combined with ...c5 active development', '...c5/...Nc6 central counter-play'],
    pitfalls: ['Staying too passive and letting White complete all setups', 'Allowing d4 to arrive without counter-break'],
    motifs: ['Long-diagonal Bg2 pressure', 'Central d4 lever', 'Queenside b3/Bb2 squeeze'] },
  { name: 'Anti-Slav English', eco: 'A11', parent: 'english',
    moves: ['c4','c6','Nf3'],
    structure: 'White develops flexibly against the Slav move-order, keeping options for Réti, English, or main-line transpositions depending on Black\'s setup.',
    whitePlans: ['g3/Bg2/O-O reaching Réti structures', 'd4 central commitment transposing to Slav/Semi-Slav', 'b3/Bb2 quiet double-fianchetto setup'],
    blackPlans: ['...d5/...Nf6/...Bf5 Slav-like solid development', '...Nf6/...d5/...e6 Semi-Slav transposition', '...d5/...dxc4 Reti-like central trade'],
    pitfalls: ['Committing to a pawn structure too early', 'Allowing White to choose the ideal structure'],
    motifs: ['Flexible move-order', 'Transposition gateway', 'Long-diagonal pressure'] },
  { name: 'Mikenas-Carls English', eco: 'A18', parent: 'english',
    moves: ['c4','Nf6','Nc3','e6','e4'],
    structure: 'White immediately grabs central space with a broad pawn push, aiming to prevent ...d5 and reach a dynamic middlegame.',
    whitePlans: ['e5 kicking the knight combined with rapid development', 'd4 reaching a full classical centre', 'Bd3/Nf3/O-O classical development with central pressure'],
    blackPlans: ['...d5 challenging the centre immediately', '...c5 Sicilian-style central counter', '...Bb4/...d5 pin combined with central break'],
    pitfalls: ['Allowing e5 to clamp before ...d5 break', 'Trading central pawns without piece development'],
    motifs: ['Central e4 push', '...d5 counter-strike', 'e4-e5 kicker'] },
  { name: 'Kramnik-Shirov English', eco: 'A21', parent: 'english',
    moves: ['c4','Nf6','Nc3','e6','Nf3','Bb4'],
    structure: 'Black pins the c3-knight immediately, reaching Nimzo-like structures with a quieter English flavour.',
    whitePlans: ['Qc2/a3 forcing the bishop to take on c3 combined with bishop-pair ambitions', 'g3/Bg2/O-O Fianchetto setup keeping flexible', 'e3/Bd3/O-O classical Rubinstein-like development'],
    blackPlans: ['...O-O/...d5/...c5 active central development', '...Bxc3 combined with ...d5/...Ne4 structural treatment', '...b6/...Bb7/...Bxc3+ Queen\'s Indian-like setup'],
    pitfalls: ['Trading on c3 without securing central play', 'Allowing Qc2 followed by a3 combined with bishop-pair advantage'],
    motifs: ['...Bb4 pin pressure', '...d5 central break', 'Bishop-pair trade-off'] },
  { name: 'Réti Classical', eco: 'A12', parent: 'reti',
    moves: ['Nf3','d5','c4','c6','b3'],
    structure: 'White adopts the classic Réti setup with a double-fianchetto, exerting long-term pressure on the centre from the flanks.',
    whitePlans: ['Bb2/g3/Bg2/O-O classical double-fianchetto setup', 'cxd5 cxd5 reaching a Slav-like structure with double fianchetto', 'Ne5/d3 central outpost combined with piece pressure'],
    blackPlans: ['...Bg4/...e6/...Nbd7 Slav-like solid setup', '...Nf6/...Bf5/...e6 classical solid development', '...dxc4/...b5 central trade combined with queenside expansion'],
    pitfalls: ['Staying passively placed and letting White complete all setups', 'Allowing Ne5 outpost without adequate challenge'],
    motifs: ['Double-fianchetto pressure', 'Ne5 outpost', 'Long-diagonal duel'] },
  { name: 'Réti Gambit', eco: 'A09', parent: 'reti',
    moves: ['Nf3','d5','c4','dxc4'],
    structure: 'Black accepts the c-pawn in a Réti setup, reaching a QGA-like structure with tempo concessions for White\'s slower development.',
    whitePlans: ['e3/Bxc4/Nc3 classical recovery with a small edge', 'Na3/Nxc4 recovering the pawn and developing', 'e4 central push combined with rapid development'],
    blackPlans: ['...Nf6/...e6/...c5 solid QGA-like setup', '...Nf6/...a6/...b5 holding the pawn combined with queenside expansion', '...c5/...Nc6 central counter-break'],
    pitfalls: ['Holding the pawn too long and falling behind in development', 'Allowing e4 central push without counter-break'],
    motifs: ['Pawn-grabbing vs development', 'Queenside ...b5 expansion', 'Central e4 lever'] },
  { name: 'Zukertort Opening', eco: 'A04', parent: 'reti',
    moves: ['Nf3'],
    structure: 'White\'s most flexible opening move, keeping all central options open and transposing to a wide range of setups depending on Black\'s response.',
    whitePlans: ['c4 transposing to English or Réti systems', 'd4 transposing to main-line Queen\'s Pawn games', 'g3/Bg2 King\'s Indian Attack setup'],
    blackPlans: ['...d5 classical central commitment', '...Nf6/...g6/...d6 flexible King\'s Indian-like setup', '...c5/...Nc6 Sicilian-flavoured transposition'],
    pitfalls: ['Committing to a pawn structure too early without knowing White\'s plan', 'Over-thinking the move-order and falling behind'],
    motifs: ['Flexible move-order', 'Transposition gateway', 'Long-diagonal preparation'] },
  { name: "Bird's Classical", eco: 'A02', parent: 'flank-1f4',
    moves: ['f4','d5','Nf3','Nf6','e3','g6','b3'],
    structure: 'White combines the classic Bird setup with a queenside fianchetto, reaching a reversed-Stonewall-style structure.',
    whitePlans: ['Bb2/Be2/O-O/Ne5 classical Bird setup with central outpost', 'c4/Bd3 central expansion combined with piece pressure', 'Qe1/Qh4 queen-lift kingside attack'],
    blackPlans: ['...Bg7/...O-O/...c5/...Nc6 classical Grünfeld-like setup', '...c5/...Nc6/...e6 central counter-play', '...Bg4/...Nbd7 piece pressure on the centre'],
    pitfalls: ['Allowing Ne5 outpost without challenge', 'Over-committing on the kingside before development'],
    motifs: ['Ne5 outpost', 'Kingside attack', 'Reversed Dutch structures'] },
  { name: "From's Gambit", eco: 'A02', parent: 'flank-1f4',
    moves: ['f4','e5'],
    structure: 'Black immediately counter-gambits against the Bird, aiming for concrete tactical chances against the weakened f4-pawn and exposed white king.',
    whitePlans: ['fxe5 d6 exd6 Bxd6 consolidating with extra material', 'e4 transposition to the King\'s Gambit', 'Nf3 declining and developing solidly'],
    blackPlans: ['...d6 offering pawn return for development lead', '...g5 kingside expansion combined with piece pressure', '...Nc6/...Bd6 classical development with tactical ideas'],
    pitfalls: ['Refusing to return material and falling under attack', 'Taking the pawn without understanding the follow-up'],
    motifs: ['f4-pawn weakness', 'Kingside attack with ...g5', 'Tactical shots on g3/h2'] },
  { name: 'Sokolsky Opening', eco: 'A00', parent: 'flank-1b4',
    moves: ['b4'],
    structure: 'White grabs queenside space immediately with a pawn push, aiming for the Polish-style setup with Bb2 long-diagonal pressure.',
    whitePlans: ['Bb2/Nf3/e3/a3 classical Polish setup', 'a3/b5 queenside pawn expansion', 'e3/Nf3/Be2 quieter positional treatment'],
    blackPlans: ['...e5/...Nf6/...d5 classical central setup', '...c5 attacking the b4-pawn immediately', '...Nf6/...e6/...d5 solid development'],
    pitfalls: ['Falling behind in development trying to grab queenside space', 'Allowing ...c5 combined with central push'],
    motifs: ['Long-diagonal Bb2 pressure', 'Queenside pawn advance', 'Central counter-play'] },
  { name: 'Grob Attack', eco: 'A00', parent: 'flank-1g4',
    moves: ['g4'],
    structure: 'White immediately plays a flank attack, aiming for Bg2 pressure on the long diagonal and unusual positions with a kingside pawn weakness.',
    whitePlans: ['Bg2/h3/c4 classical Grob setup with flank pressure', 'h3/Bg2 quieter treatment', 'Bg2/Nf3/d3 fianchetto combined with slow central play'],
    blackPlans: ['...d5 central commitment challenging the flank', '...e5/...d5 broad central setup', '...c5/...Nc6 Sicilian-style counter-play'],
    pitfalls: ['Leaving the kingside too weak after g4 without counter-chances', 'Allowing ...d5/...Bxg4 tactical shots'],
    motifs: ['Long-diagonal Bg2 pressure', 'Kingside weakness', '...d5 central challenge'] },
  { name: 'Anderssen Opening', eco: 'A00', parent: 'flank-1a3',
    moves: ['a3'],
    structure: 'White\'s most modest move-one commitment, usually preparing a later b4 push or a transposition to Sokolsky-like structures.',
    whitePlans: ['b4/Bb2/Nf3 transposing to Polish-style structures', 'd4/Nf3/c4 transposing to main-line d4 systems', 'e4/Nf3/d4 transposing to main-line e4 systems'],
    blackPlans: ['...e5/...Nc6 classical central setup', '...d5/...Nf6/...Bf5 solid development', '...c5/...Nc6 Sicilian-flavoured counter-play'],
    pitfalls: ['Wasting the ...a3 move without a concrete plan', 'Committing too slowly and letting Black dominate'],
    motifs: ['Preparation for b4', 'Flexible move-order', 'Transposition gateway'] },
  { name: 'Mieses Opening', eco: 'A00', parent: 'flank-1d3',
    moves: ['d3'],
    structure: 'A very quiet first move supporting e4 or preparing a King\'s Indian Attack setup, reserving central commitments for later.',
    whitePlans: ['Nf3/g3/Bg2 transposing to KIA', 'Nd2/e4/Ngf3 classical Old Indian Attack setup', 'e4/Nf3/Bd3 classical main-line transposition'],
    blackPlans: ['...d5/...Nf6/...Bf5 classical central setup', '...e5/...Nf6/...Nc6 broad central counter', '...c5/...Nc6 flexible counter-play'],
    pitfalls: ['Falling behind in development while committing slowly', 'Allowing Black to take the centre without a challenge'],
    motifs: ['Flexible move-order', 'KIA transposition', 'Quiet positional play'] },
  { name: "Van't Kruijs Opening", eco: 'A00', parent: 'flank-1e3',
    moves: ['e3'],
    structure: 'A waiting move supporting d4 or preparing a reversed French-style setup, rarely seen at high levels but occasionally used for surprise value.',
    whitePlans: ['d4/Nf3/c4 transposing to main-line d4 systems', 'b3/Bb2/Nf3 reversed-Nimzovich setup', 'f4/Nf3/Be2 reversed-Bird setup'],
    blackPlans: ['...d5/...Nf6/...Bf5 classical central setup', '...e5/...Nf6/...Nc6 broad central counter', '...c5/...Nc6 Sicilian-flavoured counter-play'],
    pitfalls: ['Wasting the ...e3 move without a concrete plan', 'Falling behind in development due to slow commitment'],
    motifs: ['Flexible move-order', 'Reversed French structures', 'Transposition gateway'] },
  { name: 'Hungarian Opening', eco: 'A00', parent: 'flank-1g3',
    moves: ['g3'],
    structure: 'White fianchettoes the king-bishop immediately, reaching reversed-KID structures with an extra tempo for flexible central commitments.',
    whitePlans: ['Bg2/Nf3/O-O classical KIA setup', 'c4/Nf3/Bg2 transposing to English-style systems', 'd4/Nf3/Bg2 classical d4 setup with fianchetto'],
    blackPlans: ['...d5/...Nf6/...Bf5 classical central setup', '...e5/...Nf6/...Nc6 broad central counter', '...g6/...Bg7 mirror fianchetto setup'],
    pitfalls: ['Committing too slowly and letting Black take the centre', 'Over-thinking the move-order and missing standard setups'],
    motifs: ['Reversed-KID structures', 'Long-diagonal pressure', 'Transposition gateway'] },
  { name: 'Colle-Zukertort System', eco: 'D05', parent: 'colle',
    moves: ['d4','d5','Nf3','Nf6','e3','e6','Bd3','c5','b3'],
    structure: 'A variation of the Colle in which White fianchettoes the queenside bishop on b2, aiming for a slower positional game with Ne5 and long-diagonal pressure.',
    whitePlans: ['Bb2/O-O/Ne5/Nbd2 classical Colle-Zukertort setup', 'Central c4 break combined with piece activity', 'Kingside attack with Qf3/Rf1 after Ne5 support'],
    blackPlans: ['...Bd6/...O-O/...Qc7/...Nbd7 classical active setup', '...cxd4 trade combined with central ...d5 pressure', '...b6/...Bb7 mirror fianchetto setup'],
    pitfalls: ['Allowing Ne5 outpost combined with kingside attack', 'Trading pieces without relieving the kingside pressure'],
    motifs: ['Ne5 outpost', 'Long-diagonal Bb2 pressure', 'Kingside Bxh7+ sacrifice'] },
  { name: 'Torre Attack', eco: 'A46', parent: 'torre',
    moves: ['d4','Nf6','Nf3','e6','Bg5'],
    structure: 'White develops the dark-squared bishop aggressively before committing to c4, avoiding main-line theory and reaching unbalanced positions.',
    whitePlans: ['Nbd2/e3/Bd3/c3 classical Torre setup', 'Bxf6 structural damage combined with central play', 'Kingside attack with Ne5/Qf3 after complete development'],
    blackPlans: ['...h6/...Be7/...O-O/...d5 classical solid development', '...c5/...Nc6/...h6 active counter-play', '...Bb4+/...c5 Queen\'s Indian-style setup'],
    pitfalls: ['Allowing Bxf6 without adequate structural compensation', 'Trading pieces when the bishop pair becomes an issue'],
    motifs: ['Bg5 pin pressure', 'Bxf6 structural trade', 'Ne5 outpost'] },
  { name: 'Pseudo-Trompowsky', eco: 'D00', parent: 'trompowsky',
    moves: ['d4','d5','Bg5'],
    structure: 'White develops the dark-squared bishop against Black\'s early ...d5, reaching structures similar to the Trompowsky but with a pawn committed to d5.',
    whitePlans: ['e3/Nf3/Nbd2/Bd3 classical Pseudo-Trompowsky development', 'Bxf6 exf6/gxf6 structural damage trade', 'Kingside castle combined with central expansion'],
    blackPlans: ['...h6/...Nf6/...e6/...Be7 solid classical development', '...Bf5/...e6/...Nbd7 piece-pressure setup', '...c5/...Nc6 active central counter-play'],
    pitfalls: ['Leaving the bishop on g5 exposed to ...h6/...Nh5', 'Allowing ...c5 central break without adequate response'],
    motifs: ['Bg5 pin pressure', 'Bxf6 structural trade', 'Central ...c5 break'] },
  { name: 'Veresov Attack', eco: 'D01', parent: 'veresov',
    moves: ['d4','d5','Nc3','Nf6','Bg5'],
    structure: 'White develops knight and bishop actively before committing the c-pawn, reaching aggressive structures reminiscent of the Richter-Rauzer with colours reversed.',
    whitePlans: ['e3/Qd2/O-O-O followed by a kingside pawn storm', 'Bxf6 gxf6 combined with central e4 break', 'Nf3/e3/Bd3 classical quieter development'],
    blackPlans: ['...Nbd7/...c6/...Qa5 solid classical development', '...Bf5/...e6 piece-pressure setup', '...h6/...Bf5 questioning the bishop before committing'],
    pitfalls: ['Allowing Bxf6 followed by e4 central expansion', 'Castling kingside without defence against the pawn storm'],
    motifs: ['Opposite-side castling race', 'Bxf6 structural trade', 'Central e4 break'] },
  { name: 'Jobava London', eco: 'A45', parent: 'london',
    moves: ['d4','Nf6','Nc3','d5','Bf4'],
    structure: 'White combines the London bishop with an immediate knight development, reaching aggressive structures with quick kingside attack potential.',
    whitePlans: ['e3/Qd2/O-O-O combined with kingside pawn storm', 'Nb5/Bxc7 tactical shots in specific lines', 'Nf3/e3/Bd3 classical slower development'],
    blackPlans: ['...c6/...a6/...Nbd7 solid classical development', '...Bf5/...e6/...Nbd7 piece-pressure setup', '...c5/...Nc6 active central counter-play'],
    pitfalls: ['Allowing Nb5 followed by Bxc7 tactical shots', 'Playing ...c5 at the wrong moment and losing structural edge'],
    motifs: ['Opposite-side castling race', 'Nb5/Bxc7 tactics', 'Kingside pawn storm'] },
  { name: 'BDG Ryder Gambit', eco: 'D00', parent: 'bdg',
    moves: ['d4','d5','e4','dxe4','Nc3','Nf6','f3','exf3','Qxf3'],
    structure: 'A sharper version of the BDG in which White recaptures with the queen to expose the black king more quickly, accepting worse development for attacking chances.',
    whitePlans: ['Bd3/Bg5/O-O-O combined with direct kingside attack', 'Nf3/Bd3/O-O-O rapid development with queen on f3', 'Tactical sacrifices on f6/h7/f7 in concrete lines'],
    blackPlans: ['...Bg4 hitting the queen immediately', '...Nc6/...e6/...Be7 solid classical development', '...c6/...Qd5 challenging the queen combined with development'],
    pitfalls: ['Accepting the gambit and falling behind in development', 'Allowing the kingside attack to arrive unopposed'],
    motifs: ['Queen on f3 aggressive placement', 'Kingside sacrifice attack', 'Open f-file pressure'] },
  { name: 'BDG Lemberger Counter-Gambit', eco: 'D00', parent: 'bdg',
    moves: ['d4','d5','e4','dxe4','Nc3','e5'],
    structure: 'Black immediately counter-gambits in the centre, refusing to hold the extra pawn and instead opening lines for rapid piece development and king safety.',
    whitePlans: ['dxe5 Qxd1+ Kxd1 simplified endgame with slight structural edge', 'Nxe4 central recapture followed by Nf3/Bd3/O-O classical development', 'Qxd5 Qxd8+ Kxd8 endgame with slight edge'],
    blackPlans: ['...Nc6/...Bf5/...Nf6 active piece development', '...exd4 trade followed by ...Nc6/...Bd6 development', '...Nc6/...Nf6/...Bc5 Two Knights-style setup'],
    pitfalls: ['Trading queens into a structurally inferior endgame', 'Allowing White to consolidate with piece activity'],
    motifs: ['Central ...e5 counter-strike', 'Endgame technique', 'Active piece development'] },
  { name: 'Stonewall Attack', eco: 'D00', parent: 'stonewall-attack',
    moves: ['d4','d5','e3','Nf6','Bd3','c5','c3','Nc6','f4'],
    structure: 'White sets up the reversed Stonewall with pawns on c3/d4/e3/f4, aiming for a slow kingside attack using the e5 outpost and pieces.',
    whitePlans: ['Nf3/Nbd2/O-O/Ne5 classical reversed Stonewall setup', 'Qf3-h3 queen-lift kingside attack', 'Kingside pawn storm with g4-g5 support'],
    blackPlans: ['...Bg4 bishop-trade setup neutralising the attack', '...e6/...Bd6/...O-O solid classical development', '...c5/...Nc6/...Qc7 active central counter-play'],
    pitfalls: ['Allowing Ne5 combined with kingside attack unopposed', 'Trading pieces when defending kingside attack'],
    motifs: ['Ne5 outpost', 'Kingside pawn storm', 'Dark-square structural weakness'] },
  { name: 'London vs KID setup', eco: 'A45', parent: 'london',
    moves: ['d4','Nf6','Bf4','g6'],
    structure: 'White plays the London against the King\'s Indian setup, reaching a strategic battle in which the f4-bishop restrains both ...e5 and kingside attack ideas.',
    whitePlans: ['e3/h3/Be2/O-O/Nbd2 classical London setup', 'Bxh2+ sacrifice when possible combined with kingside attack', 'Central c3/Nbd2/Nc4 piece maneuvering'],
    blackPlans: ['...Bg7/...d6/...O-O classical KID-style setup', '...c5/...Nc6/...Qb6 queenside counter-play', '...d5/...c5 central counter-break'],
    pitfalls: ['Allowing the London bishop to sit on f4 without challenge', 'Missing the right moment for ...c5 break'],
    motifs: ['Bf4 restraint', 'Central ...c5 break', 'Queenside ...Qb6 pressure'] },
  { name: 'Torre vs KID setup', eco: 'A48', parent: 'torre',
    moves: ['d4','Nf6','Nf3','g6','Bg5'],
    structure: 'White plays the Torre against a King\'s Indian setup, combining the pin on f6 with flexible central play.',
    whitePlans: ['Nbd2/e3/c3/Bd3/O-O classical Torre development', 'Bxf6 combined with e4 central break', 'Kingside castle combined with h4 space-gain'],
    blackPlans: ['...Bg7/...d6/...O-O classical KID-style setup', '...h6/...Bg7/...d6 questioning the bishop before committing', '...c5/...Nc6 active central counter-break'],
    pitfalls: ['Allowing Bxf6 followed by e4-e5 central expansion', 'Playing ...h6 without adequate support'],
    motifs: ['Bg5 pin pressure', 'Bxf6 structural trade', 'Central e4 break'] },
  { name: 'Englund Gambit', eco: 'A40', parent: 'englund',
    moves: ['d4','e5'],
    structure: 'Black immediately sacrifices the e-pawn on move one to reach unbalanced positions with active piece play, though theoretical evaluation favours White.',
    whitePlans: ['dxe5 Nc6 Nf3 Qe7 Qd5 combined with consolidation', 'Nf3/Bg5 solid development with extra material', 'Return the pawn when developmentally advantageous'],
    blackPlans: ['...Nc6/...Qe7 pressure on the e5-pawn', '...d6 offering pawn return for development lead', '...Nc6/...Qe7/...Nb4 tactical pressure on c2'],
    pitfalls: ['Falling behind in development after the pawn grab', 'Walking into tactical shots on c2/b2'],
    motifs: ['Queen sortie ...Qe7', 'Central ...e5 counter', 'Tactical shots on c2'] },
  { name: 'Rat Defence', eco: 'A41', parent: 'rat',
    moves: ['d4','d6'],
    structure: 'Black keeps maximum flexibility on move one, delaying central commitment and reserving options for Pirc, KID, Modern, or Old Indian transpositions.',
    whitePlans: ['e4/Nc3/Nf3/Be2 classical broad-centre setup', 'c4/Nc3/e4 reaching main-line d4 systems', 'Nf3/c4/Nc3 flexible development'],
    blackPlans: ['...Nf6/...g6/...Bg7 transposing to a Pirc or Modern', '...Nf6/...g6/...Bg7/...O-O transposing to a KID', '...Nf6/...e5 transposing to an Old Indian'],
    pitfalls: ['Over-extending the initial flexibility and falling behind', 'Committing to a pawn structure before knowing White\'s plan'],
    motifs: ['Flexible move-order', 'Transposition gateway', 'Hypermodern central treatment'] },
  { name: "Queen's Knight Defence", eco: 'A40', parent: 'queens-knight',
    moves: ['d4','Nc6'],
    structure: 'Black develops a knight immediately to c6, reaching highly unorthodox positions typically considered slightly inferior but offering surprise value.',
    whitePlans: ['d5 central push kicking the knight', 'c4/Nc3/e4 classical broad centre', 'Nf3/c4/Nc3 flexible development'],
    blackPlans: ['...e5 central counter-strike combined with piece play', '...d5/...Nf6/...Bf5 solid development', '...Nf6/...e5/...d6 transposing to an Old Indian'],
    pitfalls: ['Allowing d5 to kick the knight with tempo', 'Falling behind in development after unconventional setup'],
    motifs: ['Early knight development', 'Central ...e5 break', 'Unorthodox move-order'] },
  { name: 'English Defence', eco: 'A40', parent: 'english-defence',
    moves: ['d4','e6','c4','b6'],
    structure: 'Black develops the queen-bishop to the long diagonal and plays in a hypermodern style, often combining with ...f5 for kingside pressure.',
    whitePlans: ['e4/Nc3/Nf3/Bd3 classical broad-centre setup', 'a3/Nc3/e4 restraint combined with central expansion', 'Nf3/g3/Bg2 fianchetto setup'],
    blackPlans: ['...Bb7/...Bb4+/...Nf6/...f5 classical English Defence setup', '...Bb7/...Bb4+ pin combined with central pressure', '...Bb7/...Nf6/...Ne4 piece-pressure setup'],
    pitfalls: ['Allowing e4 to land without ...f5 break counter-play', 'Trading the queen-bishop without compensation'],
    motifs: ['Long-diagonal Bb7 pressure', '...f5 kingside break', '...Bb4 pin leverage'] },
  { name: "Owen's Defence", eco: 'B00', parent: 'owens',
    moves: ['e4','b6'],
    structure: 'Black develops the queen-bishop to the long diagonal immediately, reaching unorthodox positions without committing central pawns early.',
    whitePlans: ['d4/Nc3/Bd3 classical broad-centre setup', 'Nf3/Bc4/d3 flexible development', 'a3/d4 preparing the centre before committing pieces'],
    blackPlans: ['...Bb7/...e6/...Nf6/...d6 solid classical development', '...Bb7/...g6/...Bg7 double-fianchetto setup', '...Bb7/...e6/...c5 active central counter-play'],
    pitfalls: ['Allowing e4-e5 clamp without counter-break', 'Trading the queen-bishop without compensation'],
    motifs: ['Long-diagonal Bb7 pressure', 'Central ...c5 break', 'Unorthodox move-order'] },
  { name: 'Modern vs 1.d4', eco: 'A41', parent: 'modern',
    moves: ['d4','g6'],
    structure: 'Black fianchettoes immediately against d4, keeping options open for King\'s Indian, Modern, Benoni, or other setups.',
    whitePlans: ['c4/Nc3/e4 classical broad-centre setup', 'Nf3/c4/Nc3 flexible development', 'e4/Nc3/Be3 150 Attack-style setup'],
    blackPlans: ['...Bg7/...d6/...Nf6 transposing to a KID', '...Bg7/...c5/...d6 Benoni-style transposition', '...Bg7/...d6/...Nd7 Modern Defence setup'],
    pitfalls: ['Committing too slowly and letting White dominate the centre', 'Over-thinking the move-order and missing standard setups'],
    motifs: ['Hypermodern fianchetto', 'Transposition gateway', 'Long-diagonal pressure'] },
  { name: 'Jerome Gambit', eco: 'C50', parent: 'italian',
    moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5','Bxf7+'],
    structure: 'A spectacularly unsound gambit in which White sacrifices the light-squared bishop on f7 to drag the black king into the open, accepting a large material deficit for tactical chances.',
    whitePlans: ['Nxe5+ combined with tactical shots on the exposed king', 'Qh5+ combined with direct kingside attack', 'Return material at the right moment for a manageable endgame'],
    blackPlans: ['...Kxf7 accepting material with king in the centre', '...Ke7/...Nxe5 declining complications where possible', 'Rapid development with ...Nf6/...d6/...Bg4 for defence'],
    pitfalls: ['Playing too aggressively and losing more material', 'Missing a precise defensive move in sharp lines'],
    motifs: ['King-hunt tactics', 'Open-board piece activity', 'Gambit-style rapid development'] },
  { name: 'Halloween Gambit', eco: 'C46', parent: 'halloween',
    moves: ['e4','e5','Nf3','Nc6','Nc3','Nf6','Nxe5'],
    structure: 'White sacrifices a knight on e5 for a broad pawn centre and attacking chances, accepting a significant material deficit for long-term initiative.',
    whitePlans: ['Nxc6 dxc6 e5 central push kicking the knight with tempo', 'd4/Bd3/O-O rapid development supporting the centre', 'Kingside attack with Qf3/Bg5 when Black king is exposed'],
    blackPlans: ['...Nxe5 accepting material and trying to consolidate', '...Nxe4 central activity combined with rapid development', '...Nxe5 combined with ...d6/...Be7/...O-O solid defence'],
    pitfalls: ['Accepting material without handling the central roller', 'Trading pieces without reducing the attack'],
    motifs: ['Central pawn roller', 'Kingside attack with pieces', 'Material sacrifice for initiative'] },
  { name: 'Cochrane Gambit', eco: 'C42', parent: 'petroff',
    moves: ['e4','e5','Nf3','Nf6','Nxe5','d6','Nxf7'],
    structure: 'White sacrifices the knight on f7 to expose the black king early, heading for unbalanced positions with attacking chances rather than theoretical main lines.',
    whitePlans: ['d4/Bd3/Nc3/O-O classical development after the sacrifice', 'Kingside attack with Qf3/Bg5 combined with rapid development', 'Central d4-d5 break restricting Black piece development'],
    blackPlans: ['...Kxf7 accepting material combined with king-safety preparation', '...Nxe4 tactical counter-play in some lines', '...Be7/...Rf8/...Kg8 artificial castling completing safety'],
    pitfalls: ['Leaving the king exposed without adequate defensive setup', 'Trading pieces without consolidating material'],
    motifs: ['King-hunt tactics', 'Central pawn roller', 'Artificial castling'] },
  { name: 'Max Lange Attack', eco: 'C55', parent: 'italian',
    moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5','O-O','Nf6','d4','exd4','e5'],
    structure: 'A sharp tactical battle in which White pushes the e-pawn to attack the f6-knight, leading to deeply analysed lines with tactics and piece sacrifices.',
    whitePlans: ['Re1/Bg5 combined with direct attack on the kingside', 'Nc3/Bg5 combined with piece pressure on f7', 'Central e5/d5 combined with tactical shots'],
    blackPlans: ['...d5/...Nxe5 tactical counter-play', '...Ng4 central knight activity combined with ...d5', '...d5/...Nxe5 classical defensive setup'],
    pitfalls: ['Forgetting a precise line in this deeply analysed opening', 'Trading pieces without preserving material balance'],
    motifs: ['Central e5 push', 'f7 tactical pressure', 'Piece sacrifices'] },

  // ═════════════════════ INDIAN DEFENCES ═════════════════════
  { name: "King's Indian Classical", eco: 'E92', parent: 'kid',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5','O-O','Nc6','d5','Ne7'],
    structure: 'Locked chain c4/d5/e4 vs d6/e5; opposite-wing attacks typical.',
    whitePlans: ['Push c5 cracking d6', 'Nd2/Ne1 supporting b4/f3/a-file', 'Trade dark bishops via Be3-Bd2'],
    blackPlans: ['...f5/...f4 then ...g5-g4 kingside storm', '...Nh5/...Ng6 supporting attack', 'Lock queenside with ...a5/...c5'],
    pitfalls: ['Losing tempo on kingside lets c5 arrive first', 'Castling before Nd2/Ne1 allows ...Nh5 tempo'],
    motifs: ['Opposite-wing races', 'Knight tours around fixed chain', 'Sacrificial kingside storm'] },
  { name: 'Grünfeld Exchange', eco: 'D85', parent: 'grunfeld',
    moves: ['d4','Nf6','c4','g6','Nc3','d5','cxd5','Nxd5','e4','Nxc3','bxc3','Bg7','Nf3','c5','Be2'],
    structure: 'Big white centre c3/d4/e4 vs Black hypermodern piece pressure.',
    whitePlans: ['Short castle + Be3/Rb1 + d5 or e5 push', 'Rb1/Be3 defending d4 + kingside play', 'Centre pawn roller'],
    blackPlans: ['Pile on d4 with ...Nc6/...Bg4/...Qa5/...cxd4', 'Trade dark bishops exposing king', '...b5 after ...a6'],
    pitfalls: ['Pushing d5 prematurely frees g7-bishop', 'Trading on c3 without compensation'],
    motifs: ['Long diagonal pressure on d4', 'Central roller d4-d5/e4-e5'] },
  { name: 'Nimzo-Indian Rubinstein', eco: 'E40', parent: 'nimzo',
    moves: ['d4','Nf6','c4','e6','Nc3','Bb4','e3'],
    structure: 'Solid setup; IQP or hanging pawns depending on break.',
    whitePlans: ['IQP with Bd3/Nf3/a3/Bxc3 + bishop pair', 'f3/e4 in open positions', 'Knight to e5 with attack support'],
    blackPlans: ['Trade on c3 + fix doubled pawns', '...c5/...d5/...Nc6 Hübner-style', 'Blockade IQP with ...Nd5/...Nb6', '...Ba6 Karpov trading light bishop'],
    pitfalls: ['Trading on c3 without compensation gifts bishop pair', 'Mechanical d5 cedes pawn structure'],
    motifs: ['Doubled c-pawn structures', 'IQP attack vs blockade', '...Ba6 light-bishop trade'] },
  { name: 'Nimzo-Indian Classical', eco: 'E32', parent: 'nimzo',
    moves: ['d4','Nf6','c4','e6','Nc3','Bb4','Qc2'],
    structure: 'White avoids doubled pawns by recapturing Qxc3; slow bishop-pair positions.',
    whitePlans: ['Qxc3 keeping bishop pair', 'a3 after development', 'b3/Bb2 long diagonal'],
    blackPlans: ['...O-O/...d5/...c5 active counterplay', '...Ne4 trade offer', '...b6/...Bb7 challenging diagonal'],
    pitfalls: ['Delaying ...d5 lets White complete development', 'Queen on c2 walks into ...Ne4 or ...Nb4'],
    motifs: ['Bishop pair pressure', '...Ne4 tempo trade', '...c5 central lever'] },
  { name: "Queen's Indian Classical", eco: 'E15', parent: 'qid',
    moves: ['d4','Nf6','c4','e6','Nf3','b6','g3','Bb7'],
    structure: 'Two fianchettoed bishops fighting for long diagonal.',
    whitePlans: ['Bg2/O-O/Nc3/Qc2 + e4', 'Nc3-a4 vs ...c5/...Bb4', 'Trade light bishops'],
    blackPlans: ['...Ba6 pressuring c4', '...Be7/...O-O/...d6/...Nbd7', '...c5 or ...d5 central counter'],
    pitfalls: ['...Bb4+ into c3 without plan loses tempo', 'Pushing e4 without guarding c4'],
    motifs: ['Long-diagonal duel', '...Ba6 c4 pressure'] },
  { name: 'Modern Benoni', eco: 'A70', parent: 'benoni',
    moves: ['d4','Nf6','c4','c5','d5','e6','Nc3','exd5','cxd5','d6','e4','g6','Nf3','Bg7','Be2','O-O'],
    structure: 'Classic Benoni e4/d5 vs c5/d6/e6→e5; queenside majority for Black.',
    whitePlans: ['Nd2-c4 increasing d6 pressure', 'e5 breakthrough', 'Bf4/Bg5 blunting fianchetto'],
    blackPlans: ['...b5 via ...a6/...Rb8 opening queenside', '...Nbd7-e5 + ...Re8 pressuring centre', '...Bxc3 + ...Ne5 long-diagonal tactics'],
    pitfalls: ['...b5 without ...a6 allows Bxb5 sac', 'Forgetting e5 square ...Ne5 dominance'],
    motifs: ['Minority attack ...b5', 'e4-e5 central lever'] },
  { name: 'Benko Gambit', eco: 'A58', parent: 'benko',
    moves: ['d4','Nf6','c4','c5','d5','b5','cxb5','a6','bxa6','Bxa6'],
    structure: 'Black sacs queenside pawn for open a/b-files and long-diagonal pressure.',
    whitePlans: ['Return pawn with e4/Nf3/Nbd2/g3/Bg2 consolidation', 'Nc4 + b3 neutralising files', 'KIA-style Nf3/Be2'],
    blackPlans: ['Pile rooks on a- and b-files', '...Bg7/...O-O/...Nbd7-b6-d7-c5', 'Trade queens for endgame'],
    pitfalls: ['White rushing Bxa6 without consolidation'],
    motifs: ['Open a/b-files', 'Long diagonal Bg7'] },
  { name: 'Dutch Leningrad', eco: 'A87', parent: 'dutch',
    moves: ['d4','f5','g3','Nf6','Bg2','g6','Nf3','Bg7'],
    structure: 'KID-Dutch hybrid with ...g6 fianchetto + ...f5 kingside space.',
    whitePlans: ['c4/Nc3/d5 restricting ...e5', 'Rb1/b4 queenside expansion', 'Qb3 or Nd4 targeting e6'],
    blackPlans: ['...Nc6/...e5 break', '...Qe8-h5 or ...g5 kingside attack', '...c6/...Na6-c7 solidifying'],
    pitfalls: ['...e5 without prep losing control'],
    motifs: ['Kingside ...g5 push', '...e5 break'] },

  // ═════════════════════ ENGLISH / FLANK ═════════════════════
  { name: 'English Symmetrical', eco: 'A30', parent: 'english',
    moves: ['c4','c5','Nf3','Nf6','g3'],
    structure: 'Symmetrical pawn skeleton; both fianchetto kingside before d-pawn commits.',
    whitePlans: ['Bg2/O-O/d4 at favourable moment', 'Use c-file after d4', 'd5 outpost + Nc3 pressure'],
    blackPlans: ['Mirror development then commit first', '...d5 if White hesitates', '...Nd4 or ...a6/...Rb8/...b5'],
    pitfalls: ['Early Nxd5 trick if d5 loses defender', 'Symmetry one move too long'],
    motifs: ['Long-diagonal pressure', 'c-file battery', 'd5 outpost'] },
  { name: 'English Reversed Sicilian', eco: 'A22', parent: 'english',
    moves: ['c4','e5','Nc3','Nf6','g3','d5'],
    structure: 'Reversed Dragon with White tempo up; Black opens centre with ...d5.',
    whitePlans: ['Fianchetto + queenside pressure', 'Nf3/O-O/d3/Be3 slow-build', 'Bc1/c-file plus Ne5 outposts'],
    blackPlans: ['...Be7 or ...Bc5 + ...O-O', '...a5 queenside activation', 'Trade c8-bishop via ...Be6'],
    pitfalls: ['Treating as pure Dragon ignoring tempo'],
    motifs: ['Reversed Dragon tempo', 'b4-b5 minority attack'] },
  { name: 'Réti Opening', eco: 'A09', parent: 'reti',
    moves: ['Nf3','d5','c4'],
    structure: 'White delays d4 attacking d5 from the flank.',
    whitePlans: ['Fianchetto g3/Bg2 pressuring d5', 'cxd5 playing against d-pawn', 'b3/Bb2/Rc1 queenside expansion'],
    blackPlans: ['Defend d5 with ...c6/...e6/...Bf5', '...dxc4 + ...b5 Slav-style', 'Transpose QGD/Slav'],
    pitfalls: ['Over-extending ...d4 allowing Qb3/Nf3-e5'],
    motifs: ['Flank pressure', 'Bg2 long diagonal', 'Ne5 outpost'] },
  { name: 'London System', eco: 'D02', parent: 'london',
    moves: ['d4','d5','Bf4'],
    structure: 'Pyramid c3/d4/e3 with Bf4 outside the chain.',
    whitePlans: ['Build triangle + Qb3 hitting b7/d5', 'Nbd2-f1-g3 or Ne5', 'Rook lift via h4-h3-g3'],
    blackPlans: ['Challenge Bf4 with ...Bd6 or ...Nh5', '...c5 early questioning d4', '...a6/...b5 queenside space'],
    pitfalls: ['Mechanical h3/Bh2 loses tempo', 'Early Qb3 meets ...Nc6-a5'],
    motifs: ['Ne5 outpost + f2-f4', 'Bxh7+ sacrifice', 'Minority attack b2-b4-b5'] },
  { name: 'Colle System', eco: 'D04', parent: 'colle',
    moves: ['d4','d5','Nf3','Nf6','e3','e6','Bd3','c5','c3'],
    structure: 'Closed centre d4/e3/c3 with Bd3 aiming for e3-e4.',
    whitePlans: ['Prepare e3-e4 opening Bd3 lines', 'Kingside attack Ne5/f4/Qf3-h3', 'Greek-gift Bxh7+ Ng5+ Qh5'],
    blackPlans: ['Develop ...Bg4 or ...Bf5 before ...e6', 'Trade bishops via ...Bd6/...Qc7', '...cxd4 + ...Nc6-b4 hitting Bd3'],
    pitfalls: ['e3-e4 prematurely leaves d4 undefended'],
    motifs: ['Ne5 + f2-f4', 'Bxh7+ Greek gift'] },
  { name: 'Trompowsky Attack', eco: 'A45', parent: 'trompowsky',
    moves: ['d4','Nf6','Bg5'],
    structure: 'Early pin of Nf6 before c-pawn commits.',
    whitePlans: ['Trade on f6 doubling pawns', 'After ...Ne4, choose Bf4/Bh4/Bc1', 'Castle long + g4/h4 attack'],
    blackPlans: ['Chase bishop with ...c5 + ...Qb6', '...Ne4 questioning before developing', '...e6 + ...h6 + ...c5 French-like'],
    pitfalls: ['Bg5 undefended — ...c5/...Qa5+ annoying if drifting'],
    motifs: ['Bxf6 + e3/Qd2/O-O-O + pawn storm', '...Qb6xb2 counter-shot'] },
  { name: 'Blackmar-Diemer Gambit', eco: 'D00', parent: 'bdg',
    moves: ['d4','d5','e4','dxe4','Nc3','Nf6','f3','exf3','Nxf3'],
    structure: 'White gives pawn for development + open f-file.',
    whitePlans: ['Bg5/Qd2/O-O-O + g4-h4 storm', 'Bd3 + Ne5 Bxh7+ ideas', 'Double rooks on f-file'],
    blackPlans: ['Return pawn with ...Nxe4 or ...e3', 'Develop ...Bf5 or ...Bg4', 'Trade queens neutralising'],
    pitfalls: ['Without precise play White just down a pawn'],
    motifs: ['Bxh7+ Greek gift', 'Sacrifice on f6'] },
  { name: "King's Indian Attack", eco: 'A07', parent: 'kia',
    moves: ['Nf3','d5','g3'],
    structure: 'Reversed KID with pieces: Nf3/g3/Bg2/O-O/d3/Nbd2 and e4 push.',
    whitePlans: ['e4-e5 clamping centre', 'Nf1-h2-g4 kingside', 'h4-h5-h6 attack after Re1/Nf1'],
    blackPlans: ['...c5/...Nc6/...b5/...a5 queenside expansion', '...c4 clamp', '...f6 challenging e5'],
    pitfalls: ['Allowing h4-h5-h6 unchecked', 'Over-passive letting e5 clamp'],
    motifs: ['Opposite-wing race', 'e4-e5 clamp', 'h4-h5 lever'] },
  { name: "Bird's Opening", eco: 'A02', parent: 'flank-1f4',
    moves: ['f4'],
    structure: 'Reversed Dutch; White aims at kingside space.',
    whitePlans: ['Leningrad-style g3/Bg2/Nf3/O-O', 'Classical e3/d3/Bd3/Nf3/O-O/b3/Bb2', 'Ne5 + Qf3/Qh5'],
    blackPlans: ["From's Gambit 1...e5!?", '...d5/...Nf6/...Bg4 pin', '...g6/...Bg7 fianchetto'],
    pitfalls: ['From\'s Gambit unprepared', 'Holes on e-file from f4 overextensions'],
    motifs: ['Ne5 outpost', 'Dutch-like kingside attack'] },
  { name: 'Larsen Opening', eco: 'A01', parent: 'flank-1b3',
    moves: ['b3'],
    structure: 'Fianchetto-first; b2-bishop stares at long diagonal.',
    whitePlans: ['Bb2/e3/Nf3 pressuring e5', 'c4/d4 when appropriate', 'f4 cementing Ne5 outpost'],
    blackPlans: ['Claim centre with ...e5/...d5', '...b6/...Bb7 symmetrical', '...Nc6/...d5'],
    pitfalls: ['Centre collapse before bishop pair developed'],
    motifs: ['Bb2 vs centre', 'f4 + Ne5 attack', 'Hypermodern centre-later'] },

  // ═════════ DEEP SUB-VARIATIONS ═════════
  // Common named sub-lines within major families, ordered by how
  // often they come up at club / master level. Each sits longer
  // than the parent family entry so the SAN-prefix matcher returns
  // this specific sub-line when it applies.

  // ─── Najdorf sub-variations ───
  { name: 'Najdorf — English Attack', eco: 'B90', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Be3','e6','f3','b5','Qd2'],
    structure: 'White sets up Be3/f3/Qd2/O-O-O and races to g4-g5; Black counters with ...b5 and ...Bb7.',
    whitePlans: ['O-O-O followed by g4-g5-h4 kingside storm', 'Nb3/Bh3 redeployment combined with h-file opening', 'Nd5 central sacrifice on the right moment'],
    blackPlans: ['...b5/...Bb7/...Nbd7 solid queenside development', '...Nc5 knight maneuver hitting e4', '...Rxc3 exchange sac ripping the white queenside'],
    pitfalls: ['Letting the g-pawn storm arrive before ...b4 is safe', 'Premature ...b4 loses to Nd5 tactics'],
    motifs: ['Opposite-side castling race', 'Kingside g4-g5 storm', '...Rxc3 exchange sac'] },
  { name: 'Najdorf — Main Line 6.Be2', eco: 'B92', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Be2','e5','Nb3'],
    structure: 'White plays the quiet main line with a small positional edge; Black claims the d5-square and plays for ...Be6/...Nbd7.',
    whitePlans: ['O-O/Be3/Qd2/Rfd1 solid squeeze on d5', 'a4 probing the queenside before committing', 'Nd5 outpost after ...Be6 Bxb6'],
    blackPlans: ['...Be7/...O-O/...Nbd7/...Be6 classical development', '...b5 queenside expansion at the right moment', '...Nbd7-b6/...a5 fighting for d5'],
    pitfalls: ['Trading into a grim endgame with passive pieces', 'Losing d5 permanently to an unchallenged Nd5'],
    motifs: ['d5 outpost battle', 'Small positional squeeze', 'a4-a5 queenside probe'] },
  { name: 'Najdorf — Polugaevsky', eco: 'B96', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Bg5','e6','f4','b5'],
    structure: 'Sharp Najdorf sub-line where Black plays a speculative ...b5 pawn sacrifice against the Bg5 pin.',
    whitePlans: ['e5 central break combined with sacrificial attack', 'Bxf6 gxf6 structural damage + e5 push', 'Bxb5 axb5 Nxb5 material capture when concrete'],
    blackPlans: ['...Bb7/...dxe5 piece activity compensation', '...Nbd7/...Qb6 piece pressure on the weakened centre', '...b4 knight-kick combined with tactical shots'],
    pitfalls: ['One wrong move in this deeply analysed line loses outright', 'Trading queens loses the compensation'],
    motifs: ['Pawn sac for piece activity', 'Bxf6 gxf6 trade', 'e4-e5 central lever'] },
  { name: 'Najdorf — Adams Attack (6.h3)', eco: 'B90', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','h3'],
    structure: 'White prepares g4 without committing Be3/f3 first — a modern anti-Najdorf aimed at kingside space.',
    whitePlans: ['g4/Be3/Qf3/Nd2 combined with kingside push', 'Nf5 knight jump when Black commits ...e6', 'Be3/g4/Qd2 normal English Attack setup'],
    blackPlans: ['...e5 kicking Nd4 immediately', '...e6/...b5 classical Sicilian setup', '...Nc6 trade combined with ...Qb6'],
    pitfalls: ['Allowing g4-g5 without ...h5 check', 'Playing ...Nxe4 hacks that lose to tactical refutations'],
    motifs: ['g4-g5 kingside push', 'Nf5 knight sac', 'h3 prophylaxis'] },
  { name: 'Najdorf — 6.Bg5 Main Line', eco: 'B94', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Bg5','Nbd7'],
    structure: 'Classical Najdorf Bg5 with ...Nbd7 preparing ...h6 / ...Qc7 / ...b5.',
    whitePlans: ['Qe2/O-O-O/Nd2 combined with kingside push', 'Bxf6 gxf6 followed by f4/e5 break', 'Bc4/f3 positional setup pressuring d6'],
    blackPlans: ['...h6/...Qc7/...b5 classical queenside setup', '...e6/...Be7 solid development without ...b5', '...Nxe4 tactical shot in sharp lines'],
    pitfalls: ['Allowing Nxe6 sacrifice on f7 in some lines', 'Walking into Bxf6 + Nd5 double attacks'],
    motifs: ['Bg5 pin pressure', '...Nxe4 tactical shot', 'Opposite-side castling race'] },

  // ─── Scheveningen + Sicilian centre-pawn sub-variations ───
  { name: 'Scheveningen — Keres Attack', eco: 'B81', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','e6','g4'],
    structure: 'White lunges with g4 before castling, aiming for g5 kicking the Nf6 and opening kingside lines rapidly.',
    whitePlans: ['g5/Rg1/O-O-O opposite-castle king hunt', 'Bg2/h4 fianchetto kingside storm', 'Be3/Qd2/O-O-O classical English Attack transposition'],
    blackPlans: ['...h6 limiting g5 and creating a target', '...Nc6/...Bd7 piece pressure on the centre', '...a6/...b5 queenside counter-attack'],
    pitfalls: ['Castling kingside directly into the storm', 'Over-committing on the queenside before White\'s intent is clear'],
    motifs: ['g4-g5 kick', 'Opposite-side castling race', 'h-file attack'] },
  { name: 'Taimanov — Paulsen 6.Be3', eco: 'B48', parent: 'sicilian',
    moves: ['e4','c5','Nf3','e6','d4','cxd4','Nxd4','Nc6','Nc3','Qc7','Be3'],
    structure: 'Modern English-Attack-style treatment against the Taimanov, aimed at kingside space and opposite-side castling.',
    whitePlans: ['a3/Bd3/O-O classical setup with kingside pressure', 'f3/Qd2/O-O-O aggressive attacking setup', 'Ndb5 knight jump at the right moment'],
    blackPlans: ['...a6/...b5/...Bb7 classical queenside expansion', '...Nf6/...Bb4 classical pin development', '...Bd6/...Ne7 flexible setup'],
    pitfalls: ['Leaving the queen on c7 exposed to Nd5 ideas', 'Walking into Ndb5 when ...a6 is delayed'],
    motifs: ['Opposite-side castling race', 'Ndb5 jump', '...a6/...b5 expansion'] },

  // ─── Dragon + Accelerated Dragon sub-variations ───
  { name: 'Dragon — Yugoslav 9.Bc4', eco: 'B77', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','g6','Be3','Bg7','f3','O-O','Qd2','Nc6','Bc4'],
    structure: 'Classic Yugoslav Attack with Bc4 supporting e4 and targeting f7 — the main line of the Dragon for decades.',
    whitePlans: ['Bb3/O-O-O/h4-h5 kingside pawn storm', 'Bh6 dark-bishop trade before the storm', 'Nd5 central outpost combined with trade'],
    blackPlans: ['...Rc8/...Qa5/...a6 classical queenside attack', '...Rxc3 exchange sacrifice shattering the queenside', '...Nxd4 Bxd4 ...Be6 trade combined with queenside pressure'],
    pitfalls: ['Ignoring the h-file attack until too late', 'Castling long without ...Rxc3 prep'],
    motifs: ['h4-h5 storm combined with Bh6', '...Rxc3 exchange sacrifice', 'Opposite-side castling race'] },
  { name: 'Dragon — Chinese Variation', eco: 'B76', parent: 'sicilian',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','g6','Be3','Bg7','f3','O-O','Qd2','Nc6','O-O-O','d5'],
    structure: 'Sharp Dragon sub-line where Black hits back with ...d5 immediately after Qd2 and O-O-O.',
    whitePlans: ['exd5 Nxd5 Nxc6 bxc6 Bd4 trade combined with pressure', 'Nxc6 bxc6 Bd4 exchange simplification', 'Kb1 waiting move before committing'],
    blackPlans: ['...dxe4 followed by ...Nxd4 simplification', '...e5 central push in some lines', '...Bg7/...Re8 classical piece development'],
    pitfalls: ['Allowing Bxf6 + e5 tactical shots', 'Trading queens without securing piece activity'],
    motifs: ['...d5 central break', 'Piece trades for simplification', 'Central ...e5 break'] },
  { name: 'Accelerated Dragon — Maroczy Gurgenidze', eco: 'B36', parent: 'sicilian',
    moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','g6','c4','Nf6','Nc3','Nxd4','Qxd4','d6'],
    structure: 'Accelerated Dragon sub-line where Black trades on d4 early to play ...d6 / ...Be6 against the Maroczy.',
    whitePlans: ['Be2/O-O/Bg5 classical Maroczy setup', 'Rd1/b3/Bb2 double-fianchetto-like setup', 'Qd3/Be3/O-O-O aggressive opposite-castle'],
    blackPlans: ['...Bg7/...O-O/...Be6 classical piece placement', '...Bd7-c6 light-bishop trade idea', '...a6/...Rc8/...b5 queenside expansion'],
    pitfalls: ['Trading too many pieces into a worse endgame', 'Allowing the Nd5 outpost unchallenged'],
    motifs: ['Maroczy clamp', 'Light-bishop trade via ...Bc6', '...b5 break'] },
  { name: 'Accelerated Dragon — Classical', eco: 'B35', parent: 'sicilian',
    moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','g6','Nc3','Bg7','Be3','Nf6','Bc4'],
    structure: 'Classical Accelerated Dragon with Bc4, avoiding the Maroczy Bind and targeting f7.',
    whitePlans: ['Bb3/f3/Qd2/O-O-O Yugoslav-style attack', 'Nxc6 bxc6 e5 central push', 'O-O/Bb3/Re1 classical development'],
    blackPlans: ['...Qa5/...O-O/...d6 classical development', '...Ng4 hitting Be3 combined with ...d6', '...Nxd4 Bxd4 ...d6 simplification'],
    pitfalls: ['Castling kingside into a prepared storm', 'Playing ...O-O before ...Qa5 pins'],
    motifs: ['Bc4 targeting f7', 'Opposite-side castling race', '...Qa5 pin'] },

  // ─── Sveshnikov sub-variations ───
  { name: 'Sveshnikov — Chelyabinsk', eco: 'B33', parent: 'sicilian',
    moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','Nf6','Nc3','e5','Ndb5','d6','Bg5','a6','Na3','b5','Nd5','Be7','Bxf6','Bxf6','c4'],
    structure: 'Sveshnikov main-line position with White playing c4 to clamp Black\'s queenside; the Chelyabinsk is the heavily-analysed theoretical reference.',
    whitePlans: ['cxb5 axb5 Nxb5 trade combined with positional edge', 'Bd3/O-O classical development + Nc2-e3', 'a4/Nc2/Ne3 patient positional play'],
    blackPlans: ['...Bg5/...Bxc3 bishop trade combined with ...Ne7', '...Bb7/...O-O/...Rb8 active piece play', '...Rb8/...bxc4 exchange combined with active pieces'],
    pitfalls: ['Trading the dark-square bishop too early', 'Allowing Nd5 permanently'],
    motifs: ['d5 outpost', '...f5 kingside break', 'Bishop pair vs dark-square control'] },
  { name: 'Sveshnikov — Novosibirsk', eco: 'B33', parent: 'sicilian',
    moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','Nf6','Nc3','e5','Ndb5','d6','Bg5','a6','Na3','b5','Nd5','Qa5+'],
    structure: 'Aggressive Sveshnikov sub-line where Black interposes ...Qa5+ to disrupt the knight manoeuvres.',
    whitePlans: ['Bd2/Qd3 natural development after the check', 'c3/Bd2 blocking combined with a standard Sveshnikov treatment', 'Nxf6+ gxf6 trade + Bh6 dark-square play'],
    blackPlans: ['...Be7/...Qxd2+ bishop trade combined with piece play', '...Nxd5/...Be7 classical piece activity', '...Ra7-d7 rook lift supporting play on the d-file'],
    pitfalls: ['Overextending the queen to dangerous squares', 'Losing time on the queen while pieces sit at home'],
    motifs: ['Queen-check tempo', 'd5 outpost battle', '...f5 kingside break'] },

  // ─── KID sub-variations ───
  { name: 'KID — Mar del Plata 9.Nd2', eco: 'E99', parent: 'kid',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5','O-O','Nc6','d5','Ne7','Nd2'],
    structure: 'Classic Mar del Plata main-line move where the knight retreats to d2 to support queenside push while Black prepares kingside storm.',
    whitePlans: ['b4/c5 queenside pawn storm', 'Nb3 piece support for the queenside assault', 'f3/g4 kingside defence / restraint'],
    blackPlans: ['...f5/...f4/...g5 kingside pawn storm', '...Nh5/...Ng6 piece support for the storm', '...a5 restraining b4 combined with piece preparation'],
    pitfalls: ['Falling behind in the kingside race', 'Letting c5 break arrive without ...h4/...g3 spec shots'],
    motifs: ['Opposite-wing pawn race', '...g3 sacrificial breakthrough', 'Queenside c5 cracker'] },
  { name: 'KID — Mar del Plata 9.Bd2', eco: 'E99', parent: 'kid',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5','O-O','Nc6','d5','Ne7','Bd2'],
    structure: 'Bd2 alternative Mar del Plata — less committing than Nd2, preserves the knight for tactical duties.',
    whitePlans: ['Rc1/b4/Ba3 queenside expansion', 'Nc3-e1-d3 knight reroute supporting c5 break', 'g3/Bf3 kingside defence'],
    blackPlans: ['...f5/...Nh5 classical kingside setup', '...Rf7-g7 rook lift supporting the storm', '...a5 restraining b4'],
    pitfalls: ['Allowing b4/c5 without preparing kingside counter', '...g3 hacks without adequate support'],
    motifs: ['Opposite-wing race', '...g3 sacrifice', 'Queenside c5 cracker'] },
  { name: 'KID — Sämisch Panno', eco: 'E81', parent: 'kid',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','f3','Nc6','Nge2','a6'],
    structure: 'Panno variation of the Sämisch — Black plays ...Nc6/...a6/...Rb8/...b5 queenside expansion against the Sämisch pawn chain.',
    whitePlans: ['Be3/Qd2/O-O-O and kingside pawn storm', 'Nc1-b3 knight reroute supporting the queenside defence', 'd5 central push combined with h-file attack'],
    blackPlans: ['...Rb8/...b5/...bxc4 queenside expansion', '...Nd7/...e5 central counter-break', '...Na5 knight sortie combined with ...b5'],
    pitfalls: ['Allowing g4-g5 kingside storm without counterplay', '...b5 without piece support drops the pawn'],
    motifs: ['Opposite-side castling race', '...b5 queenside break', 'g4-h4-g5 storm'] },

  // ─── Grünfeld sub-variations ───
  { name: 'Grünfeld — Russian Hungarian (5.Qb3 ...a6)', eco: 'D97', parent: 'grunfeld',
    moves: ['d4','Nf6','c4','g6','Nc3','d5','Nf3','Bg7','Qb3','dxc4','Qxc4','a6'],
    structure: 'Russian System subvariation where Black plays ...a6 preparing ...b5 for queenside expansion and bishop trade.',
    whitePlans: ['e4/Be2/O-O/Bg5 classical broad-centre', 'a4 restraining ...b5', 'Bg5/Rd1 central pressure maintaining tension'],
    blackPlans: ['...b5 immediate queenside expansion', '...Bg4/...Nc6 piece pressure combined with ...b5', '...Bb7/...Nbd7 classical Grünfeld setup'],
    pitfalls: ['...b5 without ...Bg4 support loses the pawn', 'Allowing e4-e5 central clamp'],
    motifs: ['Queenside ...b5 expansion', 'Central ...c5 break', 'Long-diagonal Bg7 pressure'] },
  { name: 'Grünfeld — Nadanian Attack', eco: 'D85', parent: 'grunfeld',
    moves: ['d4','Nf6','c4','g6','Nc3','d5','cxd5','Nxd5','Na4'],
    structure: 'Sharp Modern Exchange sub-line where the knight jumps to a4, attacking the c5-pawn and supporting b4 queenside play.',
    whitePlans: ['Nxc5 capture combined with Be2/O-O', 'Bd3/O-O/Be3 classical development', 'a3/Rb1 queenside space'],
    blackPlans: ['...Qa5+/...Nc6 piece pressure on a4', '...cxd4/...Qa5 combined with piece activity', '...b6/...Bb7 classical fianchetto setup'],
    pitfalls: ['Trading on d4 without piece support', 'Allowing the queenside attack to gain momentum'],
    motifs: ['Na4-c5 jump', '...Qa5+ pin', 'Central ...c5 break'] },

  // ─── Semi-Slav sub-variations ───
  { name: 'Meran — Reynolds (...a6)', eco: 'D48', parent: 'semi-slav',
    moves: ['d4','d5','c4','c6','Nc3','Nf6','Nf3','e6','e3','Nbd7','Bd3','dxc4','Bxc4','b5','Bd3','a6'],
    structure: 'Reynolds System of the Meran — Black prepares ...c5 with ...a6 rather than ...Bb7.',
    whitePlans: ['e4 central push combined with piece development', 'a4 restraining queenside expansion', 'Nxb5 tactical shot in concrete lines'],
    blackPlans: ['...c5 central break combined with piece activity', '...Bb7/...Be7/...O-O solid classical setup', '...Nb6/...Bb7 queenside piece redeployment'],
    pitfalls: ['Allowing e4-e5 clamp without counter-play', 'Playing ...c5 too early and losing structure'],
    motifs: ['Central ...c5 lever', 'Queenside ...b5-a6 structure', 'a4-a5 restraining probe'] },
  { name: 'Meran — Wade (...Bb7 with ...Bd6)', eco: 'D49', parent: 'semi-slav',
    moves: ['d4','d5','c4','c6','Nc3','Nf6','Nf3','e6','e3','Nbd7','Bd3','dxc4','Bxc4','b5','Bd3','Bb7','O-O','Bd6'],
    structure: 'Wade variation of the Meran — Black places the dark-bishop aggressively on d6 rather than e7.',
    whitePlans: ['e4/Ng5/f4 aggressive kingside setup', 'Nd2/f3 solid positional setup', 'a4 queenside restraint'],
    blackPlans: ['...O-O/...c5 central counter-break', '...Qe7/...Rad8 classical heavy-piece activity', '...Ne4 piece pressure on the centre'],
    pitfalls: ['Leaving Bd6 exposed to e5 push', 'Allowing Nxb5 tactical shots'],
    motifs: ['Bd6 aggressive placement', 'Central e4 lever', '...c5 freeing break'] },
  { name: 'Anti-Meran — 6.Qb3', eco: 'D45', parent: 'semi-slav',
    moves: ['d4','d5','c4','c6','Nc3','Nf6','Nf3','e6','e3','Nbd7','Qb3'],
    structure: 'Anti-Meran sub-line aimed at pressuring both b7 and the centre early, avoiding the main Meran lines.',
    whitePlans: ['Bd3/O-O/e4 classical development with queen pressure', 'c5 queenside clamp when Black commits', 'Bd2/Rc1 classical slow build'],
    blackPlans: ['...Bd6/...O-O/...e5 classical central counter', '...Qa5/...Ne4 piece pressure combined with central play', '...b5/...dxc4 queenside expansion'],
    pitfalls: ['Allowing Qxb7 on a weak moment', 'Playing ...b5 without piece support'],
    motifs: ['Queen on b3 pressure', 'Central ...e5 break', 'c5 queenside clamp'] },

  // ─── QGD sub-variations ───
  { name: 'QGD Ragozin — 5.Bg5', eco: 'D38', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','Nf3','Bb4','Bg5'],
    structure: 'Aggressive Ragozin sub-line where White pins the Nf6 in addition to the central tension.',
    whitePlans: ['Qa4+ followed by Bxf6 trade combined with e3/Bd3 development', 'a3/Bxf6 gxf6 structural damage', 'e3/Rc1 classical positional setup'],
    blackPlans: ['...h6/...Bxc3+ combined with ...Ne4', '...O-O/...dxc4 central trade', '...c5 immediate central counter-break'],
    pitfalls: ['Allowing Bxf6 gxf6 + Qa4+ combined tactics', 'Playing ...Ne4 without piece support'],
    motifs: ['Double pin pressure', 'Structural damage via Bxf6', '...Ne4 central outpost'] },
  { name: 'QGD Exchange — 6.Qc2', eco: 'D35', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','cxd5','exd5','Bg5','c6','Qc2'],
    structure: 'Exchange QGD with Qc2 preparing Bd3 and kingside castling, flexible between minority attack and kingside play.',
    whitePlans: ['Bd3/Nge2/O-O and f3/e4 central break', 'Bd3/Nf3/O-O and b4-b5 minority attack', 'g3/Bg2 kingside fianchetto setup'],
    blackPlans: ['...Be7/...O-O/...Re8 classical development', '...Nbd7/...Nf8/...Ng6 classical piece regrouping', '...f5 kingside expansion'],
    pitfalls: ['Allowing minority attack without counter-play', 'Missing the right moment for ...f5'],
    motifs: ['Minority attack b4-b5', 'Central e4 break', '...f5 kingside expansion'] },
  { name: 'QGD Tartakower — Tarrasch', eco: 'D59', parent: 'qgd',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O','Nf3','h6','Bh4','b6','cxd5','Nxd5'],
    structure: 'Tartakower sub-line where Black recaptures with the knight, producing a sharper middlegame than the pure Tartakower.',
    whitePlans: ['Bxe7/Nxd5 trade combined with slight structural edge', 'Rc1/Qb3 classical development with central pressure', 'a4-a5 queenside expansion'],
    blackPlans: ['...Bxh4/...Nxh4 bishop trade combined with ...Bb7', '...c5 central break', '...Bb7/...Nd7/...Qc8 classical development'],
    pitfalls: ['Letting White reach an ideal IQP position', 'Trading pieces without relieving the cramp'],
    motifs: ['Symmetric pawn structure', 'Nd5 piece trade', '...c5 freeing break'] },

  // ─── Ruy Lopez sub-variations ───
  { name: 'Ruy Open — Classical 9...Be7', eco: 'C82', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Nxe4','d4','b5','Bb3','d5','dxe5','Be7'],
    structure: 'Classical main-line Open Ruy where Black places the bishop on e7 and prepares ...O-O.',
    whitePlans: ['c3/Nbd2/Bc2 classical development', 'Nxe4 dxe4 trade combined with piece activity', 'Re1/Nbd2/Bg5 piece pressure setup'],
    blackPlans: ['...O-O/...Nc5 knight redeployment', '...Be6/...Rad8 classical heavy-piece activity', '...f5 kingside expansion'],
    pitfalls: ['Playing ...Nc5 too early and losing the pawn', 'Allowing Nxe4 trade when it ruins structure'],
    motifs: ['Ne4 central outpost', '...f5 kingside expansion', 'Central IQP-like structures'] },
  { name: 'Ruy Modern Arkhangelsk', eco: 'C78', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','b5','Bb3','Bb7','Re1','Bc5'],
    structure: 'Modern Arkhangelsk of the Ruy Lopez — Black develops both bishops actively and plays for kingside attack.',
    whitePlans: ['c3/d4 central push combined with piece activity', 'Nc3/a4 classical development with central pressure', 'Bd5 exchange combined with piece simplification'],
    blackPlans: ['...O-O/...d6 classical setup combined with kingside attack', '...Qe7/...h6/...O-O-O alternative king placement', '...Nxd4 Nxd4 combined with ...Bxd4'],
    pitfalls: ['Allowing c3/d4 central steamroller', 'Trading Bc5 without compensation'],
    motifs: ['Double-fianchetto-style pressure', 'Central d4 lever', 'Kingside ...h6 / ...g5 storm'] },
  { name: 'Ruy Anti-Marshall — 8.d4', eco: 'C88', parent: 'ruy',
    moves: ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','O-O','d4'],
    structure: 'Rare but aggressive Anti-Marshall sub-line where White immediately strikes at the centre before allowing Black to play ...d5.',
    whitePlans: ['d4 central break combined with piece activity', 'a4 queenside probing combined with c3', 'c3/Nbd2 classical development'],
    blackPlans: ['...exd4/...Nxd4 exchange combined with central piece play', '...d6/...Bg4 solid classical development', '...d5 central counter-break'],
    pitfalls: ['Trading on d4 prematurely without compensation', 'Allowing a4 combined with structural concessions'],
    motifs: ['Central d4 lever', '...exd4 trade', 'Piece activity in the centre'] },

  // ─── Italian Game sub-variations ───
  { name: 'Italian Göring Gambit', eco: 'C44', parent: 'italian',
    moves: ['e4','e5','Nf3','Nc6','d4','exd4','c3'],
    structure: 'White gambits the d-pawn for central control and rapid development, related to the Danish Gambit.',
    whitePlans: ['Nxd4/Bc4/O-O classical development', 'Bd3/Qxd4 combined with piece activity', 'Nxc3/e5 combined with central clamp'],
    blackPlans: ['...dxc3 accepting material and trying to consolidate', '...d6 declining with solid development', '...Bb4+/...dxc3 trade combined with development'],
    pitfalls: ['Taking the pawn without preparing development', 'Allowing the centre to roll unchallenged'],
    motifs: ['Central piece activity', 'Gambit-style rapid development', 'f7 tactical pressure'] },
  { name: 'Italian — Modern Slow (Bc4 d3 c3)', eco: 'C50', parent: 'italian',
    moves: ['e4','e5','Nf3','Nc6','Bc4','Bc5','d3','Nf6','c3','d6','O-O','a6','h3'],
    structure: 'Modern slow Italian — popular at the top level today, emphasising long manoeuvring before committing to a break.',
    whitePlans: ['Nbd2/Re1/Nf1-g3 knight reroute', 'a4/Bb3/Ba2 bishop retreat preserving the tension', 'd3-d4 central break at the right moment'],
    blackPlans: ['...Ba7/...h6/...Re8 mirror manoeuvring', '...Bd7/...Nh5/...f5 kingside expansion', '...d5 central counter-break'],
    pitfalls: ['Getting outmanoeuvred without a clear plan', 'Missing the d5 break timing'],
    motifs: ['Slow manoeuvring', 'Knight tour Nb1-d2-f1-g3', 'Central ...d5 break'] },
  { name: 'Scotch — Mieses Variation', eco: 'C45', parent: 'scotch',
    moves: ['e4','e5','Nf3','Nc6','d4','exd4','Nxd4','Nf6','Nxc6'],
    structure: 'Modern Scotch main line where White trades knights immediately to create a structural imbalance.',
    whitePlans: ['e5 central push combined with piece activity', 'Bd3/O-O classical development', 'Nc3/Bg5 development with pressure'],
    blackPlans: ['...bxc6/...d6/...Qe7 classical development', '...Qe7/...Nxe4 tactical counter-play', '...dxc6/...Ng4 piece activity'],
    pitfalls: ['Allowing e5 kick without adequate preparation', 'Walking into Qg4 ideas on the kingside'],
    motifs: ['Central e5 push', '...Nxe4 tactical shot', 'Bishop-pair vs structure'] },

  // ─── Caro-Kann sub-variations ───
  { name: 'Caro-Kann — Advance Short System', eco: 'B12', parent: 'caro-kann',
    moves: ['e4','c6','d4','d5','e5','Bf5','Nf3','e6','Be2'],
    structure: 'Short System — White plays Be2 and c3, preparing kingside castling and slow positional play against the Caro-Kann Advance.',
    whitePlans: ['O-O/c3/Nbd2 classical development', 'Nh4 bishop-trade idea combined with f4', 'a3/b4 queenside expansion'],
    blackPlans: ['...Nd7/...Ne7/...h6 solid development', '...Bxe2/...Ne7 combined with ...c5', '...c5 immediate central counter-break'],
    pitfalls: ['Allowing Nh4 bishop-trade without counter-play', 'Playing ...c5 too early and losing structure'],
    motifs: ['Slow positional squeeze', 'Nh4 bishop-trade', '...c5 central break'] },

  // ─── French sub-variations ───
  { name: 'French Winawer — Armenian 7...Qa5', eco: 'C18', parent: 'french',
    moves: ['e4','e6','d4','d5','Nc3','Bb4','e5','c5','a3','Bxc3+','bxc3','Ne7','Qg4','Qa5'],
    structure: 'Armenian Variation of the Winawer — Black plays ...Qa5 instead of ...Qc7 to pressure the c3-pawn immediately.',
    whitePlans: ['Qxg7/Bd2 combined with classical attack', 'Bd2/Qg4-h5 combined with kingside attack', 'Ne2/Rb1 defending c3 combined with kingside prep'],
    blackPlans: ['...Qxc3+/...Kf8 material grab combined with king safety', '...Nbc6/...Bd7/...O-O-O opposite castling', '...Ng6/...Nxe5 central tactics'],
    pitfalls: ['Grabbing c3 prematurely combined with piece misplacement', 'Losing the queen in tactical complications'],
    motifs: ['Queen pressure on c3/a5', '...Qxc3+ material grab', 'Opposite-side castling race'] },

  // ─── Nimzo sub-variations ───
  { name: 'Nimzo — Sämisch Accelerated (4.f3)', eco: 'E20', parent: 'nimzo',
    moves: ['d4','Nf6','c4','e6','Nc3','Bb4','f3'],
    structure: 'Accelerated Sämisch — White commits to f3/e4 immediately before a3 to save a tempo.',
    whitePlans: ['e4 central push combined with Bd3/Ne2 development', 'a3/Bxc3+ classical Sämisch transition', 'Nge2/Bg5 classical development'],
    blackPlans: ['...d5/...c5 classical central counter-break', '...O-O/...d5 solid development', '...Bxc3+/bxc3 ...d5 classical Sämisch setup'],
    pitfalls: ['Allowing e4-e5 central clamp', 'Playing ...Bxc3+ without structural compensation'],
    motifs: ['Central e4 lever', 'Doubled c-pawn trade-off', 'Central ...d5 / ...c5 break'] },

  // ═════════════════════ STRUCTURAL ANCHORS ═════════════════════
  // These are deep (17–21 ply) canonical positions for key structural
  // archetypes. They exist primarily to help the FEN-based structural
  // matcher recognise transpositions — e.g., a Maroczy Bind reached via
  // 1.c4 will now find "Maroczy Bind Full" rather than an unrelated
  // nearest neighbour. They duplicate some move sequences you could
  // also reach via shallower book entries; when both match, the deeper
  // anchor wins (longest-prefix-first for exact hits, more-specific
  // entry preferred for structural hits).
  { name: 'Maroczy Bind Full', eco: 'B38', parent: 'anchor-maroczy',
    moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','g6','c4','Nf6','Nc3','d6','Be2','Nxd4','Qxd4','Bg7','Bg5','O-O','Qd2'],
    structure: 'White restrains with c4 + e4, denying ...d5 and ...b5; Black plays for piece activity, the ...Ng4 trade, and the long-term ...b5 break.',
    whitePlans: ['Rfd1/f3/b3 consolidation and slow squeeze on d5', 'Qd2/Bh6 dark-bishop trade before kingside pressure', 'Rc1/Nd5 central outpost combined with queenside play'],
    blackPlans: ['...Be6/...Qa5/...Rfc8 piece pressure on c4 and the c-file', '...Ng4 Bxg4 Bxg4 bishop-pair exchange relieving cramp', '...a6/...b5 at the right moment breaking the clamp'],
    pitfalls: ['Premature ...b5 without full piece support drops material', 'Allowing Nd5 + Bh6 dark-square dominance'],
    motifs: ['Maroczy clamp c4/e4', 'Nd5 central outpost', '...b5 break'] },
  { name: 'Hedgehog Classical Full', eco: 'A30', parent: 'anchor-hedgehog',
    moves: ['c4','c5','Nf3','Nf6','g3','b6','Bg2','Bb7','O-O','e6','Nc3','Be7','d4','cxd4','Qxd4','d6','Rd1','a6','Bg5','Nbd7'],
    structure: 'Black\'s pawns fix on a6/b6/d6/e6 (the hedgehog skin); pieces coil for the ...b5 or ...d5 break. White holds the maximum centre and plays restraint.',
    whitePlans: ['Rfd1/b3/Be3/Rac1 full restraint setup denying both breaks', 'Nd5 central trade simplifying into a favourable endgame', 'e4/Nd2/f4 central expansion exploiting the space edge'],
    blackPlans: ['...Rc8/...Qc7/...Rfd8 heavy-piece reorganisation before the break', '...b5 queenside break at the full-preparation moment', '...d5 central break at the full-preparation moment'],
    pitfalls: ['Playing either break too early without all heavies in position', 'Allowing White to complete the full restraint then trade into a clamp endgame'],
    motifs: ['Hedgehog skin a6/b6/d6/e6', 'Long-diagonal Bb7 pressure', '...b5 / ...d5 breaks'] },
  { name: 'Stonewall Dutch Full', eco: 'A95', parent: 'anchor-stonewall',
    moves: ['d4','f5','g3','Nf6','Bg2','e6','Nf3','d5','c4','c6','O-O','Bd6','Qc2','O-O','Nc3','Qe7','Bf4','Bxf4','gxf4'],
    structure: 'Rigid c6/d5/e6/f5 fortress with the dark-squared bishop traded off; Black trades the bad bishop and plays for the Ne4 outpost and kingside attack.',
    whitePlans: ['Ne5 outpost combined with Qf3-Qh3 kingside pressure', 'b3/Bb2/Rac1 queenside buildup with minority attack', 'e3/cxd5 opening the c-file and targeting weak dark squares'],
    blackPlans: ['...Ne4/...Nd7/...Qf6 classical Stonewall setup with kingside attack', '...Bd7-e8-h5 re-routing the bad bishop before trading', '...Rf6-h6 kingside rook lift attack'],
    pitfalls: ['Trading the dark-squared bishop before ...Ne4 is secured', 'Letting White close the queenside then overwhelm the kingside'],
    motifs: ['Ne4 central outpost', 'Dark-square e5 weakness', 'Kingside rook lift attack'] },
  { name: 'Stonewall Attack (White)', eco: 'D00', parent: 'anchor-stonewall-attack',
    moves: ['d4','d5','e3','Nf6','Bd3','c5','c3','Nc6','f4','Bg4','Nf3','e6','O-O','Bd6','Ne5'],
    structure: 'White mirrors the Stonewall a tempo up: c3/d4/e3/f4 with pieces aiming for a kingside attack via Ne5 + Qf3 + Rf3 lifts.',
    whitePlans: ['Ne5/Qf3 combined with kingside pawn storm', 'Rf3-h3 rook-lift direct kingside attack', 'b3/Bb2/Nbd2 queenside development with minor-piece support'],
    blackPlans: ['...Bxf3 trading the active knight combined with ...Nbd7/...Nb6', '...Qb6 pressuring b2 and the queenside', '...c4 queenside clamp restricting Bd3'],
    pitfalls: ['Letting Ne5 + f4-f5 break open the kingside unchallenged', 'Playing ...Nbd2 too early and blocking the queenside'],
    motifs: ['Ne5 outpost', 'Kingside f4-f5 lever', 'Rf3-h3 rook lift'] },
  { name: 'IQP Classical (White holds d4)', eco: 'D32', parent: 'anchor-iqp',
    moves: ['d4','d5','c4','e6','Nc3','c5','cxd5','exd5','Nf3','Nf6','g3','Nc6','Bg2','Be7','O-O','O-O','Bg5','Be6'],
    structure: 'White carries the isolated d-pawn; Black blockades on d5/d6 with pieces and plays for exchanges. Classic reassess-structure vs piece-activity trade-off.',
    whitePlans: ['Nf3/Bd3/Qd3 combined with kingside attack and piece pressure', 'd4-d5 advance break turning the pawn into a passer', 'Rfd1/Rac1 heavy-piece activity exploiting open files'],
    blackPlans: ['...Nbd7/...Nb6/...Be7 full blockade setup combined with trades', '...Bxf3/...Bf6 minor-piece trades reducing attacking potential', '...Rc8/...Rfd8 doubling heavy pieces on open files'],
    pitfalls: ['Trading the wrong minor pieces and losing the blockade', 'Allowing d4-d5 advance break with central pressure'],
    motifs: ['Isolated d-pawn', 'd4-d5 advance break', 'Blockade on d5'] },
  { name: 'IQP for Black (Black holds d5)', eco: 'B14', parent: 'anchor-iqp',
    moves: ['e4','c6','d4','d5','exd5','cxd5','c4','Nf6','Nc3','e6','Nf3','Be7','Bd3','O-O','O-O','Nc6','a3'],
    structure: 'Black carries the isolated d-pawn; White blockades on d4/d5 with pieces and plays for exchanges. Colours-reversed classical IQP.',
    whitePlans: ['Bg5/Nf3/Qd2 combined with kingside attack and piece pressure', 'd4-d5 piece-outpost blockade combined with trades', 'Rfd1/Rac1 heavy-piece activity exploiting open files'],
    blackPlans: ['...Nbd7/...Nb6/...Be7 full blockade setup combined with trades', '...Bxf3/...Bf6 minor-piece trades reducing attacking potential', '...d4 advance break at the right moment'],
    pitfalls: ['Trading the wrong minor pieces and losing piece activity', 'Allowing the pawn to be won in a piece-simplification'],
    motifs: ['Isolated d-pawn (Black)', '...d4 advance break', 'Piece activity for structural cost'] },
  { name: 'Hanging Pawns Setup', eco: 'E15', parent: 'anchor-hanging',
    moves: ['d4','Nf6','c4','e6','Nf3','b6','g3','Bb7','Bg2','Bb4+','Bd2','Be7','O-O','O-O','Nc3','d5','cxd5','exd5','Rc1','c5'],
    structure: 'Black carries the hanging c5/d5 pawns; White blockades and tries to force one pawn to advance, creating weakness on the other.',
    whitePlans: ['Ne5/Bd2/Qa4 combined with blockade and piece pressure', 'dxc5 trade combined with pressure on the isolated d-pawn', 'Nb3/Na4 queenside piece play attacking the c-pawn'],
    blackPlans: ['...Nc6/...Qd6/...Rac8 classical active piece play around the pawns', '...d4 advance break creating a passed pawn', '...c4 advance break creating the outside passer'],
    pitfalls: ['Letting one pawn advance without adequate piece support', 'Trading into an endgame with weak hanging pawns'],
    motifs: ['Hanging c5/d5 pawns', '...d4 or ...c4 advance break', 'Blockade on d4/c4'] },
  { name: 'Benoni Wedge Mature', eco: 'A70', parent: 'anchor-benoni',
    moves: ['d4','Nf6','c4','c5','d5','e6','Nc3','exd5','cxd5','d6','e4','g6','Nf3','Bg7','Be2','O-O','O-O','Re8','Nd2','Na6'],
    structure: 'White e4/d5/c4 wedge vs Black c5/d6 with queenside majority; Black plays for ...b5 and e5-square dominance.',
    whitePlans: ['Nd2-c4 increasing d6 pressure combined with e5 break', 'e5 breakthrough cracking the position open', 'Bf4/Bg5 blunting the fianchetto and pressuring d6'],
    blackPlans: ['...b5 via ...a6/...Rb8 opening the queenside', '...Nbd7-e5/...Re8 piece pressure on the centre', '...Bxc3 + ...Ne5 long-diagonal tactics'],
    pitfalls: ['...b5 without ...a6 allows Bxb5 sacrificial shots', 'Forgetting the e5-square and letting White occupy it'],
    motifs: ['Minority attack ...b5', 'e4-e5 central lever', '...Ne5 outpost'] },
  { name: 'Closed Sicilian Mature', eco: 'B25', parent: 'anchor-closed-sicilian',
    moves: ['e4','c5','Nc3','Nc6','g3','g6','Bg2','Bg7','d3','d6','f4','e6','Nf3','Nge7','O-O','O-O','Be3','Nd4'],
    structure: 'Symmetrical fianchetto setup with White aiming for f4-f5-f6 kingside push; Black plays for ...Nd4 outpost and queenside expansion.',
    whitePlans: ['f4-f5 pawn lever combined with kingside piece push', 'Qd2/Nh3-f2/g4-g5 direct kingside attack', 'a3/Rb1/b4 queenside expansion vs Black setup'],
    blackPlans: ['...Nd4/...b5/...Rb8 classical queenside expansion', '...f5 central counter-break stopping White push', '...b5-b4 queenside breakthrough exposing the king'],
    pitfalls: ['Falling behind in the kingside pawn race when White commits first', 'Playing ...f5 too early and leaving d5 permanently weak'],
    motifs: ['f4-f5 pawn lever', '...Nd4 outpost', '...b5-b4 queenside break'] },
  { name: 'French Chain Classical (Steinitz)', eco: 'C11', parent: 'anchor-french-chain',
    moves: ['e4','e6','d4','d5','Nc3','Nf6','e5','Nfd7','f4','c5','Nf3','Nc6','Be3','cxd4','Nxd4','Bc5','Qd2','O-O','O-O-O'],
    structure: 'The classic French pawn chain: White e5/d4 vs Black e6/d5, with opposite castling and a race typical of Steinitz and Classical French main lines.',
    whitePlans: ['Kingside pawn push g4-g5 combined with piece attack', 'f4-f5 pawn lever cracking the e6-pawn', 'Bd3/Qh5 direct kingside attack setup'],
    blackPlans: ['...a6/...b5/...b4 queenside counter-attack', '...Qb6/...Nxd4 central piece trades', '...f6 breaking the e5-chain at the right moment'],
    pitfalls: ['Trading on d4 too early and losing the ...f6 break', 'Castling kingside into the prepared f5-f6 attack'],
    motifs: ['Pawn chain e5/d4 vs e6/d5', 'Opposite-side castling race', '...f6 freeing break'] },
  { name: 'KID Pawn Chain Locked', eco: 'E97', parent: 'anchor-kid-chain',
    moves: ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5','O-O','Nc6','d5','Ne7','Nd2'],
    structure: 'Fully locked chain c4/d5/e4 vs d6/e5; typical opposite-wing attacks, with White on the queenside and Black on the kingside.',
    whitePlans: ['b4/c5 queenside pawn storm aimed at cracking d6', 'Nb1-d2-b3 reroute supporting the queenside break', 'Rc1/Ba3 heavy-piece support for the queenside attack'],
    blackPlans: ['...f5/...f4/...g5 classic kingside pawn storm', '...Nh5/...Ng6 piece support for the kingside attack', '...h5/...h4 preparing ...g3 sacrificial breakthrough'],
    pitfalls: ['Falling behind in the kingside race after a slow ...f5', 'Letting c5 arrive and cracking d6 before the kingside break'],
    motifs: ['Opposite-wing pawn race', '...g3 sacrificial breakthrough', 'Queenside c5 cracker'] },
  { name: 'Carlsbad with Minority Attack Setup', eco: 'D35', parent: 'anchor-carlsbad',
    moves: ['d4','d5','c4','e6','Nc3','Nf6','cxd5','exd5','Bg5','c6','Qc2','Be7','e3','Nbd7','Bd3','O-O','Nge2','Re8','O-O','Nf8','Rab1'],
    structure: 'Classical Carlsbad with White preparing the minority attack (b2-b4-b5xc6) to create a weak c6-pawn, while Black plays for ...f5 and kingside expansion.',
    whitePlans: ['b4-b5xc6 minority attack creating the weak c6-pawn', 'Central e3-e4 break combined with piece pressure', 'Kingside Qc2/Bd3/O-O-O combined with g4 space-gain'],
    blackPlans: ['...f5 kingside expansion matching minority attack tempo', '...Nh5/...Nf4 kingside piece activity', '...Ng6/...Nh4 piece reorganisation around the pawn chain'],
    pitfalls: ['Allowing bxc6 without counter-play', 'Attacking kingside before queenside is ready'],
    motifs: ['Minority attack b4-b5', '...f5 kingside break', 'Central lever e3-e4'] },
  { name: 'Open Catalan Pressure Full', eco: 'E04', parent: 'anchor-catalan',
    moves: ['d4','Nf6','c4','e6','g3','d5','Bg2','dxc4','Nf3','a6','O-O','Nc6','e3','Rb8','Qe2','b5','Rd1','Bb7','Nc3','Be7'],
    structure: 'Open Catalan full setup with Black holding c4 and White exerting maximum long-diagonal pressure via Bg2 and the half-open d-file.',
    whitePlans: ['Long-diagonal pressure combined with Ne5/Rd1 piece activity', 'Central d4-d5 break at the right moment', 'e4 central push combined with tactical pressure'],
    blackPlans: ['...Bb7/...Rb8/...b5 solid queenside structure', '...c5 central counter-break', '...O-O/...Be7/...Nb4 piece redeployment'],
    pitfalls: ['Over-extending on the queenside without piece support', 'Allowing d4-d5 to crack the position open'],
    motifs: ['Long-diagonal Bg2 pressure', 'Central d4-d5 advance', 'Queenside ...b5 expansion'] },
  { name: 'Berlin Wall Endgame', eco: 'C67', parent: 'anchor-berlin',
    moves: ['e4','e5','Nf3','Nc6','Bb5','Nf6','O-O','Nxe4','d4','Nd6','Bxc6','dxc6','dxe5','Nf5','Qxd8+','Kxd8','Nc3','Ke8','h3','h5'],
    structure: 'Classical Berlin Wall endgame — Black with doubled c-pawns and bishop pair, White with kingside majority and space; a battle of structure versus piece activity.',
    whitePlans: ['Kingside pawn majority build combined with slow squeeze', 'h3/g4 restricting the bishop pair mobility', 'Trade into a favourable pawn-majority endgame'],
    blackPlans: ['...Bd7-e8/...Kc7-d8 manual king-centralisation', '...Be7/...h6/...g5 bishop-pair activity', '...Nh4/...Bh6 piece activity on the kingside'],
    pitfalls: ['Pushing kingside pawns too fast weakening the king structure', 'Trading the bishop pair without structural compensation'],
    motifs: ['Doubled c-pawn structural cost', 'Bishop pair vs kingside majority', 'King-centralisation endgame'] },
  { name: 'Dragon Yugoslav Opposite Castle', eco: 'B76', parent: 'anchor-dragon',
    moves: ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','g6','Be3','Bg7','f3','O-O','Qd2','Nc6','O-O-O','d5','Nxc6','bxc6'],
    structure: 'The classic Yugoslav Attack opposite-castle race — White kingside-attack storm vs Black queenside counter-attack.',
    whitePlans: ['g4/h4-h5 kingside pawn storm combined with Bh6 trade', 'Bh6/hxg6 opening the h-file for mate attack', 'Nd5/e5 central tactical breakthroughs'],
    blackPlans: ['...Rc8/...Qa5/...a5 queenside piece pressure', '...Rxc3 exchange sacrifice shattering White queenside', '...a5-a4 pawn-lever opening the b-file'],
    pitfalls: ['Playing slowly on the queenside and losing the race', 'Allowing Bh6 trade plus h-file opening unchecked'],
    motifs: ['Opposite-side castling race', 'h-file attack with Bh6 + hxg6', '...Rxc3 exchange sac'] },
  { name: 'English Botvinnik Reversed Sicilian', eco: 'A26', parent: 'anchor-english-botvinnik',
    moves: ['c4','e5','Nc3','Nc6','g3','g6','Bg2','Bg7','e4','d6','Nge2','Nge7','O-O','O-O','d3','Be6','Rb1'],
    structure: 'Reversed Closed Sicilian with White a tempo up — c4/d3/e4 vs ...e5/...d6 with fianchetto bishops, and White launching a queenside b4 break.',
    whitePlans: ['b4/Rb1 queenside pawn expansion with minor-piece support', 'f4 kingside pawn push combined with piece activity', 'Nd5 central outpost combined with trade'],
    blackPlans: ['...Nd4/...a5 queenside restraint combined with piece activity', '...f5 kingside counter-break', '...Qd7/...Bh3 bishop trade reducing attacking potential'],
    pitfalls: ['Allowing b4-b5 unchallenged cracking the queenside', 'Playing ...f5 without adequate support'],
    motifs: ['Reversed Closed Sicilian', 'b4 queenside break', 'Nd5 outpost'] },
  { name: 'Nimzo IQP with Blockade', eco: 'E54', parent: 'anchor-iqp',
    moves: ['d4','Nf6','c4','e6','Nc3','Bb4','e3','O-O','Bd3','d5','Nf3','c5','O-O','dxc4','Bxc4','cxd4','exd4','b6','Bg5','Bb7','Rc1'],
    structure: 'Classic Nimzo IQP position with Black blockading on d5 (often via ...Nd5/...Nb6) and the bishop pair as compensation for the pawn.',
    whitePlans: ['Nf3/Bd3 combined with kingside attack and piece pressure', 'd4-d5 advance break turning the pawn into a passer', 'Rfd1/Rac1 heavy-piece activity on the central files'],
    blackPlans: ['...Nd5/...Nb6 combined with ...Nbd7 full blockade setup', '...Bxf3/...Bf6 minor-piece trades reducing attacking potential', '...Rc8/...Bb7 long-diagonal pressure'],
    pitfalls: ['Trading the bishop pair too early without blockade secured', 'Allowing d4-d5 advance break with central pressure'],
    motifs: ['Isolated d-pawn', 'Blockade on d5', '...Ba6 light-bishop trade'] },
  { name: 'London Full Pyramid', eco: 'D02', parent: 'anchor-london',
    moves: ['d4','Nf6','Nf3','e6','Bf4','c5','e3','Nc6','c3','b6','Nbd2','Bb7','Bd3','Be7','O-O','O-O','Ne5'],
    structure: 'Complete London pyramid c3/d4/e3 with pieces in classical squares and Ne5 outpost established — template for typical Bxh7+ / h4-h5 attacking motifs.',
    whitePlans: ['Ne5/f4 combined with kingside pawn storm', 'Bxh7+ Greek-gift sacrifice when the pieces align', 'Minority attack b2-b4-b5 on the queenside'],
    blackPlans: ['...Nh5/...Bxh2+ counter-tactical shots', '...cxd4/...Nxe5 simplifying trades', '...Bd6/...Qe7/...Rac8 slow maneuvering'],
    pitfalls: ['Mechanical h3/Bh2 without a plan loses tempo', 'Playing ...Bxh2+ tactics when undefended'],
    motifs: ['Ne5 outpost + f4 support', 'Bxh7+ Greek-gift sacrifice', 'Minority attack b2-b4-b5'] },
  { name: 'Grünfeld Exchange Full Classical', eco: 'D85', parent: 'anchor-grunfeld',
    moves: ['d4','Nf6','c4','g6','Nc3','d5','cxd5','Nxd5','e4','Nxc3','bxc3','Bg7','Nf3','c5','Rb1','O-O','Be2','cxd4','cxd4','Qa5+'],
    structure: 'Classical Grünfeld Exchange with full c3/d4/e4 white pawn centre and Black piling heavy pieces on the centre with ...Qa5+ standard move.',
    whitePlans: ['Short castle + Rb1/Bd2 defending c3 combined with centre push', 'd4-d5 or e4-e5 centre advance at the right moment', 'Rfd1/Be3 heavy-piece defence combined with slow squeeze'],
    blackPlans: ['...Bg4/...Nc6 piece pressure on d4', '...Rfd8/...Rac8 heavy-piece activity on the centre', '...b5/...Bb7 queenside expansion with long-diagonal pressure'],
    pitfalls: ['Pushing d5 prematurely frees the Bg7 bishop', 'Trading on c3 without adequate compensation'],
    motifs: ['Long-diagonal pressure on d4', 'Central pawn roller d4-d5/e4-e5', '...Qa5+ pin idea'] },
  { name: 'Sveshnikov Main-Line Hole on d5', eco: 'B33', parent: 'anchor-sveshnikov',
    moves: ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','Nf6','Nc3','e5','Ndb5','d6','Bg5','a6','Na3','b5','Nd5','Be7','Bxf6','Bxf6','c3'],
    structure: 'The full Sveshnikov main-line position: White with a massive d5-outpost and bishop-pair pressure, Black with active piece play and the ...f5 break as compensation.',
    whitePlans: ['Nc2-e3 supporting the Nd5 outpost combined with trade', 'a4/b3/O-O slow consolidation with structural edge', 'c3/Bd3/O-O classical development with central pressure'],
    blackPlans: ['...Bg5/...Ne7 trading the Nd5 outpost', '...f5 kingside pawn break combined with piece pressure', '...O-O/...Rb8/...Bb7 queenside piece activity'],
    pitfalls: ['Unchallenged Nd5 leads to permanent structural bind', '...f5 break without preparation opens the e-file'],
    motifs: ['Nd5 central outpost', '...Bxd5 eliminating the outpost', '...f5 kingside break'] },
];

// Mark every curated entry so we can prefer them over Lichess entries
// in tie-breaks and skip plan-rendering for Lichess-only matches.
for (const e of BOOK_RAW) e._source = 'curated';

// ─── Merge in Lichess's 3,690 named openings (CC0) ───────────────────
// These cover every known ECO line + sub-variation + nickname in
// practical chess usage. Each entry is name + eco + moves only (no
// hand-written plans/motifs). When such an entry is returned by the
// matcher, the UI shows the name + a note that plan details are
// pulled from the engine lines for that specific position rather
// than from a hand-written coach entry.
//
// Generated from https://github.com/lichess-org/chess-openings via
// scripts/build-lichess-openings.mjs into src/openings_lichess.js.
try {
  // Use static import to avoid async / module-init race. If the file
  // is missing (fresh clone without running the build script), the
  // app still works with just the curated entries.
  // eslint-disable-next-line no-undef
  // Imported at the top of this module.
  for (const o of LICHESS_OPENINGS) {
    BOOK_RAW.push({
      name: o.name,
      eco: o.eco,
      parent: 'lichess-db',
      moves: o.moves,
      _source: 'lichess',
    });
  }
} catch (err) {
  console.warn('[openings_book] could not load Lichess openings DB:', err.message);
}

// Normalise move-count for prefix-match sorting
for (const e of BOOK_RAW) e._len = (e.moves || []).length;
// Sort longest-first so detectOpening returns the most-specific match.
// Tie-breaker: curated entries win over lichess so hand-written plans
// take precedence when both share the same prefix length.
BOOK_RAW.sort((a, b) => {
  if (b._len !== a._len) return b._len - a._len;
  const aw = a._source === 'curated' ? 0 : 1;
  const bw = b._source === 'curated' ? 0 : 1;
  return aw - bw;
});

// ─── FEN signatures (pre-computed once at module load) ────────────────
// Replay each entry's moves[] on a chess.js instance, capture the
// resulting FEN, and derive a compact signature used for structural
// matching. Any entry whose moves can't be replayed legally is skipped
// for structural matching but still works for SAN-prefix.

function boardToPlacement(chess) {
  const b = chess.board();
  let pawns = '';
  let pieces = '';
  const material = [0,0,0,0,0, 0,0,0,0,0]; // P N B R Q p n b r q
  let wk = -1, bk = -1;
  const idxOf = { p:0, n:1, b:2, r:3, q:4 };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = b[r][c];
      if (!sq) { pawns += '.'; pieces += '.'; continue; }
      const pc = sq.color === 'w' ? sq.type.toUpperCase() : sq.type;
      pieces += pc;
      if (sq.type === 'p') { pawns += pc; }
      else { pawns += '.'; }
      if (sq.type === 'k') {
        if (sq.color === 'w') wk = r * 8 + c; else bk = r * 8 + c;
      } else {
        const off = sq.color === 'w' ? 0 : 5;
        material[idxOf[sq.type] + off]++;
      }
    }
  }
  return {
    pawns, pieces, material, wk, bk,
    stm: chess.turn(),
    roles: computePawnRoles(b),
    activity: computeActivity(chess),
  };
}

// Piece-activity footprint per side. Counts legal-move targets landing
// on strategic zones: the central 2×2 block, the enemy kingside pawn
// cover, and the enemy queenside pawn cover. Also tracks total non-
// pawn mobility. Two positions with identical pawn structure but
// different piece coordination will diverge in this vector — captures
// coordination that square-by-square hamming misses.
const CENTRAL_ZONE = new Set(['d4','d5','e4','e5']);
const KINGSIDE_B   = new Set(['f6','g6','h6','f7','g7','h7']);
const KINGSIDE_W   = new Set(['f3','g3','h3','f2','g2','h2']);
const QSIDE_B      = new Set(['a6','b6','c6','a7','b7','c7']);
const QSIDE_W      = new Set(['a3','b3','c3','a2','b2','c2']);

function countInZone(moves, zone) {
  let n = 0;
  for (const m of moves) if (zone.has(m.to)) n++;
  return n;
}

function computeActivity(chess) {
  const out = { w: { mobility: 0, central: 0, ksAttack: 0, qsAttack: 0 },
                b: { mobility: 0, central: 0, ksAttack: 0, qsAttack: 0 } };
  for (const side of ['w', 'b']) {
    const probe = new Chess(chess.fen());
    if (probe.turn() !== side) {
      const fp = probe.fen().split(' ');
      fp[1] = side; fp[3] = '-'; fp[5] = '1';
      try { probe.load(fp.join(' ')); } catch (_) { continue; }
    }
    const moves = probe.moves({ verbose: true });
    // Only non-pawn piece moves for the mobility + zone counters; pawn
    // advances already drove the pawn metric.
    const pieceMoves = moves.filter(m => m.piece && m.piece !== 'p');
    out[side].mobility = pieceMoves.length;
    out[side].central  = countInZone(pieceMoves, CENTRAL_ZONE);
    out[side].ksAttack = countInZone(pieceMoves, side === 'w' ? KINGSIDE_B : KINGSIDE_W);
    out[side].qsAttack = countInZone(pieceMoves, side === 'w' ? QSIDE_B    : QSIDE_W);
  }
  return out;
}

const ACTIVITY_KEYS = ['central','ksAttack','qsAttack','mobility'];
function activityDistance(a, b) {
  if (!a || !b || !a.w || !b.w) return 0;
  let d = 0;
  for (const k of ACTIVITY_KEYS) {
    // Mobility has much larger magnitude than zone counts, so dampen
    // it with /4 to keep the vector balanced.
    const divisor = k === 'mobility' ? 4 : 1;
    d += Math.abs(((a.w[k] || 0) - (b.w[k] || 0))) / divisor;
    d += Math.abs(((a.b[k] || 0) - (b.b[k] || 0))) / divisor;
  }
  return d;
}

// Classify each pawn by strategic role so two positions with the same
// "functional" pawn picture (say, both having an IQP + one passed pawn
// + two isolated pawns) match even when the raw squares differ. This
// captures strategic similarity that square-by-square hamming misses.
function computePawnRoles(board) {
  const pawns = { w: [], b: [] };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (sq && sq.type === 'p') pawns[sq.color].push({ r, c });
    }
  }
  const rolesFor = (side) => {
    const mine = pawns[side];
    const opp  = pawns[side === 'w' ? 'b' : 'w'];
    const perFile = new Array(8).fill(0);
    for (const p of mine) perFile[p.c]++;
    let passed = 0, isolated = 0, doubled = 0, backward = 0, chained = 0, advanced = 0;
    for (const p of mine) {
      // Advanced: for White rank <= 3 (5th rank or higher), mirror for Black
      if ((side === 'w' && p.r <= 3) || (side === 'b' && p.r >= 4)) advanced++;
      if (perFile[p.c] > 1) doubled++;
      const hasNeighbor = (p.c > 0 && perFile[p.c - 1] > 0) || (p.c < 7 && perFile[p.c + 1] > 0);
      if (!hasNeighbor) isolated++;
      // Passed: no enemy pawns on same or adjacent files ahead
      const isAhead = side === 'w' ? (op) => op.r < p.r : (op) => op.r > p.r;
      const blocked = opp.some(op => isAhead(op) && Math.abs(op.c - p.c) <= 1);
      if (!blocked) passed++;
      // Chained: supported diagonally by a friendly pawn one rank behind
      const supportedBy = mine.some(mp => {
        if (mp === p) return false;
        const dc = Math.abs(mp.c - p.c);
        const dr = side === 'w' ? (mp.r - p.r) : (p.r - mp.r);
        return dc === 1 && dr === 1;
      });
      if (supportedBy) chained++;
      // Backward: unsupported AND sits behind its neighbour file's pawn
      if (!supportedBy) {
        const neighborRanks = mine
          .filter(m => Math.abs(m.c - p.c) === 1)
          .map(m => m.r);
        if (neighborRanks.length) {
          if (side === 'w' && p.r > Math.min(...neighborRanks)) backward++;
          if (side === 'b' && p.r < Math.max(...neighborRanks)) backward++;
        }
      }
    }
    return { passed, isolated, doubled, backward, chained, advanced, total: mine.length };
  };
  return { w: rolesFor('w'), b: rolesFor('b') };
}

const ROLE_KEYS = ['passed','isolated','doubled','backward','chained','advanced'];
function roleDistance(a, b) {
  if (!a || !b || !a.w || !b.w) return 0;
  let d = 0;
  for (const k of ROLE_KEYS) {
    d += Math.abs((a.w[k] || 0) - (b.w[k] || 0));
    d += Math.abs((a.b[k] || 0) - (b.b[k] || 0));
  }
  return d;
}

for (const entry of BOOK_RAW) {
  // Skip structural-signature computation for Lichess entries — they
  // rely entirely on SAN-prefix matching (which is free at runtime).
  // Computing signatures for 3,690 entries would add ~0.5s to module
  // init on a mid-range machine for no practical gain.
  if (entry._source === 'lichess') continue;
  try {
    const c = new Chess();
    let ok = true;
    for (const san of entry.moves) {
      const res = c.move(san, { sloppy: true });
      if (!res) { ok = false; break; }
    }
    if (ok) {
      entry._sig = boardToPlacement(c);
      entry._fen = c.fen();
    }
  } catch (_) { /* skip entries whose moves fail to replay */ }
}

export const OPENINGS_BOOK = BOOK_RAW;

// ─── Similarity distance ─────────────────────────────────────────────
// Lower = more similar. Exact identity = 0. Totally unrelated ~80+.

function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
function chebyshev(a, b) {
  if (a < 0 || b < 0) return 0;
  const dr = Math.abs((a >> 3) - (b >> 3));
  const dc = Math.abs((a & 7) - (b & 7));
  return Math.max(dr, dc);
}
// Per-file pawn weight: central pawns (c–f) define strategic themes far
// more than rook/knight pawns, so weight central pawn mismatches more.
const PAWN_FILE_WEIGHT = [1, 1, 2, 2, 2, 2, 1, 1]; // a b c d e f g h

function weightedPawnDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) d += PAWN_FILE_WEIGHT[i & 7];
  }
  return d;
}

function signatureDistance(sigA, sigB) {
  if (!sigA || !sigB) return Infinity;
  // Pawn skeleton — file-weighted hamming. Central pawns dominate.
  const pawnDist = weightedPawnDistance(sigA.pawns, sigB.pawns);
  // Piece placement — plain hamming. Pieces move around through a game
  // so this is a looser signal than pawns.
  const pieceDist = hamming(sigA.pieces, sigB.pieces);
  // Material — compare only the *shape* of the material balance, not
  // raw count. Dividing by 2 halves the penalty from a couple of piece
  // trades at different depths of the game.
  let matDiff = 0;
  for (let i = 0; i < sigA.material.length; i++) {
    matDiff += Math.abs(sigA.material[i] - sigB.material[i]);
  }
  matDiff = matDiff / 2;
  const kingDist = chebyshev(sigA.wk, sigB.wk) + chebyshev(sigA.bk, sigB.bk);
  // STM mismatch is a real strategic difference (whose move it is
  // changes initiative calc) but not worth 4 full distance units.
  const stmPenalty = sigA.stm !== sigB.stm ? 2 : 0;
  // Functional pawn role distance — counts mismatches in passed /
  // isolated / doubled / backward / chained / advanced pawns per side.
  // Captures strategic similarity that raw-square hamming misses (an
  // IQP is still an IQP whether the isolated pawn is on d5 or e5).
  const roleDist = roleDistance(sigA.roles, sigB.roles);
  // Piece-activity distance — central control, enemy-wing pressure,
  // total non-pawn mobility per side. Two positions with the same pawn
  // skeleton but very different piece coordination diverge here.
  const actDist = activityDistance(sigA.activity, sigB.activity);
  // Weights: pawn structure DOMINATES (×4 via the file-weighting above
  // peaks at 2×16=32), piece placement moderate (×1), material-shape
  // dampened (×1 after the /2 above), king placement light (×0.5),
  // pawn-role structural similarity (×1.5), piece activity light
  // (×0.6 — a hint, not a dominant signal since piece placement is
  // already counted via pieceDist).
  return pawnDist * 3 + pieceDist * 1 + matDiff * 1 + kingDist * 0.5
       + stmPenalty + roleDist * 1.5 + actDist * 0.6;
}

// Looser threshold — ~32 instead of ~22 catches genuine transpositions
// like "Maroczy via English" that used to return null. The tightened
// metric above (file-weighted pawns, halved material, softer stm) keeps
// spurious matches from leaking in despite the looser cap.
const STRUCTURAL_THRESHOLD = 32;
// Minimum ply count before structural fallback is allowed. Before this,
// positions are too close to the starting array for similarity to be
// meaningful — let the SAN-prefix matcher (and its null result) handle
// the opening phase.
const STRUCTURAL_MIN_PLIES = 6;
// Prefix matches of this depth or greater are trusted over a structural
// match. Below this depth the prefix is "greedy-shallow" — a 1-ply
// entry like the Zukertort would otherwise lock the book in forever
// after 1.Nf3, hiding deeper structural insights. With this gate we
// still run structural matching on shallow prefix hits and prefer the
// one that finds a more specific entry.
const PREFIX_TRUST_DEPTH = 4;

/**
 * Compute a signature from an arbitrary FEN. Used by the structural
 * matcher to look up the nearest book entry.
 */
export function fenSignature(fen) {
  try {
    const c = new Chess(fen);
    return boardToPlacement(c);
  } catch (_) {
    return null;
  }
}

// Vertically flip + colour-swap a signature. Used so that e.g. an
// IQP-for-Black position can match an IQP-for-White book entry — same
// strategic archetype, colours reversed.
function mirrorSignature(sig) {
  if (!sig) return null;
  const flipRows = (s) => {
    const rows = [];
    for (let r = 0; r < 8; r++) rows.push(s.slice(r * 8, (r + 1) * 8));
    return rows.reverse().join('');
  };
  const swapCase = (s) => s.replace(/[A-Za-z]/g,
    c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase());
  const flipRank = (idx) => (idx < 0 ? -1 : ((7 - (idx >> 3)) << 3) | (idx & 7));
  return {
    pawns: swapCase(flipRows(sig.pawns)),
    pieces: swapCase(flipRows(sig.pieces)),
    // Material swap: Black pieces become White pieces and vice versa.
    material: [sig.material[5], sig.material[6], sig.material[7], sig.material[8], sig.material[9],
               sig.material[0], sig.material[1], sig.material[2], sig.material[3], sig.material[4]],
    // After colour-swap, what was the black king is now a white king
    // (at its flipped square) and vice versa.
    wk: flipRank(sig.bk),
    bk: flipRank(sig.wk),
    stm: sig.stm === 'w' ? 'b' : 'w',
    // Pawn roles flip: what was Black's role-vector becomes White's.
    roles: sig.roles ? { w: sig.roles.b, b: sig.roles.w } : null,
    // Piece activity flips too: Black's attacking zones swap with
    // White's (mobility numbers invert sides).
    activity: sig.activity ? { w: sig.activity.b, b: sig.activity.w } : null,
  };
}

/**
 * Find the most-specific opening entry whose moves are a prefix of the
 * played SAN history. If no prefix matches and a FEN is supplied, fall
 * back to nearest-neighbour structural matching. Returns null if
 * neither matcher finds a sufficiently close entry.
 *
 * @param {string[]} sanHistory - array of SAN moves played so far
 * @param {string} [fen] - current FEN for structural fallback
 * @returns {object|null} the matching entry (with `_matched` field)
 */
export function detectOpening(sanHistory, fen) {
  // 1) Longest SAN-prefix match (OPENINGS_BOOK is sorted longest-first).
  let prefixHit = null;
  if (sanHistory && sanHistory.length) {
    for (const entry of OPENINGS_BOOK) {
      if (entry._len > sanHistory.length) continue;
      let ok = true;
      for (let i = 0; i < entry._len; i++) {
        if (entry.moves[i] !== sanHistory[i]) { ok = false; break; }
      }
      if (ok) { prefixHit = entry; break; }
    }
  }
  // Trust a prefix hit outright only when it's deep enough to be
  // strategically meaningful. A 1-ply hit like "Nf3 → Zukertort" gets
  // run past the structural matcher first and is preferred only if
  // structural can't do better.
  if (prefixHit && prefixHit._len >= PREFIX_TRUST_DEPTH) {
    return { ...prefixHit, _matched: 'exact', _distance: 0 };
  }

  // 2) FEN-based structural match. Runs whenever ≥6 plies have been
  //    played. Tries both the current signature and its colour-mirror
  //    against each book entry so colour-reversed archetypes (e.g., an
  //    IQP-for-Black reaching a position that matches an IQP-for-White
  //    book entry with colours flipped) still find a home. If a shallow
  //    prefix also hit, we compare: keep the structural if it points at
  //    a deeper book entry than the shallow prefix.
  let structuralHit = null;
  if (fen && sanHistory && sanHistory.length >= STRUCTURAL_MIN_PLIES) {
    const sig = fenSignature(fen);
    const mirror = mirrorSignature(sig);
    if (sig) {
      let best = null, bestDist = Infinity, bestMirrored = false;
      for (const entry of OPENINGS_BOOK) {
        if (!entry._sig || entry._len < STRUCTURAL_MIN_PLIES) continue;
        const dNormal = signatureDistance(sig, entry._sig);
        // Mirror distance gets a small +1 penalty: we prefer a same-
        // colour match of equal quality, since reversed archetypes need
        // the user to flip the plan mentally.
        const dMirror = mirror ? signatureDistance(mirror, entry._sig) + 1 : Infinity;
        const useMirror = dMirror < dNormal;
        const d = useMirror ? dMirror : dNormal;
        if (d < bestDist) { bestDist = d; best = entry; bestMirrored = useMirror; }
      }
      if (best && bestDist <= STRUCTURAL_THRESHOLD) {
        structuralHit = {
          ...best,
          _matched: bestMirrored ? 'structural-mirrored' : 'structural',
          _distance: Math.round(bestDist),
          _mirrored: bestMirrored,
        };
      }
    }
  }

  // 3) Choose between shallow prefix and structural. Prefer the one
  //    that matched a deeper (more specific) book entry. Ties go to
  //    structural since the FEN is richer evidence than a 1-2 ply
  //    opening move.
  if (prefixHit && structuralHit) {
    return structuralHit._len > prefixHit._len ? structuralHit
         : { ...prefixHit, _matched: 'exact', _distance: 0 };
  }
  if (structuralHit) return structuralHit;
  if (prefixHit)    return { ...prefixHit, _matched: 'exact', _distance: 0 };
  return null;
}

/**
 * Build an HTML block summarising the detected opening for the Coach
 * panel. Safe for innerHTML — all content is original paraphrase.
 */
export function renderOpeningBlock(entry) {
  if (!entry) return '';
  const plans = (side, items) => (items || []).map(i => `<li>${escapeHtml(i)}</li>`).join('');
  const structural = entry._matched === 'structural' || entry._matched === 'structural-mirrored';
  const mirrored = entry._matched === 'structural-mirrored';
  const label = structural ? (mirrored ? '📖 Similar to (colours reversed)' : '📖 Similar to') : '📖 Opening —';
  const suffix = structural
    ? ` <span class="muted" style="font-weight: normal; font-size: 10px;">(structural match${mirrored ? ', colour-mirrored' : ''}, d=${entry._distance})</span>`
    : '';
  // Lichess-sourced entries: just name + ECO, no plan block (we have
  // no hand-written coach data for these specific sub-variations).
  if (entry._source === 'lichess') {
    return `
      <div class="coach-opening">
        <h5 class="coach-section-h">${label} ${escapeHtml(entry.name)}
          <span class="muted" style="font-weight: normal; margin-left: 6px; font-size: 10px;">${escapeHtml(entry.eco || '')}</span>
          <span class="muted" style="font-weight: normal; margin-left: 6px; font-size: 10px; color: #7aa7ff;">Lichess DB</span>
        </h5>
        <p class="muted" style="font-size: 12px; margin: 4px 0 8px;">Named sub-variation from the Lichess openings database. No hand-written plan for this specific line — derive from engine lines + the Positional Coach synthesis below.</p>
      </div>
    `;
  }
  return `
    <div class="coach-opening">
      <h5 class="coach-section-h">${label} ${escapeHtml(entry.name)}
        <span class="muted" style="font-weight: normal; margin-left: 6px; font-size: 10px;">${escapeHtml(entry.eco || '')}</span>${suffix}
      </h5>
      <p class="muted" style="font-size: 12px; margin: 4px 0 8px;">${escapeHtml(entry.structure || '')}</p>
      <div class="coach-opening-grid">
        <div>
          <strong>White plans</strong>
          <ul class="coach-plans">${plans('w', entry.whitePlans)}</ul>
        </div>
        <div>
          <strong>Black plans</strong>
          <ul class="coach-plans">${plans('b', entry.blackPlans)}</ul>
        </div>
      </div>
      ${entry.pitfalls && entry.pitfalls.length
        ? `<div style="margin-top: 6px;"><strong>⚠ Watch out:</strong> <span style="font-size: 12px;">${entry.pitfalls.map(p => escapeHtml(p)).join(' · ')}</span></div>`
        : ''}
      ${entry.motifs && entry.motifs.length
        ? `<div style="margin-top: 4px;"><strong>Motifs:</strong> <span style="font-size: 12px;">${entry.motifs.map(m => escapeHtml(m)).join(' · ')}</span></div>`
        : ''}
    </div>
  `;
}

/** Build a compact text block for the AI prompt. */
export function renderOpeningForAI(entry) {
  if (!entry) return '';
  const bullets = (items) => (items || []).map(i => `  - ${i}`).join('\n');
  const isStruct = entry._matched === 'structural' || entry._matched === 'structural-mirrored';
  const isMirror = entry._matched === 'structural-mirrored';
  const header = isStruct
    ? `DETECTED OPENING (structural similarity${isMirror ? ', colour-reversed' : ''}, distance ${entry._distance})\nReached by transposition — treat as: ${entry.name} (${entry.eco || '?'})${isMirror ? '\nNote: the plans below apply with colours reversed — swap "White" and "Black" when reading them.' : ''}`
    : `DETECTED OPENING\nName: ${entry.name} (${entry.eco || '?'})`;
  // Lichess-sourced entries don't have hand-written plans/motifs.
  // In that case we just emit the name + a hint that the concrete
  // plan should be derived from the current engine lines.
  if (entry._source === 'lichess') {
    return `\n${header}\n(Identified from the Lichess opening database — 3,690+ named lines. No hand-written coach notes for this specific sub-variation; derive the plan from the engine top-5 and the Positional Coach block below.)\n`;
  }
  return `
${header}
Structure: ${entry.structure || ''}
White plans:
${bullets(entry.whitePlans)}
Black plans:
${bullets(entry.blackPlans)}
${entry.pitfalls?.length ? 'Pitfalls:\n' + bullets(entry.pitfalls) : ''}
${entry.motifs?.length ? 'Motifs:\n' + bullets(entry.motifs) : ''}
`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}
