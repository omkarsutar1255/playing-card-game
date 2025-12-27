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
  players: [], // Array of player IDs in order
  // Round state
  roundState: {
    currentTurn: null, // Player whose turn it is
    cardsPlayed: {}, // {playerId: card} - cards played this round
    baseSuit: null, // Suit of first card played (trump suit)
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

// Card ranking for comparison (2 is lowest, but not in deck, so 3 is lowest)
// Ranking: 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A
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
    log('Share this Room ID with other players');
    
    // Show host controls
    document.getElementById('hostControls').classList.remove('hidden');
    
    // Initialize host player position
    playerPosition = 1;
    gameState.players = [1]; // Host is always player 1
  });

  peer.on('connection', conn => {
    log(`New connection attempt...`);
    
    conn.on('open', () => {
      const playerNum = connections.length + 2; // Host is player 1, so next is 2, 3, etc.
      
      // Check if we already have 6 players
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
      
      // Send initial state to new player
      sendToPlayer(conn, {
        type: 'gameState',
        state: gameState,
        playerPosition: playerNum
      });
      
      // Broadcast updated player list to all
      broadcastToAll({
        type: 'playerJoined',
        playerId: playerNum,
        totalPlayers: connections.length + 1
      });
      
      // Update host status
      document.getElementById('hostStatus').textContent = 
        `${connections.length + 1} / ${TOTAL_PLAYERS} players connected`;
      
      // If we have 6 players, enable start game
      if (connections.length + 1 === TOTAL_PLAYERS) {
        log('All 6 players connected! Ready to start game.');
        document.getElementById('hostStatus').textContent = 'All players connected! Ready to start.';
        document.getElementById('hostStatus').style.color = 'green';
        
        // Show game section for host
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
      
      // Show game section
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
    
    // Remove from gameState.players
    const playerIndex = gameState.players.indexOf(removedPlayer);
    if (playerIndex !== -1) {
      gameState.players.splice(playerIndex, 1);
    }
    
    log(`Player ${removedPlayer} removed. Total players: ${connections.length + 1}`);
    
    // If game was in progress, might need to handle this
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
  
  // Shuffle deck
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
  
  // Distribution order: distributor + 1, distributor + 2, ..., distributor + 6, repeat
  let cardIndex = 0;
  let playerIndex = distributor; // Start from distributor
  
  while (cardIndex < TOTAL_CARDS) {
    playerIndex = (playerIndex % TOTAL_PLAYERS) + 1; // Next player clockwise
    hands[playerIndex].push(deck[cardIndex]);
    cardIndex++;
  }
  
  return hands;
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
  
  // Randomly pick initial distributor if not set
  if (!gameState.currentDistributor) {
    setRandomDistributor();
  }
  
  log('Starting game...');
  gameState.deck = createDeck();
  gameState.hands = distributeCards(gameState.deck, gameState.currentDistributor);
  gameState.currentRound = 1;
  gameState.gameStarted = true;
  
  // Reset points for new game
  gameState.team1Points = 0;
  gameState.team2Points = 0;
  gameState.team1Rounds = 0;
  gameState.team2Rounds = 0;
  
  // Initialize first round - first card shown by next player of distributor
  const firstPlayer = (gameState.currentDistributor % TOTAL_PLAYERS) + 1;
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
  
  // Show round controls
  document.getElementById('roundControls').classList.remove('hidden');
  
  log(`Game started! Distributor: Player ${gameState.currentDistributor}`);
  log(`Round ${gameState.currentRound} of ${ROUNDS_PER_GAME}`);
  log(`Player ${firstPlayer} starts the round (next player after distributor)`);
  
  if (isTestMode) {
    log('Test Mode: All players\' cards are displayed below. Switch between players to test.');
  }
}

function setDistributor() {
  if (!isHost && !isTestMode) {
    log('Only host can set distributor');
    return;
  }
  
  const distributor = parseInt(document.getElementById('distributorSelect').value);
  gameState.currentDistributor = distributor;
  log(`Initial distributor set to Player ${distributor}`);
  updateGameDisplay();
  
  if (!isTestMode) {
    broadcastToAll({
      type: 'gameState',
      state: gameState
    });
  }
}

function setRandomDistributor() {
  // Randomly pick initial distributor (1-6)
  gameState.currentDistributor = Math.floor(Math.random() * TOTAL_PLAYERS) + 1;
  log(`Random distributor selected: Player ${gameState.currentDistributor}`);
  updateGameDisplay();
  
  if (!isTestMode) {
    broadcastToAll({
      type: 'gameState',
      state: gameState
    });
  }
}

// ==================== Points System ====================

function updatePoints(winningTeam) {
  if (winningTeam === 1) {
    // Team1 wins → +5 points to Team1
    gameState.team1Points += 5;
    gameState.team1Rounds++;
  } else if (winningTeam === 2) {
    // Team2 wins → -10 points from Team1
    gameState.team1Points -= 10;
    gameState.team2Rounds++;
    
    // Check if points shift from Team1 to Team2
    if (gameState.team1Points < 0) {
      const negativePoints = Math.abs(gameState.team1Points);
      gameState.team2Points += negativePoints;
      gameState.team1Points = 0;
      
      // Distributor changes to next player in rotation (Team1)
      rotateDistributor();
      log(`Points shifted! Team2 now has ${gameState.team2Points} points`);
    }
  }
  
  // Check special rule: If Team2 exceeds 32 points
  if (gameState.team2Points > 32) {
    const excessPoints = gameState.team2Points - 32;
    gameState.team2Points = excessPoints;
    gameState.currentDistributor = 1; // Set to P1 (Team1)
    log(`Team2 exceeded 32 points! Keeping only ${excessPoints} points. Distributor set to P1`);
  }
  
  updateGameDisplay();
}

function rotateDistributor() {
  // Rotate to next player clockwise
  gameState.currentDistributor = (gameState.currentDistributor % TOTAL_PLAYERS) + 1;
  log(`Distributor rotated to Player ${gameState.currentDistributor}`);
}

function endRound(winningTeam) {
  if (!isHost && !isTestMode) {
    log('Only host can end rounds');
    return;
  }
  
  updatePoints(winningTeam);
  
  if (gameState.currentRound < ROUNDS_PER_GAME) {
    gameState.currentRound++;
    log(`Round ${gameState.currentRound} starting...`);
  } else {
    log('Game completed! Starting new game...');
    // Start new game with new distributor
    rotateDistributor();
    startGame();
  }
  
  if (!isTestMode) {
    broadcastToAll({
      type: 'gameState',
      state: gameState
    });
  }
}

// ==================== Message Handling ====================

function handleHostMessage(data, conn) {
  try {
    const message = typeof data === 'string' ? JSON.parse(data) : data;
    
    switch (message.type) {
      case 'playerAction':
        // Handle player actions (card plays, etc.)
        if (message.action.type === 'playCard') {
          const playerId = message.playerId;
          const card = message.action.card;
          const cardIndex = message.action.cardIndex;
          
          // Find the card in player's hand
          const playerHand = gameState.hands[playerId];
          if (playerHand) {
            const actualIndex = playerHand.findIndex(c => c.id === card.id);
            if (actualIndex !== -1) {
              playCard(playerId, card, actualIndex);
            }
          }
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
  
  if (!hostConnection || !hostConnection.open) {
    log('Not connected to host');
    return;
  }
  
  hostConnection.send(JSON.stringify({
    type: 'playerAction',
    action: action,
    playerId: playerPosition
  }));
}

// ==================== UI Updates ====================

function updateGameDisplay() {
  // Update points
  document.getElementById('team1Points').textContent = gameState.team1Points;
  document.getElementById('team2Points').textContent = gameState.team2Points;
  document.getElementById('team1Rounds').textContent = gameState.team1Rounds;
  document.getElementById('team2Rounds').textContent = gameState.team2Rounds;
  
  // Update distributor and round
  if (gameState.currentDistributor) {
    document.getElementById('currentDistributor').textContent = `Player ${gameState.currentDistributor}`;
  }
  document.getElementById('currentRound').textContent = gameState.currentRound;
  
  // Update round state
  if (gameState.gameStarted && gameState.roundState) {
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
    
    // Show cards played this round
    displayRoundCards();
    
    // Show play card section if it's player's turn
    const viewingPlayer = isTestMode ? currentTestPlayer : playerPosition;
    if (roundState.currentTurn === viewingPlayer && !roundState.roundComplete) {
      document.getElementById('playCardSection').classList.remove('hidden');
    } else {
      document.getElementById('playCardSection').classList.add('hidden');
    }
  }
  
  // Update player cards
  if (isTestMode) {
    // In test mode, show current test player's cards
    if (gameState.hands[currentTestPlayer]) {
      displayPlayerCards(gameState.hands[currentTestPlayer]);
    }
    // Also show all players' cards
    displayAllPlayersCards();
  } else if (playerPosition && gameState.hands[playerPosition]) {
    displayPlayerCards(gameState.hands[playerPosition]);
  }
  
  // Show game section if game started
  if (gameState.gameStarted) {
    document.getElementById('gameSection').classList.remove('hidden');
  }
}

function displayPlayerCards(cards, playerId = null) {
  const container = document.getElementById('playerCards');
  container.innerHTML = '';
  
  if (!cards || cards.length === 0) {
    container.innerHTML = '<p class="waiting-message">No cards yet. Waiting for game to start...</p>';
    return;
  }
  
  const targetPlayer = playerId || (isTestMode ? currentTestPlayer : playerPosition);
  
  cards.forEach((card, index) => {
    const cardElement = createCardElement(card, index, targetPlayer);
    container.appendChild(cardElement);
  });
  
  // If in test mode, also update all players view
  if (isTestMode) {
    displayAllPlayersCards();
  }
}

// ==================== Card Playing Logic ====================

let selectedCardIndex = null;

function playSelectedCard() {
  const viewingPlayer = isTestMode ? currentTestPlayer : playerPosition;
  
  if (!gameState.roundState || gameState.roundState.currentTurn !== viewingPlayer) {
    log('Not your turn!');
    return;
  }
  
  if (gameState.roundState.roundComplete) {
    log('Round is already complete!');
    return;
  }
  
  const selectedCard = document.querySelector('.card.selected');
  if (!selectedCard) {
    log('Please select a card first!');
    return;
  }
  
  const cardIndex = parseInt(selectedCard.dataset.cardIndex);
  const playerHand = gameState.hands[viewingPlayer];
  
  if (!playerHand || !playerHand[cardIndex]) {
    log('Invalid card selection!');
    return;
  }
  
  const card = playerHand[cardIndex];
  
  // Check if card can be played
  if (!canPlayCard(card, viewingPlayer)) {
    log(`Cannot play this card. Must follow suit if available.`);
    return;
  }
  
  // Play the card
  playCard(viewingPlayer, card, cardIndex);
}

function playCard(playerId, card, cardIndex) {
  if (!isHost && !isTestMode) {
    // Client sends action to host
    sendPlayerAction({
      type: 'playCard',
      card: card,
      cardIndex: cardIndex
    });
    return;
  }
  
  // Host processes the card play
  const roundState = gameState.roundState;
  
  // Set base suit if this is the first card
  if (!roundState.baseSuit) {
    roundState.baseSuit = card.suit;
    log(`Player ${playerId} played ${card.rank} ${SUITS[card.suit]} - Base suit is now ${card.suit}`);
  } else {
    log(`Player ${playerId} played ${card.rank} ${SUITS[card.suit]}`);
  }
  
  // Add card to played cards
  roundState.cardsPlayed[playerId] = card;
  
  // Remove card from player's hand
  gameState.hands[playerId].splice(cardIndex, 1);
  
  // Move to next player
  const nextPlayer = (playerId % TOTAL_PLAYERS) + 1;
  
  // Check if round is complete (all 6 players have played)
  if (Object.keys(roundState.cardsPlayed).length === TOTAL_PLAYERS) {
    roundState.roundComplete = true;
    roundState.currentTurn = null;
    log('Round complete! Calculating winner...');
    
    // Calculate winner and complete round
    setTimeout(() => {
      completeRound();
    }, 1000); // Small delay to show all cards
  } else {
    roundState.currentTurn = nextPlayer;
    log(`Next turn: Player ${nextPlayer}`);
  }
  
  updateGameDisplay();
  
  if (!isTestMode) {
    broadcastToAll({
      type: 'gameState',
      state: gameState
    });
  }
}

function calculateRoundWinner() {
  const roundState = gameState.roundState;
  const baseSuit = roundState.baseSuit;
  const cardsPlayed = roundState.cardsPlayed;
  
  // Find all cards of base suit
  const baseSuitCards = [];
  for (const [playerId, card] of Object.entries(cardsPlayed)) {
    if (card.suit === baseSuit) {
      baseSuitCards.push({
        playerId: parseInt(playerId),
        card: card
      });
    }
  }
  
  // If no base suit cards (shouldn't happen), return first player
  if (baseSuitCards.length === 0) {
    return parseInt(Object.keys(cardsPlayed)[0]);
  }
  
  // Find highest rank card of base suit
  let winner = baseSuitCards[0];
  for (const cardPlay of baseSuitCards) {
    const currentRank = CARD_RANK[winner.card.rank] || 0;
    const playRank = CARD_RANK[cardPlay.card.rank] || 0;
    
    if (playRank > currentRank) {
      winner = cardPlay;
    }
  }
  
  return winner.playerId;
}

function completeRound() {
  const winner = calculateRoundWinner();
  const winnerTeam = TEAM1_PLAYERS.includes(winner) ? 1 : 2;
  
  log(`Round ${gameState.currentRound} winner: Player ${winner} (Team ${winnerTeam})`);
  
  // Clear round state
  gameState.roundState.cardsPlayed = {};
  gameState.roundState.baseSuit = null;
  gameState.roundState.roundComplete = false;
  
  // Update points
  updatePoints(winnerTeam);
  
  // Check if game is complete
  if (gameState.currentRound >= ROUNDS_PER_GAME) {
    log('Game completed! Starting new game...');
    // Start new game with new distributor
    rotateDistributor();
    startGame();
    return;
  }
  
  // Start next round - winner starts next round
  gameState.currentRound++;
  const firstPlayer = winner; // Winner starts next round
  gameState.roundState.currentTurn = firstPlayer;
  
  log(`Round ${gameState.currentRound} starting. Player ${firstPlayer} begins.`);
  
  updateGameDisplay();
  
  if (!isTestMode) {
    broadcastToAll({
      type: 'gameState',
      state: gameState
    });
  }
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
  
  // Display cards in turn order
  let currentPlayer = roundState.currentTurn || Object.keys(roundState.cardsPlayed)[0];
  const playedOrder = [];
  
  // Find first player who played (should be the one after distributor for first round)
  if (gameState.currentRound === 1 && gameState.currentDistributor) {
    currentPlayer = (gameState.currentDistributor % TOTAL_PLAYERS) + 1;
  }
  
  // Build order of players who played
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

// ==================== Host-only Functions ====================

// Function for host to manually trigger round end (for testing)
// In real game, this would be triggered by game logic
function endRoundTest(winningTeam) {
  if (isHost) {
    endRound(winningTeam);
  } else {
    log('Only host can end rounds');
  }
}

// ==================== Test Mode Functions ====================

function startTestMode() {
  log('Starting Test Mode - Simulating all 6 players...');
  isTestMode = true;
  isHost = true;
  playerPosition = 1;
  currentTestPlayer = 1;
  
  // Initialize game state with all 6 players
  gameState.players = [1, 2, 3, 4, 5, 6];
  
  // Hide connection section, show game section
  document.querySelector('.connection-section').style.display = 'none';
  document.getElementById('gameSection').classList.remove('hidden');
  document.getElementById('hostControls').classList.remove('hidden');
  document.getElementById('testModeSelector').classList.remove('hidden');
  document.getElementById('allPlayersCards').classList.remove('hidden');
  
  // Set player position
  document.getElementById('playerPosition').textContent = 'Player 1 (Host) - Test Mode';
  document.getElementById('currentTestPlayer').textContent = 'Player 1';
  
  // Update player buttons
  updateTestPlayerButtons();
  
  log('Test Mode activated! All 6 players simulated.');
  log('You can switch between players using the buttons above.');
  log('Set distributor and start game to begin testing.');
}

function switchTestPlayer(playerNum) {
  if (!isTestMode) return;
  
  currentTestPlayer = playerNum;
  playerPosition = playerNum;
  
  document.getElementById('currentTestPlayer').textContent = `Player ${playerNum}`;
  document.getElementById('playerPosition').textContent = `Player ${playerNum}${playerNum === 1 ? ' (Host)' : ''} - Test Mode`;
  document.getElementById('playerCardsTitle').textContent = `Player ${playerNum} Cards`;
  
  // Update player buttons
  updateTestPlayerButtons();
  
  // Update displayed cards
  if (gameState.gameStarted && gameState.hands[playerNum]) {
    displayPlayerCards(gameState.hands[playerNum]);
  }
  
  log(`Switched to Player ${playerNum} view`);
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
  cardElement.dataset.cardSuit = card.suit;
  cardElement.dataset.cardRank = card.rank;
  if (playerId) {
    cardElement.dataset.playerId = playerId;
  }
  
  cardElement.innerHTML = `
    <div class="card-rank">${card.rank}</div>
    <div class="card-suit">${SUITS[card.suit]}</div>
    <div class="card-rank-bottom">${card.rank}</div>
  `;
  
  // Check if card is playable
  const viewingPlayer = playerId || (isTestMode ? currentTestPlayer : playerPosition);
  const isPlayable = canPlayCard(card, viewingPlayer);
  
  if (isPlayable && gameState.roundState && gameState.roundState.currentTurn === viewingPlayer && !gameState.roundState.roundComplete) {
    cardElement.classList.add('playable');
  } else if (gameState.roundState && gameState.roundState.currentTurn === viewingPlayer && !gameState.roundState.roundComplete) {
    cardElement.classList.add('not-playable');
  }
  
  cardElement.addEventListener('click', () => {
    const targetPlayer = playerId || (isTestMode ? currentTestPlayer : playerPosition);
    
    // Only allow selection if it's player's turn and card is playable
    if (gameState.roundState && gameState.roundState.currentTurn === targetPlayer && !gameState.roundState.roundComplete) {
      if (isPlayable) {
        // Deselect all other cards
        document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
        cardElement.classList.add('selected');
        document.getElementById('playCardBtn').disabled = false;
        log(`Selected card: ${card.rank} ${SUITS[card.suit]}`);
      } else {
        log(`Cannot play this card. Must follow suit if available.`);
      }
    } else if (!gameState.gameStarted || gameState.roundState.roundComplete) {
      // Just toggle selection for viewing
      cardElement.classList.toggle('selected');
    }
  });
  
  return cardElement;
}

function canPlayCard(card, playerId) {
  if (!gameState.roundState || !gameState.hands[playerId]) {
    return false;
  }
  
  const roundState = gameState.roundState;
  const playerHand = gameState.hands[playerId];
  
  // If no base suit set (first card), any card can be played
  if (!roundState.baseSuit) {
    return true;
  }
  
  // Check if player has cards of base suit
  const hasBaseSuit = playerHand.some(c => c.suit === roundState.baseSuit);
  
  // If player has base suit cards, must play one of them
  if (hasBaseSuit) {
    return card.suit === roundState.baseSuit;
  }
  
  // If player doesn't have base suit, can play any card
  return true;
}

// Expose functions globally
window.startGame = startGame;
window.setDistributor = setDistributor;
window.createHost = createHost;
window.joinHost = joinHost;
window.endRoundTest = endRoundTest;
window.startTestMode = startTestMode;
window.switchTestPlayer = switchTestPlayer;
window.playSelectedCard = playSelectedCard;
