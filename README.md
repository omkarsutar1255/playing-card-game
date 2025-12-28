# 6 Player Card Game (P2P)

A multiplayer strategic card game for 6 players using PeerJS for peer-to-peer connections. The game features complex trump mechanics, asymmetric winning targets, and a dynamic scoring system.

## 🎮 Game Overview

- **Players**: 6 (Split into 2 Teams)
- **Deck**: 48 Cards (Standard deck minus all 2s)
- **Hands**: 8 cards per player
- **Technology**: Vanilla JS, HTML, CSS, PeerJS (No backend required)

## ⚔️ Teams & Setup

- **Team 1**: Player 1, Player 3, Player 5
- **Team 2**: Player 2, Player 4, Player 6
- **Seating**: Circular (P1 → P2 → ... → P6 → P1)

## 📜 Game Rules

### 1. The Deal & First Move
- **Distributor**: Chosen randomly for the first game, then rotates clockwise (with special skip rules).
- **First Player**: The player sitting immediately left of the distributor starts the game.
- **Attacker vs. Defender**:
  - The team that makes the **First Move** is the **Attacker**.
  - The team that distributed the cards is the **Defender**.

### 2. The Hidden Card (Super Suit) mechanism
At the start of every game, **one card is hidden** from the First Player's hand.
- **Base Suit**: The suit of the first card played in a round. Players must follow this suit if possible.
- **Opening the Hidden Card**: If a player cannot follow the Base Suit, they have the option to "Open Hidden Card".
- **Super Suit**: The suit of the hidden card becomes the **Super Suit (Trump)** immediately upon opening.
- **Mandatory Play**: If a player opens the hidden card, they **must** play a Super Suit card for that turn if they have one.

### 3. Winning a Round (Card Power)
Cards are ranked: `3` (Low) → `A` (High).
The winner of a round is determined by:

1.  **Super Suit Logic**:
    * **Case A (Already Open):** If the Hidden Card was opened in a *previous* round, the highest Super Suit card played wins.
    * **Case B (Fresh Open):** If the Hidden Card is opened *during the current round*, only Super Suit cards played **by or after the opener** are valid trumps. Any Super Suit cards played *before* the reveal are treated as normal cards (and usually lose).
2.  **Base Suit Logic**: If no valid Super Suit cards are played, the highest card of the **Base Suit** wins.

The winner of the round leads the next round.

### 4. Winning the Game (Asymmetric Targets)
The game ends **immediately** when a team reaches their target:
- **Attacking Team (First Movers)**: Needs **5 Rounds** to win.
- **Defending Team (Distributors)**: Needs **4 Rounds** to win.

### 5. Scoring System
Points are calculated after a game concludes:
- **Standard Win**: Winner gets **+5 Points**.
- **Steal Win**: If the losing team has points, the winner "steals" points (up to 10) from the loser's score instead of generating new points.
- **👑 King Indicator**: The team currently in the lead displays a Crown icon.

### 🐣 The 32-Point Rule ("Winner Winner Chicken Dinner")
If a team's score reaches or exceeds **32 Points**:
1.  Their score is reduced by 32 (e.g., 35 becomes 3).
2.  A celebration popup appears.
3.  **Distributor Penalty**: The distributor rotation skips the standard next player and jumps to the next teammate (skipping one person in the cycle).

## 🕹️ How to Play

### Host (Player 1)
1.  Click **Create Host**.
2.  Share the **Room ID** with 5 friends.
3.  (Optional) Click **📝 Setup Names** to rename Teams and Players.
4.  Wait for all players to connect.
5.  Click **Start Game**.

### Clients (Players 2-6)
1.  Enter the **Room ID** shared by the Host.
2.  Click **Join Game**.
3.  Wait for the Host to start.

### Interface Guide
- **Your Cards**: Click a card to select it. If valid, click "Play Selected".
- **Round View**: The top box shows cards played in this round, ordered from first played to last played.
- **Hidden Card**: If you cannot follow suit, a button appears to **Open Hidden Card**.
- **Round Result**: A popup appears for 5 seconds after every round showing the winner.

## 🛠️ Technical Features
- **Test Mode**: Simulates all 6 players in one browser window for debugging.
- **Audio Effects**: Sounds for shuffling, winning, and cheering.
- **Compact UI**: Optimized to prevent scrolling during gameplay.
- **State Recovery**: The game does not support reconnection if a tab is closed (session-based).

## 📂 Project Structure
- `index.html`: Main game UI and audio elements.
- `style.css`: Styling, animations (bounce/pulse), and responsive design.
- `game.js`: Core logic, PeerJS networking, rules enforcement (Super Suit validation, 5v4 targets).

## 🚀 Deployment
Ready for GitHub Pages. Simply push the files to a repository and enable Pages in settings.