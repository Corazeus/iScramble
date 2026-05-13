// ══════════════════════════════════════════════
//  FIREBASE CONFIG
//  Paste your Firebase project values here.
// ══════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyDshwv5XbkGUXGavZQURP6AOHWY2-qGI8A",
  authDomain: "iscramble-c5c03.firebaseapp.com",
  databaseURL: "https://iscramble-c5c03-default-rtdb.firebaseio.com",
  projectId: "iscramble-c5c03",
  storageBucket: "iscramble-c5c03.firebasestorage.app",
  messagingSenderId: "481294458586",
  appId: "1:481294458586:web:3b5507d586e8811c024fe3",
  measurementId: "G-BFG4D09MFZ"
};

// ══════════════════════════════════════════════
//  AI PROXY CONFIG
//  Used for AI word generation.
// ══════════════════════════════════════════════
const AI_PROXY_URL = "https://iscramble-proxy.ruizrenzeus.workers.dev";

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ══════════════════════════════════════════════
//  PLAYER IDENTITY
// ══════════════════════════════════════════════
let myId   = sessionStorage.getItem('csg_pid') || Math.random().toString(36).slice(2, 10);
let myName = '';
sessionStorage.setItem('csg_pid', myId);

// ══════════════════════════════════════════════
//  ROOM STATE
// ══════════════════════════════════════════════
let roomCode   = '';
let roomRef    = null;
let isHost     = false;
let activeWords = [];   // the word list in play (set before game starts)

// ══════════════════════════════════════════════
//  CUSTOM WORD STATE
// ══════════════════════════════════════════════
let customWords  = [];  // words added by host on custom screen
let aiWords      = [];  // words returned by AI (before confirmed)

// ══════════════════════════════════════════════
//  GAME STATE (reset each round)
// ══════════════════════════════════════════════
let timerLoop          = null;
let countdownInterval  = null;
let advanceTimeout     = null;
let localAnswered      = false;
let localHintUsed      = false;
let localAttempts      = 0;    // wrong attempt counter — ends turn at MAX_ATTEMPTS
let lastWordIndex      = -1;
let advanceScheduled   = false;
let lastResultsAt      = 0;

const MAX_ATTEMPTS     = 3;

// ══════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** Fisher-Yates shuffle — guarantees result differs from input */
function scrambleWord(word) {
  const arr = word.toUpperCase().split('');
  if (arr.length === 1) return word;
  let result;
  let attempts = 0;
  do {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    result = arr.join('');
    attempts++;
  } while (result === word.toUpperCase() && attempts < 20);
  return result;
}

// ══════════════════════════════════════════════
//  SETUP SCREEN
// ══════════════════════════════════════════════

function handleCreate() {
  const name = document.getElementById('name-input').value.trim();
  if (!name) { setError('Please enter your name.'); return; }
  myName   = name;
  roomCode = Math.random().toString(36).slice(2, 6).toUpperCase();
  isHost   = true;
  // Host picks word mode before entering the room
  showScreen('screen-wordmode');
}

function handleJoin() {
  const name = document.getElementById('name-input').value.trim();
  const code = document.getElementById('code-input').value.trim().toUpperCase();
  if (!name)             { setError('Please enter your name.'); return; }
  if (code.length !== 4) { setError('Enter a valid 4-letter room code.'); return; }
  myName   = name;
  roomCode = code;
  isHost   = false;
  enterRoom([]);  // joiners don't pick words
}

function setError(msg) {
  document.getElementById('setup-error').textContent = msg;
}

// ══════════════════════════════════════════════
//  WORD MODE SCREEN
// ══════════════════════════════════════════════

function selectDefault() {
  enterRoom(WORDS, 'default');
}

function selectCustom() {
  customWords = [];
  renderCustomList();
  showScreen('screen-custom');
}

function selectAI() {
  document.getElementById('ai-preview').style.display  = 'none';
  document.getElementById('ai-loading').style.display  = 'none';
  document.getElementById('ai-error').textContent      = '';
  document.getElementById('ai-topic-input').value      = '';
  showScreen('screen-ai');
}

// ══════════════════════════════════════════════
//  CUSTOM WORDS SCREEN
// ══════════════════════════════════════════════

