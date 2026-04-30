// ══════════════════════════════════════════════
//  GAME DATA
//  Edit this file to add, remove, or change words.
//  Each entry needs: word, scrambled, difficulty, hint
//  difficulty must be: 'easy' | 'medium' | 'hard'
// ══════════════════════════════════════════════

const WORDS = [
  // Easy — 5 words
  { word: 'LOOP',      scrambled: 'OPLO',     difficulty: 'easy',   hint: 'Repeats a block of code multiple times' },
  { word: 'CODE',      scrambled: 'EDOC',     difficulty: 'easy',   hint: 'Instructions written for a computer' },
  { word: 'BUG',       scrambled: 'GUB',      difficulty: 'easy',   hint: 'An error that causes unexpected behavior' },
  { word: 'ARRAY',     scrambled: 'RAYAR',    difficulty: 'easy',   hint: 'A collection of elements at indexed positions' },
  { word: 'CLASS',     scrambled: 'SALSC',    difficulty: 'easy',   hint: 'A blueprint for creating objects in OOP' },

  // Medium — 5 words
  { word: 'FUNCTION',  scrambled: 'NOFUNTCI', difficulty: 'medium', hint: 'A named, reusable block of code' },
  { word: 'VARIABLE',  scrambled: 'LABRVIAE', difficulty: 'medium', hint: 'A named container for storing data values' },
  { word: 'BOOLEAN',   scrambled: 'OLOBANE',  difficulty: 'medium', hint: 'A type that holds only true or false' },
  { word: 'POINTER',   scrambled: 'TERNOPI',  difficulty: 'medium', hint: 'Holds the memory address of another variable' },
  { word: 'COMPILE',   scrambled: 'OLICMPE',  difficulty: 'medium', hint: 'Translates source code into machine code' },

  // Hard — 5 words
  { word: 'RECURSION',    scrambled: 'INOCRUSER',    difficulty: 'hard', hint: 'When a function calls itself' },
  { word: 'ALGORITHM',    scrambled: 'MORLGITHA',    difficulty: 'hard', hint: 'A step-by-step procedure to solve a problem' },
  { word: 'POLYMORPHISM', scrambled: 'HISMORPLYOMP', difficulty: 'hard', hint: 'One interface, many implementations in OOP' },
  { word: 'INHERITANCE',  scrambled: 'CERINNTHEIA',  difficulty: 'hard', hint: 'A child class acquires properties from a parent' },
  { word: 'ABSTRACTION',  scrambled: 'RICTOBSNATA',  difficulty: 'hard', hint: 'Hiding complexity, exposing only essentials' },
];

// Points awarded per difficulty, and seconds on the timer
const DIFF_CFG = {
  easy:   { time: 20, points: 10 },
  medium: { time: 30, points: 20 },
  hard:   { time: 40, points: 30 },
};

// Seconds to show the results screen between words
const RESULTS_PAUSE = 4;
