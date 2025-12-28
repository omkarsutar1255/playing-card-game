// Game Constants
const TOTAL_PLAYERS = 6;
const CARDS_PER_PLAYER = 8;
const TOTAL_CARDS = 48; // 52 - 4 (all 2s)
const TEAM1_PLAYERS = [1, 3, 5];
const TEAM2_PLAYERS = [2, 4, 6];
const ROUNDS_PER_GAME = 8;

// Game State
let isHost = false;
let isTestMode = false;
let playerPosition = null;
let currentTestPlayer = 1; // For test mode player switching
let peer = null;
let hostConnection = null; // Client's connection to host
let connections = []; // Array of connections for host
let gameState = {
  deck: [],
  hands: {}, // {playerId: [cards]}
  team1Points: 0,
  team2Points: 0,
  team1Rounds: 0,
  team2Rounds: 0,
  currentDistributor: null,
  currentRound: 0,
  gameStarted: false,
  gameCompleted: false, // Track if current game is done
  players: [], // Array of player IDs in order
  hiddenCard: null, 
  superSuit: null, 
  hiddenCardOpened: false, 
  firstMoverTeam: null, // Team that makes first move (needs 5 wins)
  // Round state
  roundState: {
    currentTurn: null,
    cardsPlayed: {}, 
    baseSuit: null, 
    roundComplete: false
  }
};

// Suit symbols
const SUITS = {
  'hearts': '♥',
  'diamonds': '♦',
  'clubs': '♣',
  'spades': '♠'
};

// Card ranks (excluding 2)
const RANKS = ['A', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Card ranking for comparison
const CARD_RANK = {
  '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8,
  'J': 9, 'Q': 10, 'K': 11, 'A': 12
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  log('Game initialized. Create host or join a game.');
});

// ==================== P2P Connection Management ====================

function createHost() {
  log('Creating host...');
  isHost = true;
  playerPosition = 1;
  
  peer = new Peer(undefined, {
    debug: 2
  });

  peer.on('open', id => {
    document.getElementById('roomId').textContent = id;
    document.getElementById('hostStatus').textContent = 'Host created. Waiting for players...';
    document.getElementById('hostStatus').style.color = 'green';
    log(`Host ID: ${id}`);
    
    // Show host controls
    document.getElementById('hostControls').classList.remove('hidden');
    
    // Initialize host player position
    playerPosition = 1;
    gameState.players = [1]; // Host is always player 1
  });

  peer.on('connection', conn => {
    log(`New connection attempt...`);
    
    conn.on('open', () => {
      const playerNum = connections.length + 2; 
      
      if (connections.length + 1 >= TOTAL_PLAYERS) {
        log(`Game is full. Rejecting connection.`);
        conn.close();
        return;
      }
      
      connections.push({
        conn: conn,
        playerId: playerNum,
        peerId: conn.peer
      });
      
      log(`Player ${playerNum} connected (Peer ID: ${conn.peer})`);
      gameState.players.push(playerNum);
      
      sendToPlayer(conn, {
        type: 'gameState',
        state: gameState,
        playerPosition: playerNum
      });
      
      broadcastToAll({
        type: 'playerJoined',
        playerId: playerNum,
        totalPlayers: connections.length + 1
      });
      
      document.getElementById('hostStatus').textContent = 
        `${connections.length + 1} / ${TOTAL_PLAYERS} players connected`;
      
      if (connections.length + 1 === TOTAL_PLAYERS) {
        log('All 6 players connected! Ready to start game.');
        document.getElementById('hostStatus').textContent = 'All players connected! Ready to start.';
        document.getElementById('hostStatus').style.color = 'green';
        
        document.getElementById('gameSection').classList.remove('hidden');
        document.getElementById('playerPosition').textContent = 'Player 1 (Host)';
        updateGameDisplay();
      }
    });

    conn.on('data', data => {
      handleHostMessage(data, conn);
    });

    conn.on('close', () => {
      log(`Player disconnected`);
      removeConnection(conn);
      document.getElementById('hostStatus').textContent = 
        `${connections.length + 1} / ${TOTAL_PLAYERS} players connected`;
    });

    conn.on('error', err => {
      log(`Connection error: ${err}`);
    });
  });

  peer.on('error', err => {
    log(`Peer error: ${err}`);
  });
}

