// ══════════════════════════════════════════════
//  FIREBASE CONFIG
// ══════════════════════════════════════════════
const firebaseConfig = {
  apiKey:            "AIzaSyDshwv5XbkGUXGavZQURP6AOHWY2-qGI8A",
  authDomain:        "iscramble-c5c03.firebaseapp.com",
  databaseURL:       "https://iscramble-c5c03-default-rtdb.firebaseio.com/",
  projectId:         "iscramble-c5c03",
  storageBucket:     "iscramble-c5c03.firebasestorage.app",
  messagingSenderId: "481294458586",
  appId:             "1:481294458586:web:3b5507d586e8811c024fe3",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ══════════════════════════════════════════════
//  PLAYER IDENTITY
//  Stored in sessionStorage so refreshing the
//  page keeps the same player ID within a tab.
// ══════════════════════════════════════════════
let myId   = sessionStorage.getItem('csg_pid') || Math.random().toString(36).slice(2, 10);
let myName = '';
sessionStorage.setItem('csg_pid', myId);

// ══════════════════════════════════════════════
//  ROOM STATE
// ══════════════════════════════════════════════
let roomCode = '';
let roomRef  = null;
let isHost   = false;

// ══════════════════════════════════════════════
//  GAME STATE (reset each round)
// ══════════════════════════════════════════════
let timerLoop          = null;   // setInterval for the countdown
let countdownInterval  = null;   // setInterval for results-phase countdown
let advanceTimeout     = null;   // setTimeout before moving to results

let localAnswered    = false;   // has this player answered the current word?
let localHintUsed    = false;   // has this player used their hint?
let lastWordIndex    = -1;      // track when the word changes
let advanceScheduled = false;   // prevent host from advancing twice
let lastResultsAt    = 0;       // prevent re-triggering results countdown

// ══════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════

/** Switch visible screen by element ID */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/** Escape HTML to prevent XSS in player names */
function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
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
  enterRoom();
}

function handleJoin() {
  const name = document.getElementById('name-input').value.trim();
  const code = document.getElementById('code-input').value.trim().toUpperCase();
  if (!name)             { setError('Please enter your name.'); return; }
  if (code.length !== 4) { setError('Enter a valid 4-letter room code.'); return; }
  myName   = name;
  roomCode = code;
  isHost   = false;
  enterRoom();
}

function setError(msg) {
  document.getElementById('setup-error').textContent = msg;
}

async function enterRoom() {
  roomRef = db.ref('rooms/' + roomCode);
  const snap = await roomRef.once('value');
  const room = snap.val();

  if (!isHost && !room)                { setError('Room not found. Double-check the code.'); return; }
  if (room && room.status !== 'lobby') { setError('Game already started in this room.'); return; }

  // Register this player
  const playerRef = roomRef.child('players/' + myId);
  await playerRef.set({ name: myName, score: 0, answered: false, correct: false, answeredAt: 0 });
  playerRef.onDisconnect().remove();

  // Host initializes the room node
  if (isHost) {
    await roomRef.update({
      host: myId,
      status: 'lobby',
      currentWord: 0,
      wordStartedAt: 0,
      resultsStartedAt: 0,
    });
    roomRef.onDisconnect().remove();
  }

  // Move to lobby UI
  document.getElementById('lobby-code').textContent = roomCode;
  if (isHost) {
    document.getElementById('start-btn').style.display  = 'block';
    document.getElementById('waiting-msg').style.display = 'none';
  }
  showScreen('screen-lobby');

  // Listen for all room changes
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
  const snap = await roomRef.child('players').once('value');
  if (!snap.val()) return;
  showScreen('screen-game');
  await roomRef.update({
    status: 'playing',
    currentWord: 0,
    wordStartedAt: firebase.database.ServerValue.TIMESTAMP,
  });
}

// ══════════════════════════════════════════════
//  GAME — PLAYING
// ══════════════════════════════════════════════

