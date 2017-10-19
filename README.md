# mission-game-server
Web service/module for a mission-based deception game

# Installation

TODO: Publish npm package

# Usage

## Standalone Web Service

Not currently working

## Module

You can configure your own server instance by importing the package

```javascript
const { ConnectionController, GameService, LobbyService } = require('mission-game-server');
```

`ConnectionController` manages Web Socket connections and responds to user actions.
If used, it will also instantiate `GameService` and `LobbyService`. Use this approach
if you want to use a different logger or a custom `UserService`.

```javascript
const socketIO = require('socket.io');
const { ConnectionController } = require('mission-game-server');
const io = socketIO(myExpressServer);

ConnectionController.listen(io, {
    logger: myLogger,
    UserService: myUserService
});
```

If writing your own controller (e.g. if not using Web Sockets), instantiate `GameService`
and (possibly) `LobbyService`. You must pass a `UserService` and a logger to each.

```javascript
const gameService = GameService(myUserService, myLogger);
const lobbyService = LobbyService(myUserService, myLogger);

gameService.addEventListener('eventType', ...);
lobbyService.addEventListener('eventType', ...);
```

# ConnectionController API

The `ConnectionController` creates a unique "account" for each connection.
It manages user actions and periodicall sends lobby and game updates through
the appropriate users' connections. "Request" payloads and "response" payloads
are documented separately, as not all user actions will generate a response
and not all responses are caused by a specific user action

## Actions

### Change Username
```javascript
socket.emit('userdata', {username: 'New Name'});
```

### Update Global Position
The `LobbyService` uses GPS for local matchmaking
```javascript
geolocation.getCurrentPosition(coords => {
    socket.emit('userdata', {coords});
});
```

### Host a Game
Hosts have 3 options for creating a game:

  - Local: Only players within a small geographic radius of the host will see the game in the lobby listing. Clients must provide the game ID to join
  - Password: Anyone with the password may join through the lobby
  - Link: The game ID is exposed in a link. Clients must provide the game ID to join.

```javascript
socket.emit('lobby', {
    action: 'host',
    room: {
        type: 'local' | 'password' | 'link',
        password: 'required only for password games'
    }
});
```

### Join a Game
```javascript
socket.emit('lobby', {
    action: 'join',
    id: 'A23FDX',
    password: 'required only for password games'
});
```

### Start Hosted Game
```javascript
socket.emit('lobby', {
    action: 'start'
});
```
Only the host of a game may do this

### Leave a Lobby Room
```javascript
socket.emit('lobby', {
    action: 'leave'
});
```

### Make a Move In-Game
Depending on the phase of the game, a player can make one of three moves:

```javascript
socket.emit('game', {
    action: 'move',
    // nominations is an array of lookup indices.
    // The ordering of the player array in the game
    // state is preserved, so putting 0 in the nomination
    // array means to nominate the first player
    nominations: [0, 2, 3]
});
```

```javascript
socket.emit('game', {
    action: 'move',
    // All players must vote on the nominations
    approve: true | false
});
```

```javascript
socket.emit('game', {
    action: 'move',
    // In the mission phase, successfully nominated
    // players secretly choose whether the mission
    // is successful
    succeed: true | false
});
```

## Payloads

### User Data
The user data is sent to its user on connection and whenever it changes

```javascript
socket.on('userdata', ({
    username,
    coords
}) => {
    ...
});
```

### Lobby Listing
The lobby listing is periodically sent to all users if any update to the lobby has occurred

```javascript
socket.on('lobby', ({
    type, // 'listing'
    rooms
}) => {
    ...
});
```

`rooms` is an array containing objects of the following form:
```javascript
{
    id: '3ZBF21',
    players: ['Alice', 'Bob'] // Alice is the host
}
```

### Lobby Room
If the user is currently in a lobby room (waiting to play), they will be sent
the room data anytime it changes

```javascript
socket.on('lobby', ({
    type, // 'room-update'
    room
}));
```

`room` is an object of the form:
```javascript
{
    id: 'QF2341',
    players: ['Alice', 'Bob', 'Claire'],
    isUserHost: true | false
}
```
This is identical to a lobby listing entry except that the user may be indicated
as the host

### Room Cancelled
If the host leaves a room, the room is cancelled

```javascript
socket.on('lobby', ({
    type, // 'room-cancelled'
    room
}));
```

### Errors
Service error messages are sent back with `'service-error'` events.

```javascript
socket.on('service-error', error => {
    console.error(error);
});
```