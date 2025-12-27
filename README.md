# 6 Player Card Game

A multiplayer card game for 6 players using PeerJS for P2P connections. Perfect for hosting on GitHub Pages!

## Game Rules

### Setup
- **Total Players**: 6
- **Teams**:
  - Team 1: Player 1, Player 3, Player 5
  - Team 2: Player 2, Player 4, Player 6
- **Cards**: 48 cards (all 52 cards minus all 2s)
- **Cards per Player**: 8 cards
- **Rounds per Game**: 8 rounds

### Card Distribution
- Players sit in circular order: P1 → P2 → P3 → P4 → P5 → P6 → back to P1
- Cards are distributed clockwise starting from the player after the distributor
- Example: If P4 is distributor, cards go to: P5, P6, P1, P2, P3, P4, repeat

### Points System
- **Team 1 wins a round**: +5 points to Team 1
- **Team 2 wins a round**: -10 points from Team 1
- **Points shift**: When Team 1 points go negative:
  - Absolute negative points are added to Team 2
  - Team 1 points reset to 0
  - Distributor changes to next player in rotation (Team 1)
- **Special Rule**: If Team 2 exceeds 32 points:
  - Team 2 keeps only points above 32
  - Distributor changes directly to P1 (Team 1)

### Distributor Rotation
- After each game, distributor rotates clockwise
- Special rotation occurs when points shift (see above)

## How to Play

### For Host (Player 1)
1. Open the game in your browser
2. Click "Create Host"
3. Share the Room ID with other players
4. Wait for all 6 players to connect
5. Set the initial distributor using the dropdown
6. Click "Start Game" when ready
7. Use "Team 1 Wins Round" or "Team 2 Wins Round" buttons to test round endings (winning conditions will be added later)

### For Players (Players 2-6)
1. Open the game in your browser
2. Enter the Room ID provided by the host
3. Click "Join Game"
4. Wait for the host to start the game
5. Your cards will appear once the game starts
6. Play your cards (card selection UI will be enhanced when winning conditions are added)

## Technical Details

- **Frontend Only**: All game logic runs in the browser
- **P2P Communication**: Uses PeerJS for peer-to-peer connections
- **Host Authority**: Only the host browser stores and manages game state
- **No Reconnection**: Players cannot rejoin after disconnecting
- **State Synchronization**: Host broadcasts game state updates to all clients

## Files

- `index.html` - Main game interface
- `style.css` - Game styling
- `game.js` - Game logic and P2P connection management

## Hosting on GitHub Pages

1. Push all files to a GitHub repository
2. Go to repository Settings → Pages
3. Select the branch and folder
4. Your game will be available at `https://yourusername.github.io/repository-name/`

## Notes

- Winning conditions for each round will be implemented later
- Currently includes test buttons for round endings
- All game state is managed by the host browser
- Clients send actions to host, host validates and updates state

## Browser Compatibility

Works best in modern browsers that support WebRTC (Chrome, Firefox, Edge, Safari).