function addCustomWord() {
  const wordInput = document.getElementById('custom-word-input');
  const hintInput = document.getElementById('custom-hint-input');
  const diff      = document.getElementById('custom-diff-input').value;
  const word      = wordInput.value.trim().toUpperCase().replace(/\s+/g, '');
  const hint      = hintInput.value.trim();
  const errorEl   = document.getElementById('custom-error');

  if (!word)              { errorEl.textContent = 'Please enter a word.'; return; }
  if (word.length < 2)    { errorEl.textContent = 'Word must be at least 2 letters.'; return; }
  if (!hint)              { errorEl.textContent = 'Please enter a hint.'; return; }
  if (customWords.some(w => w.word === word)) {
    errorEl.textContent = 'That word is already added.'; return;
  }

  errorEl.textContent = '';
  customWords.push({ word, scrambled: scrambleWord(word), difficulty: diff, hint });
  wordInput.value = '';
  hintInput.value = '';
  wordInput.focus();
  renderCustomList();
}

function removeCustomWord(index) {
  customWords.splice(index, 1);
  renderCustomList();
}

function renderCustomList() {
  const count = customWords.length;
  document.getElementById('custom-word-count').textContent = `${count} added`;
  document.getElementById('custom-start-btn').disabled = count < 3;

  const container = document.getElementById('custom-word-list');
  if (count === 0) { container.innerHTML = ''; return; }

  container.innerHTML = customWords.map((w, i) => `
    <div class="custom-word-item">
      <span class="cw-word">${esc(w.word)}</span>
      <span class="badge ${w.difficulty}">${w.difficulty}</span>
      <span class="cw-hint">${esc(w.hint)}</span>
      <button class="cw-remove" onclick="removeCustomWord(${i})" title="Remove">✕</button>
    </div>
  `).join('');
}

function submitCustomWords() {
  if (customWords.length < 3) return;
  enterRoom(customWords, 'custom');
}

// ══════════════════════════════════════════════
//  AI GENERATION SCREEN
// ══════════════════════════════════════════════

async function generateAIWords() {
  const topic = document.getElementById('ai-topic-input').value.trim();
  const mix   = document.getElementById('ai-mix-input').value;

  if (!topic) {
    document.getElementById('ai-error').textContent = 'Please enter a topic first.';
    return;
  }

  const mixMap = {
    'balanced':   { easy: 5, medium: 5, hard: 5 },
    'easy-heavy': { easy: 8, medium: 4, hard: 3 },
    'hard-heavy': { easy: 3, medium: 4, hard: 8 },
  };
  const counts = mixMap[mix];
  const total  = counts.easy + counts.medium + counts.hard;

  document.getElementById('ai-error').textContent      = '';
  document.getElementById('ai-preview').style.display  = 'none';
  document.getElementById('ai-loading').style.display  = 'block';
  document.getElementById('ai-generate-btn').disabled  = true;

  const prompt = `Generate exactly ${total} scrambled words related to this variable: topic = "${topic}".
  Return ONLY a valid JSON array with no markdown, no explanation, no code fences.
  If topic is not specific enough or not indicated properly, generate general words that could fit many topics.
  Each item must have these exact fields: 
  - "word": the answer in UPPERCASE, single word, no spaces or hyphens
  - "scrambled": the same letters in a DIFFERENT order (must not equal "word")
  - "difficulty": use "easy", "medium", "hard", the word with most letters should always be on the higher difficulty, adjust the number of letters per difficulty as you see fit for the topic.
  - "hint": a short one-sentence definition or clue
  Generate exactly ${counts.easy} easy words, ${counts.medium} medium words, and ${counts.hard} hard words.
  Example format (do not copy these, generate new ones about ${topic}):
  [{"word":"CAT","scrambled":"TAC","difficulty":"easy","hint":"A small domesticated animal"},{"word":"EVIL","scrambled":"VLEI","difficulty":"medium","hint":"A morally wrong action"},{"word":"LIVER","scrambled":"VLEIR","difficulty":"hard","hint":"An organ that detoxifies chemicals and metabolizes drugs"}]`;

  try {
    const response = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `Gemini API error ${response.status}`);
    }

    const data  = await response.json();
    const text  = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Unexpected response format.');

    // Validate and fix scrambles if needed
    aiWords = parsed.map(w => ({
      word:       String(w.word).toUpperCase().trim(),
      scrambled:  String(w.scrambled).toUpperCase().trim() !== String(w.word).toUpperCase().trim()
                    ? String(w.scrambled).toUpperCase().trim()
                    : scrambleWord(String(w.word)),
      difficulty: ['easy', 'medium', 'hard'].includes(w.difficulty) ? w.difficulty : 'medium',
      hint:       String(w.hint).trim(),
      topic:      topic,
    }));

    renderAIPreview();
    document.getElementById('ai-preview').style.display = 'block';

  } catch (err) {
    document.getElementById('ai-error').textContent = `Error: ${err.message}`;
  } finally {
    document.getElementById('ai-loading').style.display  = 'none';
    document.getElementById('ai-generate-btn').disabled  = false;
  }
}

