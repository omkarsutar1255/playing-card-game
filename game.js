// Game Constants
const TOTAL_PLAYERS = 6;
const CARDS_PER_PLAYER = 8;
const TOTAL_CARDS = 48;
const TEAM1_PLAYERS = [1, 3, 5];
const TEAM2_PLAYERS = [2, 4, 6];
const ROUNDS_PER_GAME = 8;

// Game State
let isHost = false;
let isTestMode = false;
let playerPosition = null;
let currentTestPlayer = 1; 
let peer = null;
let hostConnection = null; 
let connections = []; 
let gameState = {
  config: {
    team1Name: "Team 1",
    team2Name: "Team 2",
    playerNames: {
      1: "Player 1", 2: "Player 2", 3: "Player 3",
      4: "Player 4", 5: "Player 5", 6: "Player 6"
    }
  },
  deck: [],
  hands: {}, 
  team1Points: 0,
  team2Points: 0,
  team1Rounds: 0,
  team2Rounds: 0,
  currentDistributor: null,
  nextDistributor: null,
  currentRound: 0,
  gameStarted: false,
  gameCompleted: false, 
  gameWinnerTeam: null, 
  players: [], 
  hiddenCard: null, 
  superSuit: null, 
  hiddenCardOpened: false, 
  hiddenCardOpener: null, // NEW: Track who opened it
  firstMoverTeam: null, 
  roundState: {
    startPlayer: null, // NEW: Track who started the round
    currentTurn: null,
    cardsPlayed: {}, 
    baseSuit: null, 
    roundComplete: false,
    justOpenedHidden: false, // NEW: Flag for mandatory move
    roundWinnerInfo: null // NEW: Store for popup
  }
};