function joinHost() {
  const roomId = document.getElementById('joinId').value.trim();
  if (!roomId) {
    log('Enter Room ID first');
    return;
  }

  log('Joining host...');
  isHost = false;
  
  peer = new Peer(undefined, {
    debug: 2
  });

  peer.on('open', () => {
    log('My peer created, connecting...');
    hostConnection = peer.connect(roomId);

    hostConnection.on('open', () => {
      log('Connected to host');
      document.getElementById('clientStatus').textContent = 'Connected to host';
      document.getElementById('clientStatus').style.color = 'green';
      document.getElementById('gameSection').classList.remove('hidden');
    });

    hostConnection.on('data', data => {
      handleClientMessage(data);
    });

    hostConnection.on('error', err => {
      log(`Connection error: ${err}`);
    });

    hostConnection.on('close', () => {
      log('Connection to host closed');
      document.getElementById('clientStatus').textContent = 'Disconnected from host';
      document.getElementById('clientStatus').style.color = 'red';
    });
  });

  peer.on('error', err => {
    log(`Peer error: ${err}`);
  });
}

function removeConnection(conn) {
  const index = connections.findIndex(c => c.conn === conn);
  if (index !== -1) {
    const removedPlayer = connections[index].playerId;
    connections.splice(index, 1);
    
    const playerIndex = gameState.players.indexOf(removedPlayer);
    if (playerIndex !== -1) {
      gameState.players.splice(playerIndex, 1);
    }
    
    log(`Player ${removedPlayer} removed. Total players: ${connections.length + 1}`);
    if (gameState.gameStarted) {
      log('Warning: Player disconnected during active game!');
    }
  }
}

function sendToPlayer(conn, data) {
  if (conn && conn.open) {
    conn.send(JSON.stringify(data));
  }
}

function broadcastToAll(data) {
  connections.forEach(({ conn }) => {
    sendToPlayer(conn, data);
  });
}

// ==================== Game Logic ====================