function renderAIPreview() {
  document.getElementById('ai-word-chips').innerHTML = aiWords.map((w, i) => `
    <span class="word-chip">
      ${esc(w.word)}
      <span class="chip-diff ${w.difficulty}">${w.difficulty}</span>
      <button class="chip-remove" onclick="removeAIWord(${i})" title="Remove">✕</button>
    </span>
  `).join('');
}

function removeAIWord(index) {
  aiWords.splice(index, 1);
  renderAIPreview();
}

function submitAIWords() {
  if (aiWords.length === 0) return;
  enterRoom(aiWords, 'ai');
}

// ══════════════════════════════════════════════
//  ENTER ROOM (shared by all paths)
// ══════════════════════════════════════════════

async function enterRoom(words, mode = 'default') {
  roomRef = db.ref('rooms/' + roomCode);
  const snap = await roomRef.once('value');
  const room = snap.val();

  if (!isHost && !room) { setError('Room not found. Double-check the code.'); return; }
  if (room && room.status !== 'lobby') { setError('Game already started in this room.'); return; }

  const playerRef = roomRef.child('players/' + myId);
  await playerRef.set({ name: myName, score: 0, answered: false, correct: false, answeredAt: 0 });
  playerRef.onDisconnect().remove();

  if (isHost) {
    activeWords = words;
    const modeLabelMap = {
      default: 'Built-in coding words',
      custom:  `${words.length} custom words`,
      ai:      `AI-generated: ${document.getElementById('ai-topic-input')?.value?.trim() || 'custom topic'}`,
    };
    await roomRef.update({
      host:             myId,
      status:           'lobby',
      currentWord:      0,
      wordStartedAt:    0,
      resultsStartedAt: 0,
      wordMode:         mode,
      modeLabel:        modeLabelMap[mode] || '',
      words:            words,   // store words in Firebase so all clients get the same set
    });
    roomRef.onDisconnect().remove();
  }

  // Update lobby UI
  document.getElementById('lobby-code').textContent = roomCode;
  if (isHost) {
    document.getElementById('start-btn').style.display   = 'block';
    document.getElementById('waiting-msg').style.display = 'none';

    const badgeEl = document.getElementById('lobby-mode-badge');
    const labelEl = document.getElementById('lobby-mode-label');
    if (mode === 'default') {
      badgeEl.className = 'badge easy'; badgeEl.textContent = 'Default';
      labelEl.textContent = 'Built-in coding words';
    } else if (mode === 'custom') {
      badgeEl.className = 'badge medium'; badgeEl.textContent = 'Custom';
      labelEl.textContent = `${words.length} custom words`;
    } else if (mode === 'ai') {
      badgeEl.className = 'badge hard'; badgeEl.textContent = 'AI';
      labelEl.textContent = `Topic: ${document.getElementById('ai-topic-input')?.value?.trim() || ''}`;
    }
  }
  showScreen('screen-lobby');

  // Listen for room changes
  roomRef.on('value', snap => {
    const room = snap.val();
    if (!room) { alert('Room was closed by the host.'); showScreen('screen-setup'); return; }
    if (room.status === 'lobby')    handleLobby(room);
    if (room.status === 'playing')  handlePlaying(room);
    if (room.status === 'results')  handleResults(room);
    if (room.status === 'finished') handleFinished(room);
  });
}

// ══════════════════════════════════════════════
//  LOBBY
// ══════════════════════════════════════════════

function handleLobby(room) {
  const players = room.players || {};

  // Non-host: show word mode badge from room data
  if (!isHost) {
    const badgeEl = document.getElementById('lobby-mode-badge');
    const labelEl = document.getElementById('lobby-mode-label');
    const mode    = room.wordMode || 'default';
    if (mode === 'default') {
      badgeEl.className = 'badge easy'; badgeEl.textContent = 'Default';
    } else if (mode === 'custom') {
      badgeEl.className = 'badge medium'; badgeEl.textContent = 'Custom';
    } else if (mode === 'ai') {
      badgeEl.className = 'badge hard'; badgeEl.textContent = 'AI';
    }
    labelEl.textContent = room.modeLabel || '';
  }

  document.getElementById('lobby-players').innerHTML =
    Object.entries(players).map(([id, p]) => `
      <li>
        <div class="dot"></div>
        <span>${esc(p.name)}</span>
        ${id === room.host ? '<span class="host-tag">host</span>' : ''}
      </li>
    `).join('');
}

