'use strict';
// Bumble, hum's bumblebee. Bees hum while they work, which is the idea.
// Every letter is one pixel; '.' is see-through.

const BIG = [
  '..........................',
  '.........ww....ww.........',
  '........wWWw..wWWw........',
  '........wWWWwwWWWw........',
  '.........wWWWWWWw.....a...',
  '..........wwKwww.....a....',
  '.......YYYYKKYYYKKk.a.....',
  '.....YYYYYYKKYYYKKKkkk....',
  '....yYYYYYYKKYYYKKKkkEk...',
  '...KyYYYYYYKKYYYKKKkkkk...',
  '....yYYYYYYKKYYYKKKkkkk...',
  '.....yyYYYYKKYYYKKKkkk....',
  '.......yyyyKKyyyKKk.......',
  '..........l..l..l.........',
  '.........l..l..l..........',
  '..........................',
  '..........................',
];

const MINI = [
  '............',
  '...ww.ww....',
  '...wWwWw..a.',
  '..YYKYYKkka.',
  '.yYYKYYKkEk.',
  'KyYYKYYKkkk.',
  '..yyKyyKkk..',
  '....l.l.....',
  '............',
];

const INK = { Y: '#f5c431', y: '#d99e17', K: '#2b2520', k: '#3d342c', E: '#ffffff', W: '#eef6fc', w: '#a9c7df', a: '#2b2520', l: '#2b2520' };
// on dark backgrounds the black stripes are lifted a little, so Bumble doesn't lose them
const INK_NIGHT = { ...INK, K: '#4a4038', k: '#5c5046', a: '#6e6153', l: '#6e6153' };

module.exports = { BIG, MINI, INK, INK_NIGHT, NAME: 'Bumble' };
