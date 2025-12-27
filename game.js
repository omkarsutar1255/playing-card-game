// Game Constants
const TOTAL_PLAYERS = 6;
const CARDS_PER_PLAYER = 8;
const TOTAL_CARDS = 48; // 52 - 4 (all 2s)
const TEAM1_PLAYERS = [1, 3, 5];
const TEAM2_PLAYERS = [2, 4, 6];
const ROUNDS_PER_GAME = 8;

// Game State
let isHost = false;
let playerPosition = null;
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
  players: [] // Array of player IDs in order
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
  if (!isHost) {
    log('Only host can start the game');
    return;
  }
  
  if (connections.length + 1 < TOTAL_PLAYERS) {
    log(`Need ${TOTAL_PLAYERS} players. Currently: ${connections.length + 1}`);
    return;
  }
  
  if (!gameState.currentDistributor) {
    log('Please set initial distributor first');
    return;
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
  
  updateGameDisplay();
  broadcastToAll({
    type: 'gameState',
    state: gameState
  });
  
  // Show round controls
  document.getElementById('roundControls').classList.remove('hidden');
  
  log(`Game started! Distributor: Player ${gameState.currentDistributor}`);
  log(`Round ${gameState.currentRound} of ${ROUNDS_PER_GAME}`);
}

function setDistributor() {
  if (!isHost) {
    log('Only host can set distributor');
    return;
  }
  
  const distributor = parseInt(document.getElementById('distributorSelect').value);
  gameState.currentDistributor = distributor;
  log(`Initial distributor set to Player ${distributor}`);
  updateGameDisplay();
  broadcastToAll({
    type: 'gameState',
    state: gameState
  });
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
  if (!isHost) {
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
  
  broadcastToAll({
    type: 'gameState',
    state: gameState
  });
}

// ==================== Message Handling ====================

function handleHostMessage(data, conn) {
  try {
    const message = typeof data === 'string' ? JSON.parse(data) : data;
    
    switch (message.type) {
      case 'playerAction':
        // Handle player actions (card plays, etc.)
        log(`Received action from player: ${JSON.stringify(message.action)}`);
        // Process action and update game state
        // Broadcast updated state
        broadcastToAll({
          type: 'gameState',
          state: gameState
        });
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
  
  // Update player cards
  if (playerPosition && gameState.hands[playerPosition]) {
    displayPlayerCards(gameState.hands[playerPosition]);
  }
  
  // Show game section if game started
  if (gameState.gameStarted) {
    document.getElementById('gameSection').classList.remove('hidden');
  }
}

function displayPlayerCards(cards) {
  const container = document.getElementById('playerCards');
  container.innerHTML = '';
  
  if (!cards || cards.length === 0) {
    container.innerHTML = '<p>No cards yet. Waiting for game to start...</p>';
    return;
  }
  
  cards.forEach((card, index) => {
    const cardElement = document.createElement('div');
    cardElement.className = 'card';
    cardElement.classList.add(card.suit === 'hearts' || card.suit === 'diamonds' ? 'red' : 'black');
    cardElement.dataset.cardIndex = index;
    
    cardElement.innerHTML = `
      <div class="card-rank">${card.rank}</div>
      <div class="card-suit">${SUITS[card.suit]}</div>
      <div class="card-rank-bottom">${card.rank}</div>
    `;
    
    cardElement.addEventListener('click', () => {
      // Toggle selection
      cardElement.classList.toggle('selected');
      // TODO: Handle card selection for playing
    });
    
    container.appendChild(cardElement);
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

// Expose functions globally
window.startGame = startGame;
window.setDistributor = setDistributor;
window.createHost = createHost;
window.joinHost = joinHost;
window.endRoundTest = endRoundTest;