async function hostStartGame() {
  const snap = await roomRef.once('value');
  const room = snap.val();
  if (!room?.players) return;

  // Pull words from Firebase room (set when host created the room)
  activeWords = room.words ? Object.values(room.words) : WORDS;

  showScreen('screen-game');
  document.getElementById('word-total').textContent = activeWords.length;
  await roomRef.update({
    status:        'playing',
    currentWord:   0,
    wordStartedAt: firebase.database.ServerValue.TIMESTAMP,
  });
}

// ══════════════════════════════════════════════
//  GAME — PLAYING
// ══════════════════════════════════════════════

function handlePlaying(room) {
  if (!document.getElementById('screen-game').classList.contains('active')) {
    // Non-host: load words from room on first playing event
    if (!isHost && activeWords.length === 0 && room.words) {
      activeWords = Object.values(room.words);
      document.getElementById('word-total').textContent = activeWords.length;
    }
    showScreen('screen-game');
  }

  document.getElementById('results-phase').style.display = 'none';
  document.getElementById('word-card').style.display     = 'block';

  const idx = room.currentWord;
  const w   = activeWords[idx];
  if (!w) return;
  const cfg = DIFF_CFG[w.difficulty] || DIFF_CFG.medium;

  if (idx !== lastWordIndex) {
    lastWordIndex    = idx;
    localAnswered    = false;
    localHintUsed    = false;
    localAttempts    = 0;
    advanceScheduled = false;
    clearTimeout(advanceTimeout);

    renderWord(w);
    document.getElementById('word-prompt').textContent = w.topic ? `Unscramble the word based on the topic: \"${w.topic}\".` : 'Unscramble the word:';
    document.getElementById('hint-text').textContent   = '';  
    document.getElementById('result-text').textContent = '';
    document.getElementById('result-text').style.color = '';
    document.getElementById('answer-input').value      = '';
    document.getElementById('answer-input').disabled   = false;
    document.getElementById('input-row').style.display  = 'flex';
    document.getElementById('action-row').style.display = 'flex';
    document.getElementById('hint-btn').disabled        = false;
  }

  document.getElementById('word-num').textContent      = idx + 1;
  document.getElementById('word-total').textContent    = activeWords.length;
  document.getElementById('progress-fill').style.width = ((idx + 1) / activeWords.length * 100) + '%';

  clearInterval(timerLoop);
  timerLoop = setInterval(() => {
    const elapsed   = (Date.now() - room.wordStartedAt) / 1000;
    const remaining = Math.max(0, cfg.time - elapsed);
    const timerEl   = document.getElementById('timer-display');
    timerEl.textContent = Math.ceil(remaining);
    timerEl.style.color = remaining <= 5 ? '#993C1D' : remaining <= 10 ? '#854F0B' : '#1a1a18';

    if (remaining <= 0 && !localAnswered) {
      localAnswered = true;
      document.getElementById('result-text').style.color = '#854F0B';
      document.getElementById('result-text').textContent = `Time's up! Answer: ${w.word}`;
      document.getElementById('input-row').style.display  = 'none';
      document.getElementById('action-row').style.display = 'none';
    }

    if (remaining <= 0 && isHost && !advanceScheduled) {
      advanceScheduled = true;
      clearInterval(timerLoop);
      advanceTimeout = setTimeout(() => moveToResults(room), 1500);
    }
  }, 150);

  // Check if all players have answered — advance early
  const players    = room.players || {};
  const allAnswered = Object.values(players).length > 0
    && Object.values(players).every(p => p.answered);

  if (allAnswered && isHost && !advanceScheduled) {
    advanceScheduled = true;
    clearInterval(timerLoop);
    advanceTimeout = setTimeout(() => moveToResults(room), 800);
  }

  updateLeaderboard(players);
  const me = players[myId];
  if (me) document.getElementById('my-score').textContent = me.score;
}

function renderWord(w) {
  const badge = document.getElementById('diff-badge');
  badge.textContent = w.difficulty.charAt(0).toUpperCase() + w.difficulty.slice(1);
  badge.className   = 'badge ' + w.difficulty;

  const row = document.getElementById('scramble-row');
  row.innerHTML = '';
  w.scrambled.split('').forEach(letter => {
    const box = document.createElement('div');
    box.className   = 'letter-box';
    box.textContent = letter;
    row.appendChild(box);
  });

  setTimeout(() => document.getElementById('answer-input').focus(), 50);
}