const SUITS = { 'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠' };
const SUIT_ORDER = { 'hearts': 0, 'spades': 1, 'diamonds': 2, 'clubs': 3 };
const RANKS = ['A', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CARD_RANK = { '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12 };

// Initialize
document.addEventListener('DOMContentLoaded', () => { log('Game initialized.'); });

// Audio Helper
function playSound(type) {
  try {
    let audioId = '';
    if (type === 'distribute') audioId = 'snd-distribute';
    else if (type === 'winner') audioId = 'snd-winner';
    else if (type === 'cheers') audioId = 'snd-cheers';
    const audio = document.getElementById(audioId);
    if (audio) { audio.currentTime = 0; audio.play().catch(e => {}); }
  } catch (e) { console.log(e); }
}

// Setup & Names
function openSetupModal() {
  const modal = document.getElementById('setupModal'); modal.classList.remove('hidden');
  document.getElementById('setupTeam1').value = gameState.config.team1Name;
  document.getElementById('setupTeam2').value = gameState.config.team2Name;
  for(let i=1; i<=6; i++) document.getElementById(`setupP${i}`).value = gameState.config.playerNames[i];
}

function saveSetup() {
  const c = gameState.config;
  c.team1Name = document.getElementById('setupTeam1').value || "Team 1";
  c.team2Name = document.getElementById('setupTeam2').value || "Team 2";
  for(let i=1; i<=6; i++) c.playerNames[i] = document.getElementById(`setupP${i}`).value || `Player ${i}`;
  document.getElementById('setupModal').classList.add('hidden');
  updateGameDisplay();
  if(!isTestMode) broadcastToAll({ type: 'gameState', state: gameState });
}

// P2P Logic (Standard)
function createHost() {
  isHost = true; playerPosition = 1;
  peer = new Peer(undefined, { debug: 1 });
  peer.on('open', id => {
    document.getElementById('roomId').textContent = id;
    document.getElementById('hostStatus').textContent = 'Host created.';
    document.getElementById('hostStatus').style.color = 'green';
    document.getElementById('hostControls').classList.remove('hidden');
    gameState.players = [1];
  });
  peer.on('connection', conn => {
    conn.on('open', () => {
      const playerNum = connections.length + 2; 
      if (connections.length + 1 >= TOTAL_PLAYERS) { conn.close(); return; }
      connections.push({ conn: conn, playerId: playerNum, peerId: conn.peer });
      gameState.players.push(playerNum);
      sendToPlayer(conn, { type: 'gameState', state: gameState, playerPosition: playerNum });
      broadcastToAll({ type: 'playerJoined', playerId: playerNum, totalPlayers: connections.length + 1 });
      document.getElementById('hostStatus').textContent = `${connections.length + 1} / ${TOTAL_PLAYERS} connected`;
      if (connections.length + 1 === TOTAL_PLAYERS) {
        document.getElementById('hostStatus').textContent = 'Ready to start.';
        document.getElementById('gameSection').classList.remove('hidden');
        document.getElementById('playerPosition').textContent = ` - ${gameState.config.playerNames[1]} (Host)`;
        updateGameDisplay();
      }
    });
    conn.on('data', data => handleHostMessage(data, conn));
    conn.on('close', () => removeConnection(conn));
  });
}
function joinHost() {
  const roomId = document.getElementById('joinId').value.trim(); if (!roomId) return;
  isHost = false; peer = new Peer(undefined, { debug: 1 });
  peer.on('open', () => {
    hostConnection = peer.connect(roomId);
    hostConnection.on('open', () => {
      document.getElementById('clientStatus').textContent = 'Connected';
      document.getElementById('clientStatus').style.color = 'green';
      document.getElementById('gameSection').classList.remove('hidden');
    });
    hostConnection.on('data', data => handleClientMessage(data));
    hostConnection.on('close', () => {
      document.getElementById('clientStatus').textContent = 'Disconnected';
      document.getElementById('clientStatus').style.color = 'red';
    });
  });
}
function removeConnection(conn) {
  const index = connections.findIndex(c => c.conn === conn);
  if (index !== -1) {
    connections.splice(index, 1);
    document.getElementById('hostStatus').textContent = `${connections.length + 1} / ${TOTAL_PLAYERS} connected`;
  }
}
function sendToPlayer(conn, data) { if (conn && conn.open) conn.send(JSON.stringify(data)); }
function broadcastToAll(data) { connections.forEach(({ conn }) => sendToPlayer(conn, data)); }

// Game Logic
function createDeck() {
  const deck = [];
  ['hearts', 'diamonds', 'clubs', 'spades'].forEach(suit => {
    RANKS.forEach(rank => deck.push({ suit, rank, id: `${rank}-${suit}` }));
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function distributeCards(deck, distributor) {
  const hands = {};
  for (let i = 1; i <= TOTAL_PLAYERS; i++) hands[i] = [];
  let cardIndex = 0, playerIndex = distributor;
  while (cardIndex < TOTAL_CARDS) {
    playerIndex = (playerIndex % TOTAL_PLAYERS) + 1;
    hands[playerIndex].push(deck[cardIndex]);
    cardIndex++;
  }
  return hands;
}
function startNextGame() {
  if (!isHost && !isTestMode) return;
  if (gameState.nextDistributor) {
      gameState.currentDistributor = gameState.nextDistributor;
      gameState.nextDistributor = null;
  } else { rotateDistributor(); }
  startGame();
}
function startGame() {
  if (!isHost && !isTestMode) return;
  if (!isTestMode && connections.length + 1 < TOTAL_PLAYERS) return;
  if (!gameState.currentDistributor) setRandomDistributor();
  playSound('distribute');
  gameState.deck = createDeck();
  gameState.hands = distributeCards(gameState.deck, gameState.currentDistributor);
  gameState.currentRound = 1;
  gameState.gameStarted = true;
  gameState.gameCompleted = false;
  gameState.gameWinnerTeam = null;
  gameState.team1Rounds = 0; gameState.team2Rounds = 0;
  gameState.superSuit = null; gameState.hiddenCardOpened = false; gameState.hiddenCardOpener = null;
  
  document.getElementById('startGameBtn').classList.add('hidden');
  document.getElementById('nextGameButton').classList.add('hidden');
  document.getElementById('team1Winner').classList.add('hidden');
  document.getElementById('team2Winner').classList.add('hidden');

  const firstPlayer = (gameState.currentDistributor % TOTAL_PLAYERS) + 1;
  gameState.firstMoverTeam = TEAM1_PLAYERS.includes(firstPlayer) ? 1 : 2;
  
  if (gameState.hands[firstPlayer] && gameState.hands[firstPlayer].length > 0) {
    const hiddenIndex = Math.floor(Math.random() * gameState.hands[firstPlayer].length);
    gameState.hiddenCard = gameState.hands[firstPlayer][hiddenIndex];
    gameState.hands[firstPlayer].splice(hiddenIndex, 1);
  }

  gameState.roundState = { startPlayer: firstPlayer, currentTurn: firstPlayer, cardsPlayed: {}, baseSuit: null, roundComplete: false, justOpenedHidden: false, roundWinnerInfo: null };
  updateGameDisplay();
  if (!isTestMode) broadcastToAll({ type: 'gameState', state: gameState });
  document.getElementById('roundControls').classList.remove('hidden');
  if (isTestMode) switchTestPlayer(firstPlayer);
}
function setRandomDistributor() { gameState.currentDistributor = Math.floor(Math.random() * TOTAL_PLAYERS) + 1; }
function rotateDistributor() { 
  if (gameState.currentDistributor) gameState.currentDistributor = (gameState.currentDistributor % TOTAL_PLAYERS) + 1;
  else setRandomDistributor();
}
function determineNextDistributor(winningTeam, triggered32PointRule) {
    let next = gameState.currentDistributor;
    const distributorTeam = TEAM1_PLAYERS.includes(next) ? 1 : 2;
    if (triggered32PointRule) return (next + 1) % TOTAL_PLAYERS + 1; 
    if (winningTeam === distributorTeam) return (next % TOTAL_PLAYERS) + 1;
    return next;
}
function updateRoundsWon(winningTeam) {
  if (winningTeam === 1) gameState.team1Rounds++; else gameState.team2Rounds++;
  updateGameDisplay();
}
function checkGameWinner() {
  const firstMover = gameState.firstMoverTeam;
  let gameWinner = null;
  if (firstMover === 1) {
    if (gameState.team1Rounds >= 5) gameWinner = 1;
    else if (gameState.team2Rounds >= 4) gameWinner = 2;
  } else {
    if (gameState.team2Rounds >= 5) gameWinner = 2;
    else if (gameState.team1Rounds >= 4) gameWinner = 1;
  }
  if (gameWinner) { endGame(gameWinner); return true; }
  return false; 
}
function calculateGamePoints(winningTeam) {
  if (winningTeam === 1) {
    if (gameState.team2Points === 0) gameState.team1Points += 5;
    else { const red = Math.min(10, gameState.team2Points); gameState.team2Points -= red; gameState.team1Points += red; }
  } else {
    if (gameState.team1Points === 0) gameState.team2Points += 5;
    else { const red = Math.min(10, gameState.team1Points); gameState.team1Points -= red; gameState.team2Points += red; }
  }
  let triggered32 = false;
  if (gameState.team1Points >= 32) { gameState.team1Points -= 32; triggered32 = true; }
  else if (gameState.team2Points >= 32) { gameState.team2Points -= 32; triggered32 = true; }
  if(triggered32) showWinnerPopup(); 
  gameState.nextDistributor = determineNextDistributor(winningTeam, triggered32);
}
function showWinnerPopup() {
    playSound('winner'); 
    const popup = document.getElementById('winnerPopup');
    popup.classList.remove('hidden');
    setTimeout(() => popup.classList.add('hidden'), 5000); 
}
function endGame(winningTeam) {
  gameState.gameCompleted = true;
  gameState.gameWinnerTeam = winningTeam;
  gameState.roundState.roundComplete = true; 
  calculateGamePoints(winningTeam);
  setTimeout(() => playSound('cheers'), 500);
  updateGameDisplay();
  if (isHost) { document.getElementById('nextGameButton').classList.remove('hidden'); document.getElementById('startGameBtn').classList.add('hidden'); }
  if (!isTestMode) {
    broadcastToAll({ type: 'gameState', state: gameState });
    if (gameState.nextDistributor && (Math.abs(gameState.nextDistributor - gameState.currentDistributor) > 1)) broadcastToAll({ type: 'showWinnerPopup' });
    broadcastToAll({ type: 'playEndSound' });
  }
}

// === NEW WINNER LOGIC ===
function calculateRoundWinner() {
  const rs = gameState.roundState;
  const cardsPlayed = rs.cardsPlayed;
  
  // Reconstruct Sequence based on startPlayer
  let playerSequence = [];
  let p = rs.startPlayer;
  for(let i=0; i<TOTAL_PLAYERS; i++) {
      if(cardsPlayed[p]) playerSequence.push(p);
      p = (p % TOTAL_PLAYERS) + 1;
  }

  let currentWinner = playerSequence[0];
  let isTrumpActive = false; // Becomes true from the player who opened hidden card onwards

  // Iterate to find winner
  for (let i = 1; i < playerSequence.length; i++) {
      const challengerId = playerSequence[i];
      const winningCard = cardsPlayed[currentWinner];
      const challengerCard = cardsPlayed[challengerId];
      
      // Determine if Super Suit concept is active for these players
      if (gameState.hiddenCardOpened) {
          if (currentWinner === gameState.hiddenCardOpener) isTrumpActive = true; 
          // Note: Logic needs to track if Trump became active *during* the sequence
          // Simpler: Check if the specific card was played AFTER or BY opener
          // Since we iterate in order, we can maintain a flag.
      }
      
      // Check if Challenger activates Trump
      let challengerIsTrump = false;
      if (gameState.hiddenCardOpened && challengerCard.suit === gameState.superSuit) {
          // If Base Suit IS Super Suit, it's always "Trump" (just Base)
          if (gameState.superSuit === rs.baseSuit) {
              challengerIsTrump = true;
          } else {
              // Otherwise, only Trump if played by/after Opener
              // We need to know if we passed opener in sequence. 
              // We can check if `challengerId` index >= opener index in `playerSequence`
              const openerIndex = playerSequence.indexOf(gameState.hiddenCardOpener);
              if (openerIndex !== -1 && i >= openerIndex) {
                  challengerIsTrump = true;
              }
          }
      }

      let winnerIsTrump = false;
      if (gameState.hiddenCardOpened && winningCard.suit === gameState.superSuit) {
          if (gameState.superSuit === rs.baseSuit) {
              winnerIsTrump = true;
          } else {
             const openerIndex = playerSequence.indexOf(gameState.hiddenCardOpener);
             const winnerIndex = playerSequence.indexOf(currentWinner);
             if (openerIndex !== -1 && winnerIndex >= openerIndex) {
                 winnerIsTrump = true;
             }
          }
      }

      // Comparison Logic
      if (challengerIsTrump && !winnerIsTrump) {
          currentWinner = challengerId;
      } else if (challengerIsTrump && winnerIsTrump) {
          if (CARD_RANK[challengerCard.rank] > CARD_RANK[winningCard.rank]) currentWinner = challengerId;
      } else if (!challengerIsTrump && !winnerIsTrump) {
          if (challengerCard.suit === rs.baseSuit && winningCard.suit !== rs.baseSuit) {
              currentWinner = challengerId;
          } else if (challengerCard.suit === rs.baseSuit && winningCard.suit === rs.baseSuit) {
              if (CARD_RANK[challengerCard.rank] > CARD_RANK[winningCard.rank]) currentWinner = challengerId;
          }
      }
  }
  return currentWinner;
}

// 5 Sec Delay & Popup
function completeRound() {
  const winner = calculateRoundWinner();
  const winnerTeam = TEAM1_PLAYERS.includes(winner) ? 1 : 2;
  const winnerCard = gameState.roundState.cardsPlayed[winner];
  
  // Clean State for Next Round
  updateRoundsWon(winnerTeam);
  gameState.roundState.cardsPlayed = {};
  gameState.roundState.baseSuit = null;
  gameState.roundState.roundComplete = false;
  gameState.roundState.roundWinnerInfo = null; // Clear info
  gameState.roundState.justOpenedHidden = false; // Reset flag
  
  // Hide popup
  document.getElementById('roundResultPopup').classList.add('hidden');

  if (checkGameWinner()) return;
  if (gameState.currentRound >= ROUNDS_PER_GAME) return;
  
  gameState.currentRound++;
  gameState.roundState.startPlayer = winner; // Winner starts next round
  gameState.roundState.currentTurn = winner;
  
  if (isTestMode) switchTestPlayer(winner);
  updateGameDisplay();
  if (!isTestMode) broadcastToAll({ type: 'gameState', state: gameState });
}

// Messaging
function handleHostMessage(data, conn) {
  try {
    const msg = typeof data === 'string' ? JSON.parse(data) : data;
    if (msg.type === 'playerAction') {
        if(msg.action.type === 'selectCard' && !gameState.gameCompleted) {
           const hand = gameState.hands[msg.playerId];
           const actualIndex = hand.findIndex(c => c.id === msg.action.card.id);
           if(actualIndex !== -1) saveSelectedCard(msg.playerId, msg.action.card, actualIndex);
        } else if (msg.action.type === 'openHiddenCard' && !gameState.gameCompleted) {
           openHiddenCard();
        }
    }
  } catch (e) { console.log(e); }
}
function handleClientMessage(data) {
  try {
    const msg = typeof data === 'string' ? JSON.parse(data) : data;
    if (msg.type === 'gameState') {
      if (msg.playerPosition) {
        playerPosition = msg.playerPosition;
        const pName = msg.state.config.playerNames[playerPosition];
        document.getElementById('playerPosition').textContent = ` - ${pName}`;
      }
      gameState = msg.state;
      updateGameDisplay();
    } else if (msg.type === 'showWinnerPopup') showWinnerPopup();
    else if (msg.type === 'playEndSound') playSound('cheers');
  } catch (e) { console.log(e); }
}
function sendPlayerAction(action) {
  if (isHost) return;
  if (hostConnection && hostConnection.open) hostConnection.send(JSON.stringify({ type: 'playerAction', action: action, playerId: playerPosition }));
}

// Helpers
function sortHand(cards) {
    if (!cards) return [];
    return cards.sort((a, b) => {
        const suitDiff = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
        if (suitDiff !== 0) return suitDiff;
        return CARD_RANK[b.rank] - CARD_RANK[a.rank];
    });
}
function getName(id) { return gameState.config.playerNames[id] || `Player ${id}`; }

function updateActionButtons(viewingPlayer) {
    const rs = gameState.roundState;
    if (!gameState.gameStarted || gameState.gameCompleted) {
        document.getElementById('playCardSection').classList.add('hidden');
        return;
    }
    // If waiting for delay, hide controls
    if (rs.roundWinnerInfo) {
        document.getElementById('playCardSection').classList.add('hidden');
        return;
    }

    if (rs.currentTurn === viewingPlayer && !rs.roundComplete) {
      document.getElementById('playCardSection').classList.remove('hidden');
      if (canOpenHiddenCard(viewingPlayer)) {
        const selectedCard = document.querySelector('.card.selected');
        let showOpenBtn = true;
        if (selectedCard) {
            const cardIndex = parseInt(selectedCard.dataset.cardIndex);
            const card = gameState.hands[viewingPlayer][cardIndex];
            if (rs.baseSuit && card.suit === rs.baseSuit) showOpenBtn = false;
        }
        if (showOpenBtn) document.getElementById('openHiddenCardSection').classList.remove('hidden');
        else document.getElementById('openHiddenCardSection').classList.add('hidden');
      } else { document.getElementById('openHiddenCardSection').classList.add('hidden'); }
    } else { document.getElementById('playCardSection').classList.add('hidden'); }
}

function updateGameDisplay() {
  const conf = gameState.config;
  document.getElementById('team1NameDisplay').textContent = conf.team1Name;
  document.getElementById('team2NameDisplay').textContent = conf.team2Name;
  const t1Names = TEAM1_PLAYERS.map(id => conf.playerNames[id]).join(', ');
  const t2Names = TEAM2_PLAYERS.map(id => conf.playerNames[id]).join(', ');
  document.getElementById('team1PlayersDisplay').textContent = t1Names;
  document.getElementById('team2PlayersDisplay').textContent = t2Names;
  document.getElementById('team1Points').textContent = gameState.team1Points;
  document.getElementById('team2Points').textContent = gameState.team2Points;
  document.getElementById('team1Rounds').textContent = gameState.team1Rounds;
  document.getElementById('team2Rounds').textContent = gameState.team2Rounds;

  // KING LOGIC
  const t1Score = gameState.team1Points;
  const t2Score = gameState.team2Points;
  const t1Crown = document.getElementById('team1Crown');
  const t2Crown = document.getElementById('team2Crown');
  t1Crown.classList.add('hidden'); t2Crown.classList.add('hidden');
  if (t1Score > 0 && t1Score > t2Score) t1Crown.classList.remove('hidden');
  if (t2Score > 0 && t2Score > t1Score) t2Crown.classList.remove('hidden');

  const t1Target = document.getElementById('team1Target');
  const t2Target = document.getElementById('team2Target');
  if (gameState.gameStarted && gameState.firstMoverTeam) {
    t1Target.classList.remove('hidden'); t2Target.classList.remove('hidden');
    if (gameState.firstMoverTeam === 1) { t1Target.textContent = 'Target: 5'; t1Target.style.fontWeight = 'bold'; t2Target.textContent = 'Target: 4'; t2Target.style.fontWeight = 'normal'; }
    else { t2Target.textContent = 'Target: 5'; t2Target.style.fontWeight = 'bold'; t1Target.textContent = 'Target: 4'; t1Target.style.fontWeight = 'normal'; }
  } else { t1Target.classList.add('hidden'); t2Target.classList.add('hidden'); }

  if (gameState.currentDistributor) document.getElementById('currentDistributor').textContent = getName(gameState.currentDistributor);
  document.getElementById('currentRound').textContent = gameState.currentRound;
  
  if (gameState.gameCompleted && gameState.gameWinnerTeam) {
      if (gameState.gameWinnerTeam === 1) document.getElementById('team1Winner').classList.remove('hidden');
      else document.getElementById('team2Winner').classList.remove('hidden');
  } else { document.getElementById('team1Winner').classList.add('hidden'); document.getElementById('team2Winner').classList.add('hidden'); }

  if (gameState.gameCompleted && isHost) { document.getElementById('nextGameButton').classList.remove('hidden'); document.getElementById('startGameBtn').classList.add('hidden'); }

  if (gameState.gameStarted && gameState.roundState && !gameState.gameCompleted) {
    const rs = gameState.roundState;
    if (rs.currentTurn) { document.getElementById('currentTurnInfo').classList.remove('hidden'); document.getElementById('currentTurn').textContent = getName(rs.currentTurn); }
    if (rs.baseSuit) { document.getElementById('baseSuitInfo').classList.remove('hidden'); document.getElementById('baseSuitInfo').textContent = `Base: ${SUITS[rs.baseSuit]}`; } else document.getElementById('baseSuitInfo').classList.add('hidden');
    if (gameState.superSuit) { document.getElementById('superSuitInfo').classList.remove('hidden'); document.getElementById('superSuitInfo').textContent = `Super: ${SUITS[gameState.superSuit]}`; } else document.getElementById('superSuitInfo').classList.add('hidden');
    
    if (gameState.hiddenCardOpened && gameState.hiddenCard) { document.getElementById('hiddenCardDisplay').classList.remove('hidden'); displayHiddenCard(); } else document.getElementById('hiddenCardDisplay').classList.add('hidden');
    
    displayRoundCards();
    updateActionButtons(isTestMode ? currentTestPlayer : playerPosition);

    // ROUND WINNER POPUP
    if (rs.roundWinnerInfo) {
        const popup = document.getElementById('roundResultPopup');
        const container = document.getElementById('roundWinnerCardContainer');
        const nameDiv = document.getElementById('roundWinnerName');
        
        popup.classList.remove('hidden');
        container.innerHTML = '';
        nameDiv.textContent = `Winner: ${getName(rs.roundWinnerInfo.winnerId)}`;
        const card = rs.roundWinnerInfo.card;
        const div = document.createElement('div');
        div.className = `card ${['hearts','diamonds'].includes(card.suit)?'red':'black'}`;
        div.innerHTML = `<div class="card-rank">${card.rank}</div><div class="card-suit">${SUITS[card.suit]}</div>`;
        container.appendChild(div);
    } else {
        document.getElementById('roundResultPopup').classList.add('hidden');
    }
    
  } else if (gameState.gameCompleted) { document.getElementById('playCardSection').classList.add('hidden'); document.getElementById('currentTurnInfo').classList.add('hidden'); }
  
  const targetP = isTestMode ? currentTestPlayer : playerPosition;
  if (gameState.hands[targetP]) displayPlayerCards(gameState.hands[targetP]);
  if (isTestMode) displayAllPlayersCards();
  if (gameState.gameStarted) document.getElementById('gameSection').classList.remove('hidden');
}

function displayPlayerCards(cards) {
  const container = document.getElementById('playerCards'); container.innerHTML = '';
  if (!cards || cards.length === 0) { container.innerHTML = `<p class="waiting-message">${gameState.gameCompleted ? "Game Over" : "No cards"}</p>`; return; }
  const sortedCards = sortHand([...cards]); 
  const targetPlayer = isTestMode ? currentTestPlayer : playerPosition;
  sortedCards.forEach(card => {
    const originalIndex = cards.findIndex(c => c.id === card.id);
    container.appendChild(createCardElement(card, originalIndex, targetPlayer));
  });
}

function createCardElement(card, index, playerId) {
  const div = document.createElement('div');
  div.className = `card ${['hearts','diamonds'].includes(card.suit)?'red':'black'}`;
  div.dataset.cardIndex = index; div.dataset.cardId = card.id;
  div.innerHTML = `<div class="card-rank">${card.rank}</div><div class="card-suit">${SUITS[card.suit]}</div><div class="card-rank-bottom">${card.rank}</div>`;
  const viewingPlayer = playerId;
  const isPlayable = canPlayCard(card, viewingPlayer);
  const canOpen = canOpenHiddenCard(viewingPlayer);
  if (gameState.roundState && gameState.roundState.currentTurn === viewingPlayer && !gameState.roundState.roundComplete && !gameState.gameCompleted) {
    if (isPlayable || canOpen) div.classList.add('playable'); else div.classList.add('not-playable');
  }
  div.addEventListener('click', () => {
    if (gameState.gameCompleted) return;
    if (gameState.roundState.currentTurn === playerId && !gameState.roundState.roundComplete && !gameState.roundState.roundWinnerInfo) {
      if (isPlayable) {
        document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
        div.classList.add('selected');
        document.getElementById('nextBtn').disabled = false;
        updateActionButtons(playerId);
      }
    }
  });
  return div;
}

function displayRoundCards() {
  const container = document.getElementById('roundCards');
  const rs = gameState.roundState;
  if (!rs || Object.keys(rs.cardsPlayed).length === 0) { document.getElementById('roundCardsSection').classList.add('hidden'); return; }
  document.getElementById('roundCardsSection').classList.remove('hidden');
  container.innerHTML = '';
  for (let i = 1; i <= TOTAL_PLAYERS; i++) {
    if (rs.cardsPlayed[i]) {
        const card = rs.cardsPlayed[i];
        const div = document.createElement('div');
        div.className = 'round-card-item';
        div.innerHTML = `<div class="player-name">${getName(i)}</div><div class="card mini ${['hearts','diamonds'].includes(card.suit)?'red':'black'}"><div class="card-rank">${card.rank}</div><div class="card-suit">${SUITS[card.suit]}</div></div>`;
        container.appendChild(div);
    }
  }
}

function displayHiddenCard() {
  const c = document.getElementById('hiddenCardContainer'); c.innerHTML = '';
  if (!gameState.hiddenCard) return;
  const card = gameState.hiddenCard;
  const d = document.createElement('div'); d.className = `card ${['hearts','diamonds'].includes(card.suit)?'red':'black'}`; d.style.cursor='default';
  d.innerHTML = `<div class="card-rank">${card.rank}</div><div class="card-suit">${SUITS[card.suit]}</div>`;
  c.appendChild(d);
}

function log(msg) {
  const l = document.getElementById('gameLog');
  const e = document.createElement('div'); e.className = 'log-entry';
  e.textContent = msg; l.appendChild(e); l.scrollTop = l.scrollHeight;
}

window.startGame = startGame; window.startNextGame = startNextGame; window.createHost = createHost; window.joinHost = joinHost; window.startTestMode = startTestMode; window.switchTestPlayer = switchTestPlayer; window.nextPlayer = nextPlayer; window.openHiddenCard = openHiddenCard; window.openSetupModal = openSetupModal; window.saveSetup = saveSetup; window.startTestMode = startTestMode;

// Logic Validations
function canPlayCard(card, playerId) {
  const rs = gameState.roundState;
  const hand = gameState.hands[playerId];
  
  // Rule: If just opened hidden card, MUST play Super Suit if available
  if (rs.justOpenedHidden) {
      const superSuit = gameState.superSuit;
      const hasSuper = hand.some(c => c.suit === superSuit);
      if (hasSuper) return card.suit === superSuit;
      // If doesn't have super suit, can play anything (Standard fallback)
      return true;
  }

  if (!rs.baseSuit) return true;
  if (hand.some(c => c.suit === rs.baseSuit)) return card.suit === rs.baseSuit;
  return true;
}

function canOpenHiddenCard(playerId) {
  const rs = gameState.roundState;
  const hand = gameState.hands[playerId];
  return rs.baseSuit && !hand.some(c => c.suit === rs.baseSuit) && !gameState.hiddenCardOpened && gameState.hiddenCard;
}

function saveSelectedCard(playerId, card, cardIndex) {
  if (gameState.gameCompleted) return;
  if (!isHost && !isTestMode) { sendPlayerAction({ type: 'selectCard', card, cardIndex }); return; }
  
  const rs = gameState.roundState;
  if (!rs.baseSuit) rs.baseSuit = card.suit;
  rs.cardsPlayed[playerId] = card;
  gameState.hands[playerId].splice(cardIndex, 1);
  rs.justOpenedHidden = false; // Reset mandatory flag after play
  
  document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
  document.getElementById('nextBtn').disabled = true;
  
  if (Object.keys(rs.cardsPlayed).length === TOTAL_PLAYERS) {
    rs.roundComplete = true; 
    rs.currentTurn = null; 
    
    // DELAY LOGIC: Calculate winner, show popup, wait 5s
    const winnerId = calculateRoundWinner();
    const winnerCard = rs.cardsPlayed[winnerId];
    rs.roundWinnerInfo = { winnerId, card: winnerCard }; // Trigger popup in updateGameDisplay
    
    updateGameDisplay();
    if (!isTestMode) broadcastToAll({ type: 'gameState', state: gameState });
    
    setTimeout(() => completeRound(), 5000); 
  } else {
    rs.currentTurn = (playerId % TOTAL_PLAYERS) + 1;
    if (isTestMode) switchTestPlayer(rs.currentTurn);
    updateGameDisplay();
    if (!isTestMode) broadcastToAll({ type: 'gameState', state: gameState });
  }
}

function nextPlayer() {
  const p = isTestMode ? currentTestPlayer : playerPosition;
  if (!gameState.roundState || gameState.roundState.currentTurn !== p) return;
  const sel = document.querySelector('.card.selected');
  if(!sel) return;
  const idx = parseInt(sel.dataset.cardIndex);
  const card = gameState.hands[p][idx];
  if(!canPlayCard(card, p)) return;
  saveSelectedCard(p, card, idx);
}

function openHiddenCard() {
  const p = isTestMode ? currentTestPlayer : playerPosition;
  if(!confirm("Open Hidden Card?")) return;
  if(!isHost && !isTestMode) { sendPlayerAction({type:'openHiddenCard'}); return; }
  
  gameState.superSuit = gameState.hiddenCard.suit;
  gameState.hiddenCardOpened = true;
  gameState.hiddenCardOpener = p;
  
  // Set flag for mandatory play next
  gameState.roundState.justOpenedHidden = true;
  
  const fp = (gameState.currentDistributor % TOTAL_PLAYERS) + 1;
  gameState.hands[fp].push(gameState.hiddenCard);
  updateGameDisplay();
  if(!isTestMode) broadcastToAll({type:'gameState', state: gameState});
}

// Test Mode Fix
function startTestMode() {
  log('Starting Test Mode...');
  isTestMode = true; isHost = true; playerPosition = 1; currentTestPlayer = 1;
  gameState.players = [1, 2, 3, 4, 5, 6];
  document.querySelector('.connection-section').style.display = 'none';
  document.getElementById('gameSection').classList.remove('hidden');
  document.getElementById('hostControls').classList.remove('hidden');
  document.getElementById('testModeSelector').classList.remove('hidden');
  document.getElementById('allPlayersCards').classList.remove('hidden');
  document.getElementById('playerPosition').textContent = ' - Player 1 (Test Host)';
  updateTestPlayerButtons();
  log('Test Mode activated.');
}
function switchTestPlayer(n) { 
    if(!isTestMode) return; currentTestPlayer=n; playerPosition=n; 
    const pName = gameState.config.playerNames[n];
    document.getElementById('playerPosition').textContent = ` - ${pName} (Test Mode)`;
    updateGameDisplay(); updateTestPlayerButtons(); document.getElementById('nextBtn').disabled=true;
}
function updateTestPlayerButtons() {
  document.querySelectorAll('.player-btn').forEach((btn, index) => {
    if (index + 1 === currentTestPlayer) btn.classList.add('active'); else btn.classList.remove('active');
  });
}
function displayAllPlayersCards() {
    const c = document.getElementById('allPlayersContainer'); c.innerHTML='';
    for(let i=1; i<=6; i++) {
        const hand = sortHand([...(gameState.hands[i]||[])]);
        const d = document.createElement('div'); d.className = `player-hand-view ${TEAM1_PLAYERS.includes(i)?'team1':'team2'}`;
        d.innerHTML = `<h4>${getName(i)}</h4>`;
        const cc = document.createElement('div'); cc.className='cards-container';
        hand.forEach(card => {
            const el = createCardElement(card, 0, i); el.style.pointerEvents='none'; cc.appendChild(el);
        });
        d.appendChild(cc); c.appendChild(d);
    }
}