function createDeck() {
  const deck = [];
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  suits.forEach(suit => {
    RANKS.forEach(rank => {
      deck.push({
        suit: suit,
        rank: rank,
        id: `${rank}-${suit}`
      });
    });
  });
  
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function distributeCards(deck, distributor) {
  const hands = {};
  for (let i = 1; i <= TOTAL_PLAYERS; i++) {
    hands[i] = [];
  }
  let cardIndex = 0;
  let playerIndex = distributor;
  
  while (cardIndex < TOTAL_CARDS) {
    playerIndex = (playerIndex % TOTAL_PLAYERS) + 1;
    hands[playerIndex].push(deck[cardIndex]);
    cardIndex++;
  }
  return hands;
}

function startNextGame() {
    if (!isHost && !isTestMode) return;
    
    rotateDistributor();
    startGame();
}

function startGame() {
  if (!isHost && !isTestMode) {
    log('Only host can start the game');
    return;
  }
  
  if (!isTestMode && connections.length + 1 < TOTAL_PLAYERS) {
    log(`Need ${TOTAL_PLAYERS} players. Currently: ${connections.length + 1}`);
    return;
  }
  
  // Set distributor if not set
  if (!gameState.currentDistributor) {
    setRandomDistributor();
  }
  
  log('Starting game...');
  gameState.deck = createDeck();
  gameState.hands = distributeCards(gameState.deck, gameState.currentDistributor);
  gameState.currentRound = 1;
  gameState.gameStarted = true;
  gameState.gameCompleted = false;
  
  // Reset rounds won for new game
  gameState.team1Rounds = 0;
  gameState.team2Rounds = 0;
  
  // Reset super suit
  gameState.superSuit = null;
  gameState.hiddenCardOpened = false;
  
  // Hide Start Game, Show Next Game when finished
  document.getElementById('startGameBtn').classList.add('hidden');
  document.getElementById('nextGameButton').classList.add('hidden');

  // Determine First Player and First Mover Team
  const firstPlayer = (gameState.currentDistributor % TOTAL_PLAYERS) + 1;
  gameState.firstMoverTeam = TEAM1_PLAYERS.includes(firstPlayer) ? 1 : 2;
  
  // Randomly select one card to hide from first player
  if (gameState.hands[firstPlayer] && gameState.hands[firstPlayer].length > 0) {
    const hiddenIndex = Math.floor(Math.random() * gameState.hands[firstPlayer].length);
    gameState.hiddenCard = gameState.hands[firstPlayer][hiddenIndex];
    gameState.hands[firstPlayer].splice(hiddenIndex, 1);
    log(`One card hidden from Player ${firstPlayer}. Hidden card will be revealed when opened.`);
  }

  gameState.roundState = {
    currentTurn: firstPlayer,
    cardsPlayed: {},
    baseSuit: null,
    roundComplete: false
  };
  
  updateGameDisplay();
  
  if (!isTestMode) {
    broadcastToAll({
      type: 'gameState',
      state: gameState
    });
  }
  
  document.getElementById('roundControls').classList.remove('hidden');
  
  log(`Game started! Distributor: Player ${gameState.currentDistributor}`);
  log(`First Player: ${firstPlayer} (Team ${gameState.firstMoverTeam})`);
  log(`Team ${gameState.firstMoverTeam} is Attacker (Needs 5 wins). Team ${gameState.firstMoverTeam === 1 ? 2 : 1} is Defender (Needs 4 wins).`);
  
  if (isTestMode) {
    switchTestPlayer(firstPlayer);
    log('Test Mode: Auto-switching to current player.');
  }
}

function setRandomDistributor() {
  gameState.currentDistributor = Math.floor(Math.random() * TOTAL_PLAYERS) + 1;
  log(`Random distributor selected: Player ${gameState.currentDistributor}`);
}

function rotateDistributor() {
  if (gameState.currentDistributor) {
    gameState.currentDistributor = (gameState.currentDistributor % TOTAL_PLAYERS) + 1;
  } else {
    gameState.currentDistributor = Math.floor(Math.random() * TOTAL_PLAYERS) + 1;
  }
  log(`Distributor for new game: Player ${gameState.currentDistributor}`);
}

function updateRoundsWon(winningTeam) {
  if (winningTeam === 1) {
    gameState.team1Rounds++;
    log(`Team 1 wins round ${gameState.currentRound}. Total rounds: ${gameState.team1Rounds}`);
  } else if (winningTeam === 2) {
    gameState.team2Rounds++;
    log(`Team 2 wins round ${gameState.currentRound}. Total rounds: ${gameState.team2Rounds}`);
  }
  
  updateGameDisplay();
}

function checkGameWinner() {
  const firstMover = gameState.firstMoverTeam;
  const team1 = 1;
  const team2 = 2;
  
  let gameWinner = null;
  
  // Logic: First Mover (Attacker) needs 5 wins. Defender needs 4 wins.
  
  if (firstMover === team1) {
    // Team 1 needs 5, Team 2 needs 4
    if (gameState.team1Rounds >= 5) gameWinner = team1;
    else if (gameState.team2Rounds >= 4) gameWinner = team2;
  } else {
    // Team 2 needs 5, Team 1 needs 4
    if (gameState.team2Rounds >= 5) gameWinner = team2;
    else if (gameState.team1Rounds >= 4) gameWinner = team1;
  }
  
  if (gameWinner) {
    log(`*** GAME OVER ***`);
    log(`Team ${gameWinner} wins the Game! (Reached required wins first)`);
    endGame(gameWinner);
    return true; // Game Ended
  }
  
  return false; // Game Continues
}

function calculateGamePoints(winningTeam) {
  // Logic: +5 for win, -10 if opponent had points previously
  // "Next Game" button enablement is handled in endGame()
  
  // Identify losing team
  const losingTeam = winningTeam === 1 ? 2 : 1;
  
  if (winningTeam === 1) {
    // Team 1 Won
    if (gameState.team2Points === 0) {
      gameState.team1Points += 5;
      log(`Team 1 gets +5 points. New Score: ${gameState.team1Points}`);
    } else {
      const reduction = Math.min(10, gameState.team2Points);
      gameState.team2Points -= reduction;
      gameState.team1Points += reduction;
      log(`Team 1 steals ${reduction} points from Team 2.`);
    }
  } else {
    // Team 2 Won
    if (gameState.team1Points === 0) {
      gameState.team2Points += 5;
      log(`Team 2 gets +5 points. New Score: ${gameState.team2Points}`);
    } else {
      const reduction = Math.min(10, gameState.team1Points);
      gameState.team1Points -= reduction;
      gameState.team2Points += reduction;
      log(`Team 2 steals ${reduction} points from Team 1.`);
    }
  }

  // Special Rule: Team 2 Overflow
  if (gameState.team2Points > 32) {
    const excess = gameState.team2Points - 32;
    gameState.team2Points = excess;
    gameState.currentDistributor = 1; // Reset distributor logic
    log(`Team 2 exceeded 32 points! Resetting to ${excess}. Distributor resets to P1.`);
  }
}

function endGame(winningTeam) {
  gameState.gameCompleted = true;
  gameState.roundState.roundComplete = true; // Stop any further moves
  
  calculateGamePoints(winningTeam);
  updateGameDisplay();
  
  // Show Next Game Button for Host
  if (isHost) {
    document.getElementById('nextGameButton').classList.remove('hidden');
    document.getElementById('startGameBtn').classList.add('hidden'); // Ensure Start is hidden
  }
  
  log('Game Complete. Waiting for host to start next game.');
  
  if (!isTestMode) {
    broadcastToAll({
      type: 'gameState',
      state: gameState
    });
  }
}

function completeRound() {
  const winner = calculateRoundWinner();
  const winnerTeam = TEAM1_PLAYERS.includes(winner) ? 1 : 2;
  
  log(`Round ${gameState.currentRound} winner: Player ${winner} (Team ${winnerTeam})`);
  
  // Update round counters
  updateRoundsWon(winnerTeam);
  
  // Clear round state
  gameState.roundState.cardsPlayed = {};
  gameState.roundState.baseSuit = null;
  gameState.roundState.roundComplete = false;
  
  // Check if Game is Won based on new rules (5 vs 4)
  const isGameFinished = checkGameWinner();
  
  if (isGameFinished) {
    return; // Stop processing round logic
  }

  // If game not finished but rounds exhausted (Should imply someone won, but safe check)
  if (gameState.currentRound >= ROUNDS_PER_GAME) {
    // This implies a 4-4 tie where neither met target? 
    // If Attacker needs 5 and fails, Defender (needs 4) wins automatically.
    // checkGameWinner should have caught this.
    log('All 8 rounds complete.');
    return;
  }
  
  // Start next round
  gameState.currentRound++;
  const firstPlayer = winner;
  gameState.roundState.currentTurn = firstPlayer;
  
  log(`Round ${gameState.currentRound} starting. Player ${firstPlayer} begins.`);
  
  if (isTestMode) {
    switchTestPlayer(firstPlayer);
  }
  
  updateGameDisplay();
  
  if (!isTestMode) {
    broadcastToAll({
      type: 'gameState',
      state: gameState
    });
  }
}

// ==================== Message Handling & UI ====================

function handleHostMessage(data, conn) {
  try {
    const message = typeof data === 'string' ? JSON.parse(data) : data;
    switch (message.type) {
      case 'playerAction':
        if (message.action.type === 'selectCard') {
          // Validation: Don't accept moves if game completed
          if (gameState.gameCompleted) return;
          
          const playerId = message.playerId;
          const card = message.action.card;
          const cardIndex = message.action.cardIndex;
          const playerHand = gameState.hands[playerId];
          if (playerHand) {
            const actualIndex = playerHand.findIndex(c => c.id === card.id);
            if (actualIndex !== -1) {
              saveSelectedCard(playerId, card, actualIndex);
            }
          }
        } else if (message.action.type === 'openHiddenCard') {
            if (gameState.gameCompleted) return;
            openHiddenCard();
        }
        break;
      default:
        log(`Unknown message type: ${message.type}`);
    }
  } catch (e) {
    log(`Error handling message: ${e}`);
  }
}

function handleClientMessage(data) {
  try {
    const message = typeof data === 'string' ? JSON.parse(data) : data;
    switch (message.type) {
      case 'gameState':
        if (message.playerPosition) {
          playerPosition = message.playerPosition;
          document.getElementById('playerPosition').textContent = `Player ${playerPosition}`;
        }
        gameState = message.state;
        updateGameDisplay();
        break;
      case 'playerJoined':
        log(`Player ${message.playerId} joined. Total: ${message.totalPlayers}`);
        break;
      default:
        log(`Unknown message type: ${message.type}`);
    }
  } catch (e) {
    log(`Error handling message: ${e}`);
  }
}

function sendPlayerAction(action) {
  if (isHost) {
    log('Host cannot send player actions');
    return;
  }
  if (!hostConnection || !hostConnection.open) return;
  
  hostConnection.send(JSON.stringify({
    type: 'playerAction',
    action: action,
    playerId: playerPosition
  }));
}

function updateGameDisplay() {
  // Update points and rounds
  document.getElementById('team1Points').textContent = gameState.team1Points;
  document.getElementById('team2Points').textContent = gameState.team2Points;
  document.getElementById('team1Rounds').textContent = gameState.team1Rounds;
  document.getElementById('team2Rounds').textContent = gameState.team2Rounds;
  
  // Update Targets UI
  const t1Target = document.getElementById('team1Target');
  const t2Target = document.getElementById('team2Target');
  
  if (gameState.gameStarted && gameState.firstMoverTeam) {
    t1Target.classList.remove('hidden');
    t2Target.classList.remove('hidden');
    
    if (gameState.firstMoverTeam === 1) {
      t1Target.textContent = 'Target: 5 (Attacker)';
      t1Target.style.fontWeight = 'bold';
      t2Target.textContent = 'Target: 4 (Defender)';
      t2Target.style.fontWeight = 'normal';
    } else {
      t2Target.textContent = 'Target: 5 (Attacker)';
      t2Target.style.fontWeight = 'bold';
      t1Target.textContent = 'Target: 4 (Defender)';
      t1Target.style.fontWeight = 'normal';
    }
  } else {
    t1Target.classList.add('hidden');
    t2Target.classList.add('hidden');
  }

  if (gameState.currentDistributor) {
    document.getElementById('currentDistributor').textContent = `Player ${gameState.currentDistributor}`;
  }
  document.getElementById('currentRound').textContent = gameState.currentRound;
  
  // Show Next Game Button logic for Clients (Host handled in logic, but refresh helps)
  // Only Host controls are visible anyway via CSS
  if (gameState.gameCompleted && isHost) {
      document.getElementById('nextGameButton').classList.remove('hidden');
      document.getElementById('startGameBtn').classList.add('hidden');
  }

  // Round State Updates
  if (gameState.gameStarted && gameState.roundState && !gameState.gameCompleted) {
    const roundState = gameState.roundState;
    
    if (roundState.currentTurn) {
      document.getElementById('currentTurnInfo').classList.remove('hidden');
      document.getElementById('currentTurn').textContent = `Player ${roundState.currentTurn}`;
    }
    
    if (roundState.baseSuit) {
      document.getElementById('baseSuitInfo').classList.remove('hidden');
      document.getElementById('baseSuit').textContent = `${roundState.baseSuit} ${SUITS[roundState.baseSuit]}`;
    } else {
      document.getElementById('baseSuitInfo').classList.add('hidden');
    }
    
    if (gameState.superSuit) {
      document.getElementById('superSuitInfo').classList.remove('hidden');
      document.getElementById('superSuit').textContent = `${gameState.superSuit} ${SUITS[gameState.superSuit]}`;
    } else {
      document.getElementById('superSuitInfo').classList.add('hidden');
    }
    
    if (gameState.hiddenCardOpened && gameState.hiddenCard) {
      document.getElementById('hiddenCardDisplay').classList.remove('hidden');
      displayHiddenCard();
    } else {
      document.getElementById('hiddenCardDisplay').classList.add('hidden');
    }
    
    displayRoundCards();
    
    // Play Card Interaction
    const viewingPlayer = isTestMode ? currentTestPlayer : playerPosition;
    if (roundState.currentTurn === viewingPlayer && !roundState.roundComplete) {
      document.getElementById('playCardSection').classList.remove('hidden');
      
      if (canOpenHiddenCard(viewingPlayer)) {
        const selectedCard = document.querySelector('.card.selected');
        if (selectedCard) {
          const cardIndex = parseInt(selectedCard.dataset.cardIndex);
          const playerHand = gameState.hands[viewingPlayer];
          if (playerHand && playerHand[cardIndex]) {
            const card = playerHand[cardIndex];
            if (!canPlayCard(card, viewingPlayer)) {
              document.getElementById('openHiddenCardSection').classList.remove('hidden');
            } else {
              document.getElementById('openHiddenCardSection').classList.add('hidden');
            }
          }
        } else {
          document.getElementById('openHiddenCardSection').classList.remove('hidden');
        }
      } else {
        document.getElementById('openHiddenCardSection').classList.add('hidden');
      }
    } else {
      document.getElementById('playCardSection').classList.add('hidden');
      document.getElementById('openHiddenCardSection').classList.add('hidden');
    }
  } else if (gameState.gameCompleted) {
      // Game Over State UI
      document.getElementById('playCardSection').classList.add('hidden');
      document.getElementById('currentTurnInfo').classList.add('hidden');
  }
  
  // Cards Display
  if (isTestMode) {
    if (gameState.hands[currentTestPlayer]) {
      displayPlayerCards(gameState.hands[currentTestPlayer]);
    }
    displayAllPlayersCards();
  } else if (playerPosition && gameState.hands[playerPosition]) {
    displayPlayerCards(gameState.hands[playerPosition]);
  }
  
  if (gameState.gameStarted) {
    document.getElementById('gameSection').classList.remove('hidden');
  }
}

function displayPlayerCards(cards, playerId = null) {
  const container = document.getElementById('playerCards');
  container.innerHTML = '';
  
  if (!cards || cards.length === 0) {
    const msg = gameState.gameCompleted ? "Game Over. Waiting for next game." : "No cards left.";
    container.innerHTML = `<p class="waiting-message">${msg}</p>`;
    return;
  }
  
  const targetPlayer = playerId || (isTestMode ? currentTestPlayer : playerPosition);
  cards.forEach((card, index) => {
    const cardElement = createCardElement(card, index, targetPlayer);
    container.appendChild(cardElement);
  });
  
  if (isTestMode) {
    displayAllPlayersCards();
  }
}

function calculateRoundWinner() {
  const roundState = gameState.roundState;
  const baseSuit = roundState.baseSuit;
  const superSuit = gameState.superSuit;
  const cardsPlayed = roundState.cardsPlayed;
  
  const superSuitCards = [];
  if (superSuit) {
    for (const [playerId, card] of Object.entries(cardsPlayed)) {
      if (card.suit === superSuit) {
        superSuitCards.push({ playerId: parseInt(playerId), card: card });
      }
    }
  }
  
  if (superSuitCards.length > 0) {
    let winner = superSuitCards[0];
    for (const cardPlay of superSuitCards) {
      if (CARD_RANK[cardPlay.card.rank] > CARD_RANK[winner.card.rank]) {
        winner = cardPlay;
      }
    }
    return winner.playerId;
  }
  
  const baseSuitCards = [];
  for (const [playerId, card] of Object.entries(cardsPlayed)) {
    if (card.suit === baseSuit) {
      baseSuitCards.push({ playerId: parseInt(playerId), card: card });
    }
  }
  
  if (baseSuitCards.length === 0) return parseInt(Object.keys(cardsPlayed)[0]);
  
  let winner = baseSuitCards[0];
  for (const cardPlay of baseSuitCards) {
    if (CARD_RANK[cardPlay.card.rank] > CARD_RANK[winner.card.rank]) {
      winner = cardPlay;
    }
  }
  
  return winner.playerId;
}

// Display logic helpers (Hidden Card, Round Cards, Test Mode Views) kept largely same but omitted for brevity if no logic change.
// Ensuring they are present in full file context:

function displayHiddenCard() {
  const container = document.getElementById('hiddenCardContainer');
  container.innerHTML = '';
  if (!gameState.hiddenCard) return;
  const card = gameState.hiddenCard;
  const cardElement = document.createElement('div');
  cardElement.className = 'card';
  cardElement.classList.add(card.suit === 'hearts' || card.suit === 'diamonds' ? 'red' : 'black');
  cardElement.style.cursor = 'default';
  cardElement.innerHTML = `
    <div class="card-rank">${card.rank}</div>
    <div class="card-suit">${SUITS[card.suit]}</div>
    <div class="card-rank-bottom">${card.rank}</div>
  `;
  container.appendChild(cardElement);
}

function displayRoundCards() {
  const container = document.getElementById('roundCards');
  const roundState = gameState.roundState;
  
  if (!roundState || Object.keys(roundState.cardsPlayed).length === 0) {
    document.getElementById('roundCardsSection').classList.add('hidden');
    return;
  }
  
  document.getElementById('roundCardsSection').classList.remove('hidden');
  container.innerHTML = '';
  
  let currentPlayer = roundState.currentTurn || Object.keys(roundState.cardsPlayed)[0];
  const playedOrder = [];
  
  if (gameState.currentRound === 1 && gameState.currentDistributor) {
    currentPlayer = (gameState.currentDistributor % TOTAL_PLAYERS) + 1;
  }
  
  for (let i = 0; i < TOTAL_PLAYERS; i++) {
    const playerId = ((currentPlayer - 1 + i) % TOTAL_PLAYERS) + 1;
    if (roundState.cardsPlayed[playerId]) {
      playedOrder.push(playerId);
    }
  }
  
  playedOrder.forEach(playerId => {
    const card = roundState.cardsPlayed[playerId];
    const isTeam1 = TEAM1_PLAYERS.includes(playerId);
    const cardItem = document.createElement('div');
    cardItem.className = 'round-card-item';
    cardItem.innerHTML = `
      <h4>Player ${playerId} ${isTeam1 ? '(Team 1)' : '(Team 2)'}</h4>
      <div class="card ${card.suit === 'hearts' || card.suit === 'diamonds' ? 'red' : 'black'}" style="margin: 0 auto;">
        <div class="card-rank">${card.rank}</div>
        <div class="card-suit">${SUITS[card.suit]}</div>
        <div class="card-rank-bottom">${card.rank}</div>
      </div>
    `;
    container.appendChild(cardItem);
  });
}

function log(message) {
  const logElement = document.getElementById('gameLog');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logElement.appendChild(entry);
  logElement.scrollTop = logElement.scrollHeight;
  console.log(message);
}

// ==================== Test Mode Functions ====================

function startTestMode() {
  log('Starting Test Mode - Simulating all 6 players...');
  isTestMode = true;
  isHost = true;
  playerPosition = 1;
  currentTestPlayer = 1;
  gameState.players = [1, 2, 3, 4, 5, 6];
  
  document.querySelector('.connection-section').style.display = 'none';
  document.getElementById('gameSection').classList.remove('hidden');
  document.getElementById('hostControls').classList.remove('hidden');
  document.getElementById('testModeSelector').classList.remove('hidden');
  document.getElementById('allPlayersCards').classList.remove('hidden');
  
  document.getElementById('playerPosition').textContent = 'Player 1 (Host) - Test Mode';
  document.getElementById('currentTestPlayer').textContent = 'Player 1';
  
  updateTestPlayerButtons();
  log('Test Mode activated. Click "Start Game".');
}

function switchTestPlayer(playerNum) {
  if (!isTestMode) return;
  currentTestPlayer = playerNum;
  playerPosition = playerNum;
  document.getElementById('currentTestPlayer').textContent = `Player ${playerNum}`;
  document.getElementById('playerPosition').textContent = `Player ${playerNum}${playerNum === 1 ? ' (Host)' : ''} - Test Mode`;
  document.getElementById('playerCardsTitle').textContent = `Player ${playerNum} Cards`;
  updateTestPlayerButtons();
  document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
  
  const nextBtn = document.getElementById('nextBtn');
  if (nextBtn && gameState.roundState) {
    if (gameState.roundState.currentTurn === playerNum && !gameState.roundState.roundComplete && !gameState.gameCompleted) {
      nextBtn.disabled = true; 
    } else {
      nextBtn.disabled = true;
    }
  }
  
  if (gameState.gameStarted && gameState.hands[playerNum]) {
    displayPlayerCards(gameState.hands[playerNum]);
  }
  updateGameDisplay();
}

function updateTestPlayerButtons() {
  const buttons = document.querySelectorAll('.player-btn');
  buttons.forEach((btn, index) => {
    if (index + 1 === currentTestPlayer) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function displayAllPlayersCards() {
  if (!isTestMode || !gameState.gameStarted) return;
  const container = document.getElementById('allPlayersContainer');
  container.innerHTML = '';
  for (let i = 1; i <= TOTAL_PLAYERS; i++) {
    const playerHand = gameState.hands[i] || [];
    const isTeam1 = TEAM1_PLAYERS.includes(i);
    const playerView = document.createElement('div');
    playerView.className = `player-hand-view ${isTeam1 ? 'team1' : 'team2'}`;
    const title = document.createElement('h4');
    title.textContent = `Player ${i} ${isTeam1 ? '(Team 1)' : '(Team 2)'}`;
    playerView.appendChild(title);
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'cards-container';
    cardsContainer.style.minHeight = '120px';
    if (playerHand.length === 0) {
      cardsContainer.innerHTML = '<p class="waiting-message">No cards</p>';
    } else {
      playerHand.forEach((card, index) => {
        const cardElement = createCardElement(card, index, i);
        cardsContainer.appendChild(cardElement);
      });
    }
    playerView.appendChild(cardsContainer);
    container.appendChild(playerView);
  }
}

function createCardElement(card, index, playerId = null) {
  const cardElement = document.createElement('div');
  cardElement.className = 'card';
  cardElement.classList.add(card.suit === 'hearts' || card.suit === 'diamonds' ? 'red' : 'black');
  cardElement.dataset.cardIndex = index;
  cardElement.dataset.cardId = card.id;
  
  cardElement.innerHTML = `
    <div class="card-rank">${card.rank}</div>
    <div class="card-suit">${SUITS[card.suit]}</div>
    <div class="card-rank-bottom">${card.rank}</div>
  `;
  
  const viewingPlayer = playerId || (isTestMode ? currentTestPlayer : playerPosition);
  const isPlayable = canPlayCard(card, viewingPlayer);
  const canOpen = canOpenHiddenCard(viewingPlayer);
  
  if (gameState.roundState && gameState.roundState.currentTurn === viewingPlayer && !gameState.roundState.roundComplete && !gameState.gameCompleted) {
    if (isPlayable || canOpen) {
      cardElement.classList.add('playable');
    } else {
      cardElement.classList.add('not-playable');
    }
  }
  
  cardElement.addEventListener('click', () => {
    const targetPlayer = playerId || (isTestMode ? currentTestPlayer : playerPosition);
    if (gameState.gameCompleted) return;
    
    if (gameState.roundState && gameState.roundState.currentTurn === targetPlayer && !gameState.roundState.roundComplete) {
      if (isPlayable) {
        document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
        cardElement.classList.add('selected');
        const nextBtn = document.getElementById('nextBtn');
        if (nextBtn) nextBtn.disabled = false;
      }
    }
  });
  return cardElement;
}

function canPlayCard(card, playerId) {
  if (!gameState.roundState || !gameState.hands[playerId]) return false;
  const roundState = gameState.roundState;
  const playerHand = gameState.hands[playerId];
  if (!roundState.baseSuit) return true;
  const hasBaseSuit = playerHand.some(c => c.suit === roundState.baseSuit);
  if (hasBaseSuit) return card.suit === roundState.baseSuit;
  return true;
}

function canOpenHiddenCard(playerId) {
  if (!gameState.roundState || !gameState.hands[playerId]) return false;
  const roundState = gameState.roundState;
  const playerHand = gameState.hands[playerId];
  return roundState.baseSuit && 
         !playerHand.some(c => c.suit === roundState.baseSuit) &&
         !gameState.hiddenCardOpened &&
         gameState.hiddenCard !== null;
}

// Function to handle card selection and next player
function saveSelectedCard(playerId, card, cardIndex) {
  if (gameState.gameCompleted) return; // Guard clause
  
  if (!isHost && !isTestMode) {
    sendPlayerAction({
      type: 'selectCard',
      card: card,
      cardIndex: cardIndex
    });
    return;
  }
  
  const roundState = gameState.roundState;
  if (!roundState.baseSuit) {
    roundState.baseSuit = card.suit;
    log(`Player ${playerId} selected ${card.rank} ${SUITS[card.suit]} - Base suit is now ${card.suit}`);
  } else {
    log(`Player ${playerId} selected ${card.rank} ${SUITS[card.suit]}`);
  }
  
  roundState.cardsPlayed[playerId] = card;
  gameState.hands[playerId].splice(cardIndex, 1);
  
  document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
  document.getElementById('nextBtn').disabled = true;
  
  // Check round completion
  if (Object.keys(roundState.cardsPlayed).length === TOTAL_PLAYERS) {
    roundState.roundComplete = true;
    roundState.currentTurn = null;
    setTimeout(() => completeRound(), 500);
  } else {
    // Determine next player (clockwise)
    let nextPlayer = (playerId % TOTAL_PLAYERS) + 1;
    roundState.currentTurn = nextPlayer;
    if (isTestMode) switchTestPlayer(nextPlayer);
  }
  
  updateGameDisplay();
  if (!isTestMode) {
    broadcastToAll({
      type: 'gameState',
      state: gameState
    });
  }
}

// Next Player button handler
function nextPlayer() {
  const viewingPlayer = isTestMode ? currentTestPlayer : playerPosition;
  if (!gameState.roundState || gameState.roundState.currentTurn !== viewingPlayer || gameState.gameCompleted) return;
  
  const selectedCard = document.querySelector('.card.selected');
  if (!selectedCard) {
    log('Please select a card first!');
    return;
  }
  
  const cardIndex = parseInt(selectedCard.dataset.cardIndex);
  const playerHand = gameState.hands[viewingPlayer];
  const card = playerHand[cardIndex];
  
  if (!canPlayCard(card, viewingPlayer)) {
    log(`Cannot play this card. Must follow suit if available.`);
    return;
  }
  
  if (canOpenHiddenCard(viewingPlayer)) {
    window.pendingCardSelection = { card, cardIndex, playerId: viewingPlayer };
    document.getElementById('openHiddenCardSection').classList.remove('hidden');
    document.getElementById('nextBtn').disabled = true;
    return;
  }
  
  saveSelectedCard(viewingPlayer, card, cardIndex);
}

function openHiddenCard() {
    const viewingPlayer = isTestMode ? currentTestPlayer : playerPosition;
    if (gameState.gameCompleted) return;
    
    if (!isHost && !isTestMode) {
        sendPlayerAction({ type: 'openHiddenCard' });
        return;
    }
    
    gameState.superSuit = gameState.hiddenCard.suit;
    gameState.hiddenCardOpened = true;
    
    // Give card to first player
    const firstPlayer = (gameState.currentDistributor % TOTAL_PLAYERS) + 1;
    gameState.hands[firstPlayer].push(gameState.hiddenCard);
    
    log(`Player ${viewingPlayer} opened hidden card! Super Suit: ${gameState.superSuit}`);
    
    // If pending selection exists
    if (window.pendingCardSelection && window.pendingCardSelection.playerId === viewingPlayer) {
        const { card, cardIndex } = window.pendingCardSelection;
        delete window.pendingCardSelection;
        saveSelectedCard(viewingPlayer, card, cardIndex);
    } else {
        updateGameDisplay();
    }
    
    if (!isTestMode) broadcastToAll({ type: 'gameState', state: gameState });
}

function skipHiddenCard() {
    const viewingPlayer = isTestMode ? currentTestPlayer : playerPosition;
    document.getElementById('openHiddenCardSection').classList.add('hidden');
    if (window.pendingCardSelection && window.pendingCardSelection.playerId === viewingPlayer) {
        const { card, cardIndex } = window.pendingCardSelection;
        delete window.pendingCardSelection;
        saveSelectedCard(viewingPlayer, card, cardIndex);
    }
}

// Global Exports
window.startGame = startGame;
window.startNextGame = startNextGame;
window.createHost = createHost;
window.joinHost = joinHost;
window.startTestMode = startTestMode;
window.switchTestPlayer = switchTestPlayer;
window.nextPlayer = nextPlayer;
window.openHiddenCard = openHiddenCard;
window.skipHiddenCard = skipHiddenCard;