function handlePlaying(room) {
  if (!document.getElementById('screen-game').classList.contains('active')) {
    showScreen('screen-game');
  }

  document.getElementById('results-phase').style.display = 'none';
  document.getElementById('word-card').style.display     = 'block';

  const idx = room.currentWord;
  const w   = WORDS[idx];
  const cfg = DIFF_CFG[w.difficulty];

  // Reset local state when the word changes
  if (idx !== lastWordIndex) {
    lastWordIndex    = idx;
    localAnswered    = false;
    localHintUsed    = false;
    advanceScheduled = false;
    clearTimeout(advanceTimeout);

    renderWord(w);
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
  document.getElementById('progress-fill').style.width = ((idx + 1) / 15 * 100) + '%';

  // Synchronized countdown — all clients derive time from the same DB timestamp
  clearInterval(timerLoop);
  timerLoop = setInterval(() => {
    const elapsed   = (Date.now() - room.wordStartedAt) / 1000;
    const remaining = Math.max(0, cfg.time - elapsed);
    const timerEl   = document.getElementById('timer-display');
    timerEl.textContent = Math.ceil(remaining);
    timerEl.style.color = remaining <= 5 ? '#993C1D' : remaining <= 10 ? '#854F0B' : '#1a1a18';

    // Lock out input when time expires
    if (remaining <= 0 && !localAnswered) {
      localAnswered = true;
      document.getElementById('result-text').style.color = '#854F0B';
      document.getElementById('result-text').textContent = `Time's up! Answer: ${w.word}`;
      document.getElementById('input-row').style.display  = 'none';
      document.getElementById('action-row').style.display = 'none';
    }

    // Host drives advancement — only the host writes to the DB
    if (remaining <= 0 && isHost && !advanceScheduled) {
      advanceScheduled = true;
      clearInterval(timerLoop);
      advanceTimeout = setTimeout(() => moveToResults(room), 1500);
    }
  }, 150);

  updateLeaderboard(room.players || {});

  const me = (room.players || {})[myId];
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
  const w       = WORDS[idx];
  const cfg     = DIFF_CFG[w.difficulty];
  const correct = input === w.word;

  localAnswered = true;
  document.getElementById('input-row').style.display  = 'none';
  document.getElementById('action-row').style.display = 'none';

  // Read the current server state before writing the score
  roomRef.once('value', snap => {
    const room       = snap.val() || {};
    const me         = (room.players || {})[myId] || { score: 0 };
    const elapsed    = (Date.now() - room.wordStartedAt) / 1000;
    const timeLeft   = Math.max(0, cfg.time - elapsed);
    const speedBonus = correct ? Math.round((timeLeft / cfg.time) * 10) : 0;
    const newScore   = Math.max(0, me.score + (correct ? cfg.points + speedBonus : -5));

    roomRef.child('players/' + myId).update({
      score:      newScore,
      answered:   true,
      correct:    correct,
      answeredAt: firebase.database.ServerValue.TIMESTAMP,
    });

    const el = document.getElementById('result-text');
    if (correct) {
      el.style.color = '#3B6D11';
      el.textContent = `Correct! +${cfg.points}${speedBonus ? ' +' + speedBonus + ' speed' : ''} pts`;
    } else {
      el.style.color = '#993C1D';
      el.textContent = `Wrong! (−5 pts) Answer: ${w.word}`;
    }
    document.getElementById('my-score').textContent = newScore;
  });
}

function useHint() {
  if (localHintUsed || localAnswered) return;
  localHintUsed = true;
  document.getElementById('hint-btn').disabled     = true;
  document.getElementById('hint-text').textContent = WORDS[lastWordIndex].hint;

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
  el.textContent = `Skipped — answer: ${WORDS[lastWordIndex].word}`;
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
  const w       = WORDS[idx];
  const players = room.players || {};

  const winners = Object.values(players)
    .filter(p => p.correct)
    .sort((a, b) => a.answeredAt - b.answeredAt);

  document.getElementById('results-word').textContent    = w.word;
  document.getElementById('results-summary').textContent = winners.length
    ? `${winners.map(p => p.name).join(', ')} got it right!`
    : 'Nobody got it — tough one!';

  updateLeaderboard(players);
  const me = players[myId];
  if (me) document.getElementById('my-score').textContent = me.score;

  // Only the host drives the countdown and writes the next state
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

        if (nextIdx >= WORDS.length) {
          roomRef.update({ status: 'finished' });
        } else {
          const updates = {
            status:         'playing',
            currentWord:    nextIdx,
            wordStartedAt:  firebase.database.ServerValue.TIMESTAMP,
          };
          // Reset all players' answered state for the new word
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
    (myRank === 1 ? 'Winner!' : myRank === 2 ? 'Runner-up!' : myRank === 3 ? 'Third place!' : 'Good game!');

  const medals = ['🥇', '🥈', '🥉'];
  document.getElementById('final-lb').innerHTML = sorted.map(([id, p], i) => `
    <div class="final-lb-row">
      <span class="f-rank">${medals[i] || (i + 1)}</span>
      <span class="f-name${id === myId ? ' me' : ''}">${esc(p.name)}${id === myId ? ' (you)' : ''}</span>
      <span class="f-score">${p.score} pts</span>
    </div>`).join('');
}

// ══════════════════════════════════════════════
//  SHARED LEADERBOARD RENDERER
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
  lastWordIndex = -1;
  lastResultsAt = 0;
  showScreen('screen-setup');
}

// ══════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════

document.addEventListener('keydown', e => {
  const gameActive = document.getElementById('screen-game').classList.contains('active');
  if (e.key === 'Enter' && gameActive && !localAnswered) {
    submitAnswer();
  }
});