function submitAnswer() {
  if (localAnswered) return;
  const input = document.getElementById('answer-input').value.trim().toUpperCase();
  if (!input) return;

  const idx     = lastWordIndex;
  const w       = activeWords[idx];
  const cfg     = DIFF_CFG[w.difficulty] || DIFF_CFG.medium;
  const correct = input === w.word;

  // ── CORRECT ──────────────────────────────────
  if (correct) {
    localAnswered = true;
    document.getElementById('input-row').style.display  = 'none';
    document.getElementById('action-row').style.display = 'none';

    roomRef.once('value', snap => {
      const room       = snap.val() || {};
      const me         = (room.players || {})[myId] || { score: 0 };
      const elapsed    = (Date.now() - room.wordStartedAt) / 1000;
      const timeLeft   = Math.max(0, cfg.time - elapsed);
      const speedBonus = Math.round((timeLeft / cfg.time) * 10);
      const newScore   = Math.max(0, me.score + cfg.points + speedBonus);

      roomRef.child('players/' + myId).update({
        score:      newScore,
        answered:   true,
        correct:    true,
        answeredAt: firebase.database.ServerValue.TIMESTAMP,
      });

      const el = document.getElementById('result-text');
      el.style.color = '#3B6D11';
      el.textContent = `Correct! +${cfg.points}${speedBonus ? ' +' + speedBonus + ' speed' : ''} pts`;
      document.getElementById('my-score').textContent = newScore;
    });

  // ── WRONG ────────────────────────────────────
  } else {
    localAttempts++;
    const attemptsLeft = MAX_ATTEMPTS - localAttempts;
    const el = document.getElementById('result-text');

    // Deduct points for this wrong attempt
    roomRef.once('value', snap => {
      const room     = snap.val() || {};
      const me       = (room.players || {})[myId] || { score: 0 };
      const newScore = Math.max(0, me.score - 5);
      document.getElementById('my-score').textContent = newScore;

      // Out of attempts — end the turn
      if (localAttempts >= MAX_ATTEMPTS) {
        localAnswered = true;
        document.getElementById('input-row').style.display  = 'none';
        document.getElementById('action-row').style.display = 'none';
        el.style.color = '#993C1D';
        el.textContent = `Out of attempts! Answer: ${w.word}`;

        roomRef.child('players/' + myId).update({
          score:      newScore,
          answered:   true,
          correct:    false,
          answeredAt: firebase.database.ServerValue.TIMESTAMP,
        });

      // Still have attempts left — show feedback, keep input open
      } else {
        roomRef.child('players/' + myId + '/score').set(newScore);
        el.style.color = '#993C1D';
        el.textContent = `Wrong! −5 pts · ${attemptsLeft} attempt${attemptsLeft > 1 ? 's' : ''} left`;

        // Shake the input to signal wrong answer
        const inputEl = document.getElementById('answer-input');
        inputEl.value = '';
        inputEl.style.borderColor = '#993C1D';
        setTimeout(() => { inputEl.style.borderColor = ''; inputEl.focus(); }, 600);
      }
    });
  }
}

function useHint() {
  if (localHintUsed || localAnswered) return;
  localHintUsed = true;
  document.getElementById('hint-btn').disabled     = true;
  document.getElementById('hint-text').textContent = activeWords[lastWordIndex].hint;

  roomRef.once('value', snap => {
    const me = ((snap.val() || {}).players || {})[myId] || { score: 0 };
    roomRef.child('players/' + myId + '/score').set(Math.max(0, me.score - 5));
  });
}

function skipWord() {
  if (localAnswered) return;
  localAnswered = true;
  document.getElementById('input-row').style.display  = 'none';
  document.getElementById('action-row').style.display = 'none';
  const el = document.getElementById('result-text');
  el.style.color = '#888780';
  el.textContent = `Skipped — answer: ${activeWords[lastWordIndex].word}`;
  roomRef.child('players/' + myId).update({
    answered: true, correct: false,
    answeredAt: firebase.database.ServerValue.TIMESTAMP,
  });
}

// ══════════════════════════════════════════════
//  GAME — RESULTS (between words)
// ══════════════════════════════════════════════

function moveToResults(room) {
  roomRef.update({ status: 'results', resultsStartedAt: firebase.database.ServerValue.TIMESTAMP });
}

function handleResults(room) {
  clearInterval(timerLoop);
  document.getElementById('results-phase').style.display = 'block';
  document.getElementById('word-card').style.display     = 'none';

  const idx     = room.currentWord;
  const w       = activeWords[idx];
  const players = room.players || {};

  const winners = Object.values(players)
    .filter(p => p.correct)
    .sort((a, b) => a.answeredAt - b.answeredAt);

  if (w) {
    document.getElementById('results-word').textContent = w.word;
  }
  document.getElementById('results-summary').textContent = winners.length
    ? `${winners.map(p => p.name).join(', ')} got it right!`
    : 'Nobody got it — tough one!';

  updateLeaderboard(players);
  const me = players[myId];
  if (me) document.getElementById('my-score').textContent = me.score;

  if (isHost && room.resultsStartedAt && room.resultsStartedAt !== lastResultsAt) {
    lastResultsAt = room.resultsStartedAt;
    clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
      const elapsed   = (Date.now() - room.resultsStartedAt) / 1000;
      const remaining = Math.max(0, RESULTS_PAUSE - Math.floor(elapsed));
      document.getElementById('results-countdown').textContent = `Next word in ${remaining}s…`;

      if (remaining <= 0) {
        clearInterval(countdownInterval);
        const nextIdx = idx + 1;

        if (nextIdx >= activeWords.length) {
          roomRef.update({ status: 'finished' });
        } else {
          const updates = {
            status:        'playing',
            currentWord:   nextIdx,
            wordStartedAt: firebase.database.ServerValue.TIMESTAMP,
          };
          Object.keys(room.players || {}).forEach(pid => {
            updates[`players/${pid}/answered`]   = false;
            updates[`players/${pid}/correct`]    = false;
            updates[`players/${pid}/answeredAt`] = 0;
          });
          roomRef.update(updates);
        }
      }
    }, 400);

  } else if (!isHost) {
    document.getElementById('results-countdown').textContent = 'Waiting for next word…';
  }
}

// ══════════════════════════════════════════════
//  GAME — FINISHED
// ══════════════════════════════════════════════

function handleFinished(room) {
  clearInterval(timerLoop);
  clearInterval(countdownInterval);
  showScreen('screen-end');

  const players = room.players || {};
  const sorted  = Object.entries(players).sort((a, b) => b[1].score - a[1].score);
  const me      = players[myId];
  const myRank  = sorted.findIndex(([id]) => id === myId) + 1;

  document.getElementById('my-final-score').textContent = me ? me.score : 0;
  document.getElementById('my-rank-label').textContent  =
    `You placed #${myRank} of ${sorted.length} · ` +
    (myRank === 1 ? 'Winner! 🥇' : myRank === 2 ? 'Runner-up! 🥈' : myRank === 3 ? 'Third place! 🥉' : 'Good game!');

  const medals = ['🥇', '🥈', '🥉'];
  document.getElementById('final-lb').innerHTML = sorted.map(([id, p], i) => `
    <div class="final-lb-row">
      <span class="f-rank">${medals[i] || (i + 1)}</span>
      <span class="f-name${id === myId ? ' me' : ''}">${esc(p.name)}${id === myId ? ' (you)' : ''}</span>
      <span class="f-score">${p.score} pts</span>
    </div>`).join('');
}

// ══════════════════════════════════════════════
//  LEADERBOARD
// ══════════════════════════════════════════════

function updateLeaderboard(players) {
  const sorted = Object.entries(players).sort((a, b) => b[1].score - a[1].score);
  document.getElementById('lb-rows').innerHTML = sorted.map(([id, p], i) => {
    const status = p.answered
      ? `<span class="lb-status ${p.correct ? 'correct' : 'wrong'}">${p.correct ? '✓' : '✗'}</span>`
      : `<span class="lb-status pending">…</span>`;
    return `
      <div class="lb-row">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name${id === myId ? ' me' : ''}">${esc(p.name)}</span>
        ${status}
        <span class="lb-score">${p.score}</span>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
//  PLAY AGAIN
// ══════════════════════════════════════════════

function playAgain() {
  if (roomRef) { roomRef.off(); roomRef = null; }
  activeWords    = [];
  customWords    = [];
  aiWords        = [];
  lastWordIndex  = -1;
  lastResultsAt  = 0;
  showScreen('screen-setup');
}

// ══════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const gameActive   = document.getElementById('screen-game').classList.contains('active');
    const customActive = document.getElementById('screen-custom').classList.contains('active');
    if (gameActive && !localAnswered)  submitAnswer();
    if (customActive)                  addCustomWord();
  }